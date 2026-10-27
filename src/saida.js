import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync,
  statSync, writeSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path';

/**
 * Texto grande (XML de processo, fonte de dataset) cabendo no contexto do agente. Medido no Fluig
 * 1.7.1: o XML de um processo real tem 142 KB, que vinham inteiros numa resposta só. Com `destino` o
 * texto vai inteiro para o arquivo e a resposta traz só o resumo, como os downloads binários já fazem.
 *
 * Neste fork, `destino` e o arquivo que sobe ao Fluig (ver lerNaSaida) aceitam qualquer caminho absoluto,
 * como antes da 1.2.0 do original: a trava na pasta de saída foi tirada a pedido. Caminho relativo é
 * relativo à pasta de saída (padrão ~/fluig-mcp-saida), não à pasta onde o MCP roda, que no Claude Desktop
 * do macOS é "/". O portão contra gravação induzida é a aprovação de ferramenta do cliente MCP.
 *
 * O arquivo é gravado num temporário novo (O_EXCL: nunca abre algo que já exista) e trocado por rename:
 * uma falha no meio não destrói o arquivo anterior, e um link plantado no destino é substituído, não seguido.
 *
 * Pasta 0700 e arquivo 0600: fonte de dataset costuma trazer credencial JDBC em texto claro, e em Linux
 * multiusuário a home pode ser legível pelos outros usuários.
 */
export const MAX_CHARS_PADRAO = 20000;

/** Início do aviso de corte. As ferramentas de escrita recusam conteúdo que o contenha (ver server.js). */
export const MARCA_CORTE = '[… cortado:';

export function pastaSaidaPadrao(env = process.env, home = homedir()) {
  const valor = String(env.FLUIG_SAIDA_DIR || '').trim();
  if (!valor) return join(home, 'fluig-mcp-saida');
  // O cliente MCP passa a variável sem shell: "~" chegaria literal, e um caminho relativo seria
  // resolvido contra a pasta do processo — o projeto do usuário, que é justamente o que se quer evitar.
  const expandido = /^~(?=$|[\\/])/.test(valor) ? join(home, valor.slice(1)) : valor;
  if (!isAbsolute(expandido)) {
    throw new Error(`FLUIG_SAIDA_DIR precisa ser um caminho absoluto (ou começar com ~): "${valor}".`);
  }
  return expandido;
}

/** lstat que devolve null quando não existe (existsSync seguiria o link e diria que um link quebrado não existe). */
const lst = (p) => {
  try {
    return lstatSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
};

const recusaEm = (campo = 'destino') => (motivo) => new Error(`${campo} ${motivo}.`);

/** Conferência pelo nome, sem tocar o disco. `campo` é o parâmetro citado na recusa. */
function conferirCaminho(caminho, { base, campo }) {
  const raiz = resolve(base);
  const recusa = recusaEm(campo);
  if (typeof caminho !== 'string' || !caminho.trim()) throw recusa('inválido: informe um nome de arquivo');
  if (/[\\/]$/.test(caminho)) throw recusa('precisa ser um nome de arquivo, não uma pasta');
  const arquivo = resolve(raiz, caminho);
  if (arquivo === raiz) throw recusa('precisa ser um nome de arquivo, não a própria pasta de saída');
  // No Windows o Node grava com o prefixo \\?\, que aceita nomes que o próprio Windows não aceita:
  // "a." e "a " ou CON/NUL/COM1 viram entradas que o Explorer e o PowerShell não conseguem apagar.
  if (process.platform === 'win32') {
    const ruim = arquivo.slice(parse(arquivo).root.length).split(sep).find((p) => /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(p));
    if (ruim) throw recusa(`inválido no Windows ("${ruim}": nome reservado ou terminado em ponto/espaço)`);
  }
  return { arquivo, recusa };
}

/**
 * Conferência só pelo caminho, sem tocar o disco. Barata o bastante para rodar ANTES de baixar um
 * documento grande que seria recusado depois. Devolve o caminho absoluto pretendido.
 */
export function conferirDestino(destino, { base = pastaSaidaPadrao() } = {}) {
  return conferirCaminho(destino, { base, campo: 'destino' }).arquivo;
}

/**
 * Grava `conteudo` (string em UTF-8, ou Buffer byte a byte) em `destino`. Caminho relativo é relativo a
 * `base`. Devolve o caminho absoluto gravado.
 */
export function gravarNaSaida(destino, conteudo, { base = pastaSaidaPadrao() } = {}) {
  const { arquivo, recusa } = conferirCaminho(destino, { base, campo: 'destino' });

  const pasta = dirname(arquivo);
  try {
    mkdirSync(pasta, { recursive: true, mode: 0o700 });
  } catch (e) {
    throw recusa(`inválido: não consegui criar ${pasta} (${e.code || e.message})`);
  }

  const atual = lst(arquivo);
  if (atual?.isSymbolicLink()) throw recusa(`é um link simbólico (${arquivo}); grave num arquivo comum`);
  if (atual && !atual.isFile()) throw recusa(`não é um arquivo comum (${arquivo})`);

  const tmp = join(pasta, `.${basename(arquivo)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  const fd = openSync(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(String(conteudo), 'utf8');
    let gravados = 0;
    while (gravados < buf.length) gravados += writeSync(fd, buf, gravados, buf.length - gravados);
    fsyncSync(fd);
  } catch (e) {
    closeSync(fd);
    rmSync(tmp, { force: true });
    throw e;
  }
  closeSync(fd);
  try {
    renameSync(tmp, arquivo);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return arquivo;
}

/**
 * Lê um arquivo local que o agente indicou para ENVIAR ao Fluig (upload ao GED, ZIP de formulário,
 * XML e SVG de processo). Qualquer caminho absoluto; relativo é relativo a `base`. `campo` é o
 * parâmetro citado no erro. Devolve Buffer, ou string com `encoding`.
 */
export function lerNaSaida(caminho, { base = pastaSaidaPadrao(), campo = 'caminho', encoding } = {}) {
  const { arquivo, recusa } = conferirCaminho(caminho, { base, campo });
  let real;
  try {
    real = realpathSync.native(arquivo);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${campo}: arquivo não encontrado (${arquivo}).`);
    throw e;
  }
  if (!statSync(real).isFile()) throw recusa(`não é um arquivo comum (${arquivo})`);
  const fd = openSync(real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    return readFileSync(fd, encoding);
  } finally {
    closeSync(fd);
  }
}

/**
 * Texto inline com teto de `maxChars` (padrão 20 000), ou inteiro em arquivo com `destino`.
 * O corte não parte par substituto UTF-16 (um emoji viraria U+FFFD no cliente).
 */
export function entregarTexto(texto, { destino, maxChars, base = pastaSaidaPadrao() } = {}) {
  const t = String(texto ?? '');
  if (destino) return { arquivo: gravarNaSaida(destino, t, { base }), caracteres: t.length };
  const n = Math.floor(Number(maxChars));
  const limite = n > 0 ? n : MAX_CHARS_PADRAO;
  if (t.length <= limite) return t;
  let corte = limite;
  const c = t.charCodeAt(corte - 1);
  if (c >= 0xd800 && c <= 0xdbff) corte -= 1;
  return `${t.slice(0, corte)}\n\n${MARCA_CORTE} ${t.length - corte} de ${t.length} caracteres omitidos. `
    + 'Informe destino para gravar o conteúdo inteiro em arquivo, ou aumente maxChars. '
    + 'Nunca salve de volta no Fluig um texto cortado.]';
}

/**
 * Recusa gravar no Fluig um texto que saiu cortado de uma leitura: get → editar → save num dataset
 * grande gravaria o código truncado, com o aviso dentro, na versão nova. Percorre objetos e listas,
 * porque o código também chega dentro de files[].content e events[].contents.
 */
export function recusarCortado(valor, campo) {
  if (typeof valor === 'string') {
    if (!valor.includes(MARCA_CORTE)) return;
    throw new Error(
      `${campo} contém o aviso de corte (${MARCA_CORTE} …): o texto veio cortado de uma leitura. `
      + 'Leia de novo com destino (arquivo inteiro) ou com maxChars maior, e grave o conteúdo completo.',
    );
  }
  if (Array.isArray(valor)) valor.forEach((v, i) => recusarCortado(v, `${campo}[${i}]`));
  else if (valor && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) recusarCortado(v, campo ? `${campo}.${k}` : k);
  }
}
