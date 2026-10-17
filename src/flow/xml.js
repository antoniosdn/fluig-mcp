/**
 * Parser XML mínimo, sem dependência, para o formato ECM30 do Fluig.
 *
 *   const raiz = parseXml(texto);   // No = { nome, filhos: No[], texto }
 *
 * Suporta o subconjunto que o Studio e o servidor usam: tags sem atributos,
 * texto, entidades (nomeadas e numéricas), CDATA, comentário, declaração e BOM.
 * Tudo fora disso (atributo, DOCTYPE/ENTITY, entidade desconhecida) é rejeitado
 * com erro claro, em vez de ser lido errado.
 *
 * `texto` de um elemento é a concatenação dos trechos de texto diretos dele,
 * já decodificados e sem `trim`.
 */

const ENTIDADES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function falha(pos, mensagem) {
  return new Error(`XML inválido na posição ${pos}: ${mensagem}.`);
}

/** Decodifica as entidades de um trecho de texto (uma passada só). */
function decodificar(trecho, base) {
  if (trecho.indexOf('&') === -1) return trecho;
  let saida = '';
  let i = 0;
  while (i < trecho.length) {
    const c = trecho[i];
    if (c !== '&') {
      saida += c;
      i += 1;
      continue;
    }
    const fim = trecho.indexOf(';', i + 1);
    const nome = fim === -1 ? '' : trecho.slice(i + 1, fim);
    if (fim === -1 || nome === '' || nome.length > 10 || /[\s&<]/.test(nome)) {
      throw falha(base + i, '"&" solto (entidade sem ";" ou vazia)');
    }
    if (nome[0] === '#') {
      const hex = nome[1] === 'x' || nome[1] === 'X';
      const digitos = nome.slice(hex ? 2 : 1);
      const valido = hex ? /^[0-9A-Fa-f]+$/.test(digitos) : /^[0-9]+$/.test(digitos);
      const codigo = valido ? parseInt(digitos, hex ? 16 : 10) : NaN;
      if (!Number.isInteger(codigo) || codigo < 0 || codigo > 0x10ffff || (codigo >= 0xd800 && codigo <= 0xdfff)) {
        throw falha(base + i, `entidade numérica inválida (&${nome};)`);
      }
      saida += String.fromCodePoint(codigo);
    } else if (Object.prototype.hasOwnProperty.call(ENTIDADES, nome)) {
      saida += ENTIDADES[nome];
    } else {
      throw falha(base + i, `entidade desconhecida (&${nome};)`);
    }
    i = fim + 1;
  }
  return saida;
}

/**
 * Lê o texto XML e devolve a raiz como árvore de nós.
 * @param {string} texto
 * @returns {{nome: string, filhos: Array, texto: string}}
 */
export function parseXml(texto) {
  if (typeof texto !== 'string') throw new Error('XML inválido: a entrada deve ser texto.');
  let s = texto;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s.trim() === '') throw new Error('XML inválido: documento vazio.');

  const pilha = [];
  let raiz = null;
  let i = 0;
  const n = s.length;

  const textoLivre = (trecho, base) => {
    if (pilha.length === 0) {
      if (trecho.trim() !== '') throw falha(base, 'texto fora do elemento raiz');
      return;
    }
    pilha[pilha.length - 1].texto += decodificar(trecho, base);
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt === -1) {
      textoLivre(s.slice(i), i);
      break;
    }
    if (lt > i) textoLivre(s.slice(i, lt), i);
    i = lt;

    if (s.startsWith('<!--', i)) {
      const fim = s.indexOf('-->', i + 4);
      if (fim === -1) throw falha(i, 'comentário não fechado');
      i = fim + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      const fim = s.indexOf(']]>', i + 9);
      if (fim === -1) throw falha(i, 'CDATA não fechado');
      if (pilha.length === 0) throw falha(i, 'CDATA fora do elemento raiz');
      pilha[pilha.length - 1].texto += s.slice(i + 9, fim);
      i = fim + 3;
    } else if (s.startsWith('<?', i)) {
      const fim = s.indexOf('?>', i + 2);
      if (fim === -1) throw falha(i, 'instrução "<?" não fechada');
      i = fim + 2;
    } else if (/^<!(DOCTYPE|ENTITY)/i.test(s.slice(i, i + 10))) {
      throw falha(i, 'DOCTYPE/ENTITY não é suportado');
    } else if (s.startsWith('<!', i)) {
      throw falha(i, 'declaração "<!" não suportada');
    } else if (s.startsWith('</', i)) {
      const fim = s.indexOf('>', i + 2);
      if (fim === -1) throw falha(i, 'tag de fechamento sem ">"');
      const nome = s.slice(i + 2, fim).trim();
      if (pilha.length === 0) throw falha(i, `fechamento </${nome}> sem abertura`);
      const aberto = pilha.pop();
      if (aberto.nome !== nome) {
        throw falha(i, `fechamento </${nome}> não casa com a abertura <${aberto.nome}>`);
      }
      i = fim + 1;
    } else {
      const fim = s.indexOf('>', i + 1);
      if (fim === -1) throw falha(i, 'tag sem ">"');
      let corpo = s.slice(i + 1, fim);
      const autoFecha = corpo.endsWith('/');
      if (autoFecha) corpo = corpo.slice(0, -1);
      const nome = corpo.trim();
      if (nome === '') throw falha(i, 'tag sem nome');
      if (/\s/.test(nome)) throw falha(i, `atributo não suportado na tag <${nome.split(/\s+/)[0]}>`);
      if (/[<"'=]/.test(nome)) throw falha(i, `nome de tag inválido (${nome})`);
      const no = { nome, filhos: [], texto: '' };
      if (pilha.length === 0) {
        if (raiz) throw falha(i, 'mais de um elemento raiz');
        raiz = no;
      } else {
        pilha[pilha.length - 1].filhos.push(no);
      }
      if (!autoFecha) pilha.push(no);
      i = fim + 1;
    }
  }

  if (pilha.length > 0) throw falha(n, `tag <${pilha[pilha.length - 1].nome}> não fechada`);
  if (!raiz) throw new Error('XML inválido: documento sem elemento raiz.');
  return raiz;
}

/** Primeiro filho com o nome, ou undefined. */
export function filho(no, nome) {
  if (!no) return undefined;
  return no.filhos.find((f) => f.nome === nome);
}

/** Todos os filhos com o nome. */
export function filhos(no, nome) {
  if (!no) return [];
  return no.filhos.filter((f) => f.nome === nome);
}

/** Texto do primeiro filho com o nome, ou undefined se não houver. */
export function textoDe(no, nome) {
  const f = filho(no, nome);
  return f ? f.texto : undefined;
}
