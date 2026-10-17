/**
 * Gerador do XML ECM30 de um processo Fluig a partir da spec v1 (passo 3 do gerador de fluxo).
 *
 *   const r = await gerarXmlProcesso(spec, { versaoAlvo: '2.0', lookups, modelo, origem });
 *   // spec com erro: { ok: false, erros, avisos }
 *   // spec válida:   { ok: true, xml, avisos, sequencias: { [idAtividade]: sequence } }
 *
 * Item de erro/aviso = { codigo, mensagem, caminho } (o mesmo do validador).
 * Pura e determinística; nunca altera a spec nem as opções. Só lança por defeito do próprio código.
 * Não gera o desenho (SVG): o processo importa e roda, mas fica sem desenho até ser salvo no editor.
 */
import { TIPOS, OPERADORES, OPS_SEM_VALOR, VALOR_TIPOS, EXECUCAO } from './spec.js';
import { validarSpec } from './validar.js';
import { parseXml, filho, textoDe } from './xml.js';
import {
  VAZIO_AUTO,
  BLOCOS,
  BLOCO,
  PK,
  M_PROCESSO,
  M_VERSAO,
  M_INICIO,
  M_HUMANA,
  M_SERVICO,
  M_CAPTURA,
  M_FIM,
  M_GATEWAY,
  M_LIGACAO,
  M_CONDICAO,
  M_REGRA,
  M_SERVICO_CONFIG,
} from './ecm30.js';

/* ------------------------------------------------------------------ */
/* Escape                                                              */
/* ------------------------------------------------------------------ */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;', '\r': '&#xd;' };

/** Escapa um texto para conteúdo de elemento XML, como o Studio (LF e TAB ficam como estão). */
export function escaparXml(texto) {
  return String(texto).replace(/[&<>"'\r]/g, (c) => ESCAPES[c]);
}

// Caractere proibido no XML 1.0 (controle, U+FFFE/U+FFFF, surrogate sozinho).
const PROIBIDO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;

/* ------------------------------------------------------------------ */
/* Árvore e serialização                                               */
/* ------------------------------------------------------------------ */

const OMITIR = Symbol('omitir');

const folha = (nome, texto) => ({ nome, texto: String(texto) });
const grupo = (nome, filhos) => ({ nome, filhos });
const lista = (filhos) => grupo('list', filhos);

/** Nó PK: nome do elemento + campos (nomes de `campos`, valores de `valores`). */
function pkNo(nome, campos, valores) {
  return grupo(
    nome,
    campos.map((c) => folha(c, valores[c]))
  );
}

/** Monta os filhos de um elemento a partir do modelo; `valores` preenche os campos variáveis. */
function montar(nome, modelo, valores, versao) {
  const filhos = [];
  for (const [campo, padrao, soVersao] of modelo) {
    if (soVersao && soVersao !== versao) continue;
    const v = Object.prototype.hasOwnProperty.call(valores, campo) ? valores[campo] : padrao;
    if (v === OMITIR) continue;
    if (v === null || v === undefined) throw new Error(`Gerador: campo ${campo} de ${nome} sem valor.`);
    if (v === VAZIO_AUTO) filhos.push({ nome: campo, auto: true });
    else if (typeof v === 'object') filhos.push(v);
    else filhos.push(folha(campo, v));
  }
  return grupo(nome, filhos);
}

function serializar(no, nivel, saida) {
  const pad = '  '.repeat(nivel);
  if (no.auto || (no.filhos && no.filhos.length === 0)) {
    saida.push(`${pad}<${no.nome}/>`);
  } else if (no.filhos) {
    saida.push(`${pad}<${no.nome}>`);
    for (const f of no.filhos) serializar(f, nivel + 1, saida);
    saida.push(`${pad}</${no.nome}>`);
  } else {
    saida.push(`${pad}<${no.nome}>${escaparXml(no.texto)}</${no.nome}>`);
  }
}

/* ------------------------------------------------------------------ */
/* Conferências                                                        */
/* ------------------------------------------------------------------ */

/** Percorre toda string da spec e acusa caractere proibido no XML. */
function conferirCaracteres(valor, caminho, erros) {
  if (typeof valor === 'string') {
    if (PROIBIDO.test(valor)) {
      erros.push({
        codigo: 'E_GERADOR_CARACTERE',
        mensagem: `O texto de ${caminho} tem caractere de controle que não pode ir no XML; remova-o.`,
        caminho,
      });
    }
  } else if (Array.isArray(valor)) {
    valor.forEach((v, i) => conferirCaracteres(v, `${caminho}[${i}]`, erros));
  } else if (valor !== null && typeof valor === 'object') {
    for (const [k, v] of Object.entries(valor)) conferirCaracteres(v, caminho ? `${caminho}.${k}` : k, erros);
  }
}

/** Lê categoria, volume, período e empresa do processo-modelo. Devolve null (e erro) se ilegível. */
function lerModelo(modelo, erros) {
  const falha = (motivo) => {
    erros.push({ codigo: 'E_MODELO', mensagem: `O processo-modelo não é um ECM30 legível: ${motivo}`, caminho: 'modelo' });
    return null;
  };
  if (typeof modelo !== 'string') return falha('deve ser o texto do XML.');
  let raiz;
  try {
    raiz = parseXml(modelo);
  } catch (e) {
    return falha(e.message);
  }
  if (raiz.nome !== 'list') return falha(`a raiz deve ser <list> (veio <${raiz.nome}>).`);
  let def = raiz.filhos.find((c) => c.nome === 'ProcessDefinition');
  if (!def) {
    for (const c of raiz.filhos) {
      def = c.nome === 'list' ? c.filhos.find((x) => x.nome === 'ProcessDefinition') : undefined;
      if (def) break;
    }
  }
  if (!def) return falha('não há o elemento ProcessDefinition.');
  const texto = (v, padrao) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : padrao);
  return {
    companyId: texto(textoDe(filho(def, 'processDefinitionPK'), 'companyId'), '1'),
    categoryId: texto(textoDe(def, 'categoryId'), ''),
    volumeId: texto(textoDe(def, 'volumeId'), 'Default'),
    periodId: texto(textoDe(def, 'periodId'), 'Default'),
  };
}

/* ------------------------------------------------------------------ */
/* Ligações emitidas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Agrupa as ligações em ProcessLink: uma por ligação, exceto saídas repetidas de gateway
 * exclusivo para o mesmo destino (OU), que dividem o ProcessLink da primeira ocorrência.
 * Devolve [{ indice, indices, retorno, de, para, padrao }] na ordem de emissão.
 */
function agruparLigacoes(spec, avisos) {
  const tipoPorId = new Map(spec.atividades.map((a) => [a.id, a.tipo]));
  const grupos = [];
  const porChave = new Map();
  spec.ligacoes.forEach((l, i) => {
    const ret = l.retorno === true;
    if (tipoPorId.get(l.de) === 'gateway_exclusivo') {
      const chave = `${l.de}\u0000${l.para}`;
      const g = porChave.get(chave);
      if (g) {
        g.retornos.push(ret);
        g.indices.push(i);
        if (l.padrao === true) g.padrao = true;
        return;
      }
      const novo = { indice: i, indices: [i], de: l.de, para: l.para, retornos: [ret], padrao: l.padrao === true };
      porChave.set(chave, novo);
      grupos.push(novo);
    } else {
      grupos.push({ indice: i, indices: [i], de: l.de, para: l.para, retornos: [ret], padrao: false });
    }
  });
  return grupos.map((g) => {
    const algum = g.retornos.some(Boolean);
    if (algum && !g.retornos.every(Boolean)) {
      avisos.push({
        codigo: 'W_GERADOR_RETORNO_OU',
        mensagem: `As ligações de ${g.de} para ${g.para} (OU) divergem em "retorno"; o ProcessLink único ficou com retorno permitido.`,
        caminho: `ligacoes[${g.indice}]`,
      });
    }
    return { indice: g.indice, indices: g.indices, de: g.de, para: g.para, retorno: algum, padrao: g.padrao };
  });
}

/* ------------------------------------------------------------------ */
/* Numeração                                                           */
/* ------------------------------------------------------------------ */

const ehInteiroPositivo = (n) => Number.isInteger(n) && n >= 1;

/**
 * Confere `origem`; devolve { sequencias: Map id->n, capturas: Map idServico->n, links: [n|null] por grupo emitido }.
 * `origem.capturas` guarda o sequence da captura de erro de cada serviço automatizado.
 * `origem.linkSequences[i]` corresponde a `spec.ligacoes[i]`; cada ProcessLink usa o valor da
 * primeira ligação do seu grupo (OU), com aviso se as outras divergirem.
 */
function conferirOrigem(origem, spec, grupos, erros, avisos) {
  const saida = { sequencias: new Map(), capturas: new Map(), links: grupos.map(() => null) };
  if (origem === undefined || origem === null) return saida;
  const erro = (mensagem, caminho) => erros.push({ codigo: 'E_GERADOR_ORIGEM', mensagem, caminho });
  if (typeof origem !== 'object' || Array.isArray(origem)) {
    erro('origem deve ser um objeto { sequencias, capturas, linkSequences }.', 'origem');
    return saida;
  }
  const ids = new Set(spec.atividades.map((a) => a.id));
  const seqs = origem.sequencias;
  if (seqs !== undefined && seqs !== null) {
    if (typeof seqs !== 'object' || Array.isArray(seqs)) {
      erro('origem.sequencias deve ser um objeto { idAtividade: número }.', 'origem.sequencias');
    } else {
      const usados = new Map();
      for (const [id, n] of Object.entries(seqs)) {
        if (!ids.has(id)) {
          avisos.push({
            codigo: 'W_GERADOR_ORIGEM_ID',
            mensagem: `origem.sequencias tem o id "${id}", que não existe na spec; foi ignorado.`,
            caminho: `origem.sequencias.${id}`,
          });
          continue;
        }
        const cam = `origem.sequencias.${id}`;
        if (!ehInteiroPositivo(n)) {
          erro(`O sequence de "${id}" em origem deve ser inteiro maior ou igual a 1 (recebido: ${String(n)}).`, cam);
        } else if (usados.has(n)) {
          erro(`O sequence ${n} está repetido em origem (${usados.get(n)} e ${id}).`, cam);
        } else {
          usados.set(n, id);
          saida.sequencias.set(id, n);
        }
      }
    }
  }
  const caps = origem.capturas;
  if (caps !== undefined && caps !== null) {
    if (typeof caps !== 'object' || Array.isArray(caps)) {
      erro('origem.capturas deve ser um objeto { idServico: número }.', 'origem.capturas');
    } else {
      const servicosAuto = new Set(
        spec.atividades.filter((a) => a.tipo === 'servico' && a.execucao === 'automatizada').map((a) => a.id)
      );
      const ocupados = new Map([...saida.sequencias].map(([id, n]) => [n, `atividade ${id}`]));
      for (const [id, n] of Object.entries(caps)) {
        const cam = `origem.capturas.${id}`;
        if (!servicosAuto.has(id)) {
          avisos.push({
            codigo: 'W_GERADOR_ORIGEM_ID',
            mensagem: `origem.capturas tem o id "${id}", que não é um serviço automatizado da spec; foi ignorado.`,
            caminho: cam,
          });
          continue;
        }
        if (!ehInteiroPositivo(n)) {
          erro(`O sequence da captura de "${id}" em origem deve ser inteiro maior ou igual a 1 (recebido: ${String(n)}).`, cam);
        } else if (ocupados.has(n)) {
          erro(`O sequence ${n} da captura de "${id}" está repetido em origem (${ocupados.get(n)}).`, cam);
        } else {
          ocupados.set(n, `captura de ${id}`);
          saida.capturas.set(id, n);
        }
      }
    }
  }
  const links = origem.linkSequences;
  if (links !== undefined && links !== null) {
    if (!Array.isArray(links)) {
      erro('origem.linkSequences deve ser uma lista de números (ou null).', 'origem.linkSequences');
    } else {
      // valor válido (inteiro >= 1) ou null; índice inválido vira erro
      const valorEm = (i) => {
        const n = links[i];
        if (n === undefined || n === null) return null;
        if (!ehInteiroPositivo(n)) {
          erro(`O linkSequence em origem.linkSequences[${i}] deve ser inteiro maior ou igual a 1 (recebido: ${String(n)}).`, `origem.linkSequences[${i}]`);
          return null;
        }
        return n;
      };
      const usados = new Map(); // número -> índice do grupo
      const atividades = new Map([...saida.sequencias].map(([id, n]) => [n, id]));
      const capturasPorNumero = new Map([...saida.capturas].map(([id, n]) => [n, id]));
      grupos.forEach((g, k) => {
        const valores = g.indices.map(valorEm);
        const escolhido = valores.find((n) => n !== null);
        if (escolhido === undefined) return;
        g.indices.forEach((idx, j) => {
          if (valores[j] !== null && valores[j] !== escolhido) {
            avisos.push({
              codigo: 'W_GERADOR_ORIGEM_OU',
              mensagem: `As ligações OU de ${g.de} para ${g.para} têm linkSequence diferente em origem (${valores[j]} em vez de ${escolhido}); foi usado ${escolhido}.`,
              caminho: `origem.linkSequences[${idx}]`,
            });
          }
        });
        const cam = `origem.linkSequences[${g.indices[valores.indexOf(escolhido)]}]`;
        if (usados.has(escolhido)) {
          erro(`O linkSequence ${escolhido} está repetido em origem.linkSequences (grupos diferentes).`, cam);
        } else if (atividades.has(escolhido)) {
          erro(`O número ${escolhido} aparece em origem como atividade (${atividades.get(escolhido)}) e como linkSequence.`, cam);
        } else if (capturasPorNumero.has(escolhido)) {
          erro(
            `O número ${escolhido} aparece em origem como captura de erro (${capturasPorNumero.get(escolhido)}) e como linkSequence.`,
            cam
          );
        } else {
          usados.set(escolhido, k);
          saida.links[k] = escolhido;
        }
      });
    }
  }
  return saida;
}

/** Numera atividades, capturas de erro e ligações, em um contador único acima do maior número de origem. */
function numerar(spec, grupos, org) {
  let prox = Math.max(1, ...org.sequencias.values(), ...org.capturas.values(), ...org.links.filter((n) => n !== null)) + 1;
  const sequencias = {};
  const capturas = {}; // id do serviço -> sequence da captura
  for (const a of spec.atividades) {
    sequencias[a.id] = org.sequencias.has(a.id) ? org.sequencias.get(a.id) : prox++;
    if (a.tipo === 'servico' && a.execucao === 'automatizada') {
      capturas[a.id] = org.capturas.has(a.id) ? org.capturas.get(a.id) : prox++;
    }
  }
  const links = grupos.map((_, i) => (org.links[i] !== null ? org.links[i] : prox++));
  return { sequencias, capturas, links };
}

/* ------------------------------------------------------------------ */
/* Layout                                                              */
/* ------------------------------------------------------------------ */

/** Posição por id: a da spec (arredondada) ou a calculada por colunas (largura 250, linha 150). */
function posicionar(spec, avisos) {
  const ativs = spec.atividades;
  const comPosicao = ativs.filter((a) => a.posicao !== undefined).length;
  if (comPosicao > 0 && comPosicao < ativs.length) {
    avisos.push({
      codigo: 'W_GERADOR_POSICAO_PARCIAL',
      mensagem:
        'Só parte das atividades tem posicao; as outras foram posicionadas pelo gerador e podem cair em cima das informadas.',
      caminho: 'atividades',
    });
  }

  // colunas: distância (em ligações) a partir do início, busca em largura na ordem do array
  const coluna = new Map();
  const porColuna = [];
  const entra = (id, c) => {
    coluna.set(id, c);
    if (!porColuna[c]) porColuna[c] = [];
    porColuna[c].push(id);
  };
  const inicio = ativs.find((a) => a.tipo === 'inicio');
  const fila = [];
  if (inicio) {
    entra(inicio.id, 0);
    fila.push(inicio.id);
  }
  while (fila.length > 0) {
    const n = fila.shift();
    for (const l of spec.ligacoes) {
      if (l.de === n && !coluna.has(l.para)) {
        entra(l.para, coluna.get(n) + 1);
        fila.push(l.para);
      }
    }
  }
  for (const a of ativs) if (!coluna.has(a.id)) entra(a.id, 0); // defensivo: o validador exige alcançabilidade

  const pos = {};
  ativs.forEach((a, i) => {
    if (a.posicao !== undefined) {
      const { x, y } = a.posicao;
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        avisos.push({
          codigo: 'W_GERADOR_POSICAO_ARREDONDADA',
          mensagem: `A posição de ${a.id} (${x}, ${y}) não é inteira; foi arredondada.`,
          caminho: `atividades[${i}].posicao`,
        });
      }
      pos[a.id] = { x: Math.round(x), y: Math.round(y) };
    } else {
      const c = coluna.get(a.id);
      pos[a.id] = { x: 100 + 250 * c, y: 100 + 150 * porColuna[c].indexOf(a.id) };
    }
  });
  return pos;
}

/* ------------------------------------------------------------------ */
/* Montagem dos elementos                                              */
/* ------------------------------------------------------------------ */

function montarEstado(a, ctx) {
  const { companyId, processId, versao, sequencias, pos } = ctx;
  const seq = sequencias[a.id];
  const base = {
    processStatePK: pkNo('processStatePK', PK.estado, { companyId, processId, version: 1, sequence: seq }),
    stateName: a.nome,
    stateDescription: a.nome,
    positionX: pos[a.id].x,
    positionY: pos[a.id].y,
  };
  const def = TIPOS[a.tipo];
  switch (a.tipo) {
    case 'inicio':
      return montar('ProcessState', M_INICIO, base, versao);
    case 'humana': {
      let mecanismo = '';
      let config = '';
      if (a.responsavel) {
        mecanismo = a.responsavel.tipo === 'papel' ? 'Papel' : 'Pool Papel';
        config = `<AssignmentController><Role>${escaparXml(a.responsavel.valor)}</Role></AssignmentController>`;
      }
      return montar('ProcessState', M_HUMANA, { ...base, engineAllocationId: mecanismo, engineAllocationConfiguration: config }, versao);
    }
    case 'servico':
      return montar('ProcessState', M_SERVICO, { ...base, executionType: EXECUCAO[a.execucao] }, versao);
    case 'gateway_exclusivo':
    case 'gateway_paralelo_abertura':
    case 'gateway_paralelo_juncao':
      return montar(
        'ProcessState',
        M_GATEWAY,
        { ...base, automatic: a.tipo === 'gateway_exclusivo', stateType: def.stateType, bpmnType: def.bpmnType },
        versao
      );
    default: // fim, cancelamento, fim_terminativo
      return montar('ProcessState', M_FIM, { ...base, bpmnType: def.bpmnType }, versao);
  }
}

function montarCaptura(a, ctx) {
  const { companyId, processId, versao, sequencias, capturas, pos } = ctx;
  const seq = capturas[a.id];
  return {
    sequence: seq,
    no: montar(
      'ProcessState',
      M_CAPTURA,
      {
        processStatePK: pkNo('processStatePK', PK.estado, { companyId, processId, version: 1, sequence: seq }),
        positionX: pos[a.id].x + 60,
        positionY: pos[a.id].y - 30,
        parentSequence: sequencias[a.id],
      },
      versao
    ),
  };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Gera o XML ECM30 do processo.
 * @param {object} spec spec v1
 * @param {{versaoAlvo: '1.8.2'|'2.0', lookups?: object, modelo?: string, origem?: object}} opcoes
 * @returns {Promise<{ok: boolean, erros?: Array, avisos: Array, xml?: string, sequencias?: object}>}
 */
export async function gerarXmlProcesso(spec, opcoes = {}) {
  const { versaoAlvo, lookups, modelo, origem } = opcoes || {};

  // 1. validação da spec
  const v = await validarSpec(spec, { versaoAlvo, lookups });
  if (!v.ok) return { ok: false, erros: v.erros, avisos: v.avisos };

  const erros = [];
  const avisosG = [];

  // 2. caracteres, modelo, ligações e origem
  conferirCaracteres(spec, '', erros);
  let dadosModelo = { companyId: '1', categoryId: '', volumeId: 'Default', periodId: 'Default' };
  if (modelo === undefined || modelo === null) {
    avisosG.push({
      codigo: 'W_GERADOR_SEM_MODELO',
      mensagem:
        'Sem processo-modelo: categoria vazia, volume e período "Default" e empresa 1. Passe um processo lido do servidor de destino para herdar esses valores.',
      caminho: 'modelo',
    });
  } else {
    const lido = lerModelo(modelo, erros);
    if (lido) dadosModelo = lido;
  }
  const grupos = agruparLigacoes(spec, avisosG);
  const org = conferirOrigem(origem, spec, grupos, erros, avisosG);
  if (erros.length > 0) return { ok: false, erros, avisos: v.avisos };

  // 3. numeração e layout
  const num = numerar(spec, grupos, org);
  const pos = posicionar(spec, avisosG);

  // 4. elementos
  const versao = versaoAlvo;
  const processId = spec.processId;
  const companyId = dadosModelo.companyId;
  const descricao = typeof spec.descricao === 'string' && spec.descricao.trim() !== '' ? spec.descricao : processId;
  const ctx = { companyId, processId, versao, sequencias: num.sequencias, capturas: num.capturas, pos };

  const definicao = montar(
    'ProcessDefinition',
    M_PROCESSO,
    {
      processDefinitionPK: pkNo('processDefinitionPK', PK.processo, { companyId, processId }),
      processDescription: descricao,
      volumeId: dadosModelo.volumeId,
      categoryId: dadosModelo.categoryId,
      periodId: dadosModelo.periodId,
    },
    versao
  );

  if (spec.formId === undefined) {
    avisosG.push({
      codigo: 'W_GERADOR_SEM_FORMULARIO',
      mensagem: 'A spec não tem formId; o processo sai sem formulário vinculado (importação assim não foi testada).',
      caminho: 'formId',
    });
  }
  const versaoNo = montar(
    'ProcessDefinitionVersion',
    M_VERSAO,
    {
      // o Studio grava a descrição do processo no processId desta chave
      processDefinitionVersionPK: pkNo('processDefinitionVersionPK', PK.versao, {
        companyId,
        processId: descricao,
        version: 1,
      }),
      formId: spec.formId === undefined ? 0 : spec.formId,
    },
    versao
  );

  const idxAtiv = new Map(spec.atividades.map((a, i) => [a.id, i]));
  const estados = [];
  const servicos = [];
  spec.atividades.forEach((a, i) => {
    estados.push({ sequence: num.sequencias[a.id], no: montarEstado(a, ctx) });
    if (a.tipo === 'servico') {
      const auto = a.execucao === 'automatizada';
      if (auto) estados.push(montarCaptura(a, ctx));
      servicos.push(
        montar(
          'ProcessStateService',
          M_SERVICO_CONFIG,
          {
            companyId,
            processId,
            sequence: num.sequencias[a.id],
            attempts: auto ? 3 : 0,
            frequency: auto ? 5 : 1,
          },
          versao
        )
      );
      avisosG.push({
        codigo: 'W_GERADOR_SERVICO_SEM_SCRIPT',
        mensagem: `O serviço ${a.id} sai sem o script servicetask${num.sequencias[a.id]}; escreva-o no editor ou publique-o à parte.`,
        caminho: `atividades[${i}]`,
      });
    }
  });
  estados.sort((x, y) => x.sequence - y.sequence);

  const ligacoes = grupos.map((g, i) =>
    montar(
      'ProcessLink',
      M_LIGACAO,
      {
        processLinkPK: pkNo('processLinkPK', PK.ligacao, { companyId, processId, version: 1, linkSequence: num.links[i] }),
        returnPermited: g.retorno,
        defaultLink: g.padrao,
        initialStateSequence: num.sequencias[g.de],
        finalStateSequence: num.sequencias[g.para],
      },
      versao
    )
  );

  const condicoes = [];
  const regras = [];
  spec.ligacoes.forEach((l) => {
    if (spec.atividades[idxAtiv.get(l.de)].tipo !== 'gateway_exclusivo') return;
    const sequence = num.sequencias[l.de];
    const c = l.condicao;
    if (c === undefined) return; // saída padrão sem condição
    const porRegras = Array.isArray(c.regras);
    condicoes.push(
      montar(
        'ConditionProcessState',
        M_CONDICAO,
        {
          conditionProcessStatePK: pkNo('conditionProcessStatePK', PK.condicao, {
            companyId,
            processId,
            expressionOrder: l.ordem,
            version: 1,
            sequence,
          }),
          condition: porRegras ? OMITIR : c.js,
          destinationSequenceId: num.sequencias[l.para],
          conditionType: porRegras ? 1 : 0,
          conditionName: c.nome === undefined ? '' : c.nome,
        },
        versao
      )
    );
    if (porRegras) {
      c.regras.forEach((r, k) => {
        regras.push(
          montar(
            'ConditionProcessAutomaticRules',
            M_REGRA,
            {
              sequence,
              expressionOrder: l.ordem,
              ruleOrder: k + 1,
              field: r.campo,
              value: OPS_SEM_VALOR.includes(r.op) || r.valor === undefined || r.valor === null ? '' : String(r.valor),
              operator: OPERADORES[r.op],
              valueType: VALOR_TIPOS[r.valorTipo === undefined ? 'fixo' : r.valorTipo],
            },
            versao
          )
        );
      });
    }
  });

  // 5. documento
  const conteudo = {
    [BLOCO.estados]: estados.map((e) => e.no),
    [BLOCO.condicoes]: condicoes,
    [BLOCO.ligacoes]: ligacoes,
    [BLOCO.servicos]: servicos,
    [BLOCO.regras]: regras,
  };
  const filhosRaiz = BLOCOS.map((nome, i) => {
    if (i === BLOCO.definicao) return definicao;
    if (i === BLOCO.versao) return versaoNo;
    return lista(conteudo[i] || []);
  });

  avisosG.push({
    codigo: 'W_GERADOR_SEM_DESENHO',
    mensagem: 'O processo importa e roda, mas fica sem desenho até ser aberto e salvo no editor.',
    caminho: '',
  });

  const saida = [];
  serializar(grupo('list', filhosRaiz), 0, saida);
  return {
    ok: true,
    xml: saida.join('\n'),
    avisos: [...v.avisos, ...avisosG],
    sequencias: num.sequencias,
  };
}
