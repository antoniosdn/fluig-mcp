/**
 * Ida e volta do gerador de fluxo (passo 4): XML ECM30 -> spec v1 -> XML ECM30, comparados só
 * nos campos que a v1 cobre (projeção), com relatório de cobertura do que a v1 não guarda.
 *
 *   const r = await compararIdaEVolta(xml, { versaoAlvo: '1.8.2' });
 *   // r = { processId, resultado: 'igual'|'diferente'|'fora_v1'|'erro', diferencas, motivos, exclusoes, cobertura }
 *   console.log(formatarCobertura([r]));
 *
 * Função pura, sem I/O. As exclusões da comparação estão no plano-passo4-ida-e-volta.md (X1..X10, E1..E5).
 */
import { TIPOS } from './spec.js';
import { parseXml, filho, textoDe } from './xml.js';
import { lerXmlProcesso } from './ler.js';
import { validarSpec } from './validar.js';
import { gerarXmlProcesso } from './gerar.js';

/** Códigos do validador que significam "fora da v1" (não é falha da ida e volta). */
const FORA_V1 = ['E_TIPO_FORA_V1'];

const aparar = (v) => (typeof v === 'string' ? v.trim() : '');
const inteiro = (v) => {
  const t = aparar(v);
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
};

/** Campos numéricos/booleanos: comparados em minúsculas, sem espaços, com o padrão do Fluig quando vazios. */
const PADRAO_NUM = {
  formId: '0',
  formIdV2: '0',
  bpmnType: '',
  stateType: '0',
  initialState: 'false',
  automatic: 'false',
  positionX: '',
  positionY: '',
  executionType: '0',
  parentSequence: '0',
  returnPermited: 'false',
  defaultLink: 'false',
  initialStateSequence: '',
  finalStateSequence: '',
  destinationSequenceId: '',
  conditionType: '0',
  operator: '',
  valueType: '',
};

const CAMPOS_ESTADO = [
  'stateName',
  'stateDescription',
  'bpmnType',
  'stateType',
  'initialState',
  'automatic',
  'positionX',
  'positionY',
  'executionType',
  'engineAllocationId',
  'engineAllocationConfiguration',
];
const CAMPOS_CAPTURA = ['bpmnType', 'stateType', 'parentSequence'];
const CAMPOS_LIGACAO = ['initialStateSequence', 'finalStateSequence', 'returnPermited', 'defaultLink'];
const CAMPOS_REGRA = ['field', 'value', 'operator', 'valueType'];

/** Campos fora da projeção que o servidor/Studio preenche (X4) e que não contam como perda. */
const CAMPOS_X4 = ['processDiagram', 'authorName', 'creationDate', 'icon', 'processCategoryId'];

/* ------------------------------------------------------------------ */
/* Indexação                                                           */
/* ------------------------------------------------------------------ */

/** Achata a raiz (<list> com <list> filhas) em elementos. */
function elementosDe(raiz) {
  const todos = [];
  for (const c of raiz.filhos) {
    if (c.nome === 'list') todos.push(...c.filhos);
    else todos.push(c);
  }
  return todos;
}

/** Texto cru (ou '') de um campo. */
const cru = (no, nome) => {
  const t = textoDe(no, nome);
  return typeof t === 'string' ? t : '';
};

/**
 * Índice dos elementos do XML por chave. Guarda o primeiro de cada chave; as repetições ficam em
 * `ocorrencias` (chave -> quantidade) e os elementos sem chave inteira em `semChave` (elemento -> quantidade).
 */
function indexar(xml) {
  const raiz = parseXml(xml);
  if (raiz.nome !== 'list') throw new Error(`XML não é um ECM30 de processo: a raiz deve ser <list> (veio <${raiz.nome}>).`);
  const els = elementosDe(raiz);
  const doTipo = (nome) => els.filter((e) => e.nome === nome);
  const idx = {
    definicao: doTipo('ProcessDefinition')[0],
    versao: doTipo('ProcessDefinitionVersion')[0],
    estados: new Map(),
    ligacoes: new Map(),
    condicoes: new Map(),
    regras: new Map(),
    servicos: new Map(),
    ocorrencias: new Map(),
    semChave: {},
  };
  const conta = (chave) => idx.ocorrencias.set(chave, (idx.ocorrencias.get(chave) || 0) + 1);
  const registrar = (nomeElemento, mapa, prefixo, numeros, no) => {
    if (!numeros.every(Number.isInteger)) {
      idx.semChave[nomeElemento] = (idx.semChave[nomeElemento] || 0) + 1;
      return;
    }
    const k = numeros.join(':');
    conta(`${prefixo}${k}`);
    const chaveMapa = numeros.length === 1 ? numeros[0] : k;
    if (!mapa.has(chaveMapa)) mapa.set(chaveMapa, no);
  };
  if (idx.definicao) for (let i = 0; i < doTipo('ProcessDefinition').length; i += 1) conta('ProcessDefinition');
  if (idx.versao) for (let i = 0; i < doTipo('ProcessDefinitionVersion').length; i += 1) conta('ProcessDefinitionVersion');
  for (const no of doTipo('ProcessState')) {
    registrar('ProcessState', idx.estados, 'S', [inteiro(textoDe(filho(no, 'processStatePK'), 'sequence'))], no);
  }
  for (const no of doTipo('ProcessLink')) {
    registrar('ProcessLink', idx.ligacoes, 'L', [inteiro(textoDe(filho(no, 'processLinkPK'), 'linkSequence'))], no);
  }
  for (const no of doTipo('ConditionProcessState')) {
    const pk = filho(no, 'conditionProcessStatePK');
    registrar('ConditionProcessState', idx.condicoes, 'C', [inteiro(textoDe(pk, 'sequence')), inteiro(textoDe(pk, 'expressionOrder'))], no);
  }
  for (const no of doTipo('ConditionProcessAutomaticRules')) {
    registrar(
      'ConditionProcessAutomaticRules',
      idx.regras,
      'R',
      [inteiro(textoDe(no, 'sequence')), inteiro(textoDe(no, 'expressionOrder')), inteiro(textoDe(no, 'ruleOrder'))],
      no
    );
  }
  for (const no of doTipo('ProcessStateService')) {
    registrar('ProcessStateService', idx.servicos, 'V', [inteiro(textoDe(no, 'sequence'))], no);
  }
  return idx;
}

/**
 * Ligações automáticas por prazo que têm gêmea manual (mesma origem e mesmo destino, `automaticLink` falso).
 * O leitor as descarta; saem da comparação como elemento inteiro. Devolve Map(seq da automática -> seq da manual).
 */
function automaticasDescartadas(idx) {
  const descartadas = new Map();
  const ehAuto = (no) => aparar(cru(no, 'automaticLink')).toLowerCase() === 'true';
  const par = (no) => `${inteiro(textoDe(no, 'initialStateSequence'))}\u0000${inteiro(textoDe(no, 'finalStateSequence'))}`;
  const manualPorPar = new Map();
  for (const [seq, no] of idx.ligacoes) {
    if (!ehAuto(no) && !manualPorPar.has(par(no))) manualPorPar.set(par(no), seq);
  }
  for (const [seq, no] of idx.ligacoes) {
    if (ehAuto(no) && manualPorPar.has(par(no))) descartadas.set(seq, manualPorPar.get(par(no)));
  }
  return descartadas;
}

/* ------------------------------------------------------------------ */
/* Projeção                                                            */
/* ------------------------------------------------------------------ */

/** Valor de um campo na projeção (texto exato; número/booleano normalizado). */
function valorCampo(no, campo) {
  const t = cru(no, campo);
  if (Object.prototype.hasOwnProperty.call(PADRAO_NUM, campo)) {
    const n = t.trim().toLowerCase();
    return n === '' ? PADRAO_NUM[campo] : n;
  }
  return t;
}

function projetarCampos(no, campos, chave, excluir) {
  const obj = {};
  for (const c of campos) {
    if (excluir.has(`${chave}.${c}`)) continue;
    obj[c] = valorCampo(no, c);
  }
  return obj;
}

/**
 * Projeção v1 de um XML ECM30 (ver plano §3.1).
 * @param {string} xml
 * @param {{versaoAlvo?: string, semProcessId?: boolean, excluir?: Set<string>}} opcoes `excluir`: "chave.campo" a omitir
 * @returns {{processo, versao, estados: Map, ligacoes: Map, condicoes: Map, regras: Map, servicos: Set}}
 */
export function projetarXml(xml, { versaoAlvo = '1.8.2', semProcessId = false, excluir = new Set() } = {}) {
  const idx = indexar(xml);
  return projetarIndice(idx, { versaoAlvo, semProcessId, excluir });
}

function projetarIndice(idx, { versaoAlvo, semProcessId, excluir }) {
  const processo = {};
  if (idx.definicao) {
    if (!semProcessId) processo.processId = aparar(textoDe(filho(idx.definicao, 'processDefinitionPK'), 'processId'));
    processo.processDescription = cru(idx.definicao, 'processDescription');
  }
  const versao = {};
  if (idx.versao) {
    Object.assign(versao, projetarCampos(idx.versao, versaoAlvo === '2.0' ? ['formId', 'formIdV2'] : ['formId'], 'ProcessDefinitionVersion', excluir));
  }
  const estados = new Map();
  for (const [seq, no] of idx.estados) {
    const chave = `S${seq}`;
    const ehCaptura = aparar(cru(no, 'bpmnType')) === '43';
    estados.set(chave, projetarCampos(no, ehCaptura ? CAMPOS_CAPTURA : CAMPOS_ESTADO, chave, excluir));
  }
  const ligacoes = new Map();
  const descartadas = automaticasDescartadas(idx);
  for (const [seq, no] of idx.ligacoes) {
    if (descartadas.has(seq)) continue;
    ligacoes.set(`L${seq}`, projetarCampos(no, CAMPOS_LIGACAO, `L${seq}`, excluir));
  }
  const condicoes = new Map();
  for (const [k, no] of idx.condicoes) {
    const chave = `C${k}`;
    const tipo = valorCampo(no, 'conditionType');
    const campos = ['destinationSequenceId', 'conditionType'];
    if (tipo === '0') campos.push('condition');
    if (versaoAlvo === '2.0') campos.push('conditionName');
    condicoes.set(chave, projetarCampos(no, campos, chave, excluir));
  }
  const regras = new Map();
  for (const [k, no] of idx.regras) regras.set(`R${k}`, projetarCampos(no, CAMPOS_REGRA, `R${k}`, excluir));
  const servicos = new Set([...idx.servicos.keys()].map((s) => `V${s}`));
  return { processo, versao, estados, ligacoes, condicoes, regras, servicos, ocorrencias: idx.ocorrencias, semChave: idx.semChave };
}

/* ------------------------------------------------------------------ */
/* Comparação                                                          */
/* ------------------------------------------------------------------ */

function compararCampos(chave, a, b, difs) {
  const campos = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const campo of campos) {
    const x = a[campo] === undefined ? '' : a[campo];
    const y = b[campo] === undefined ? '' : b[campo];
    if (x !== y) difs.push({ chave, campo, original: x, gerado: y });
  }
}

function compararMapas(a, b, difs) {
  const chaves = new Set([...a.keys(), ...b.keys()]);
  for (const chave of chaves) {
    if (!b.has(chave)) difs.push({ chave, campo: '(elemento)', original: 'presente', gerado: 'ausente' });
    else if (!a.has(chave)) difs.push({ chave, campo: '(elemento)', original: 'ausente', gerado: 'presente' });
    else compararCampos(chave, a.get(chave), b.get(chave), difs);
  }
}

function compararProjecoes(a, b) {
  const difs = [];
  compararCampos('ProcessDefinition', a.processo, b.processo, difs);
  compararCampos('ProcessDefinitionVersion', a.versao, b.versao, difs);
  compararMapas(a.estados, b.estados, difs);
  compararMapas(a.ligacoes, b.ligacoes, difs);
  compararMapas(a.condicoes, b.condicoes, difs);
  compararMapas(a.regras, b.regras, difs);
  const chavesServ = new Set([...a.servicos, ...b.servicos]);
  for (const chave of chavesServ) {
    if (!b.servicos.has(chave)) difs.push({ chave, campo: '(elemento)', original: 'presente', gerado: 'ausente' });
    else if (!a.servicos.has(chave)) difs.push({ chave, campo: '(elemento)', original: 'ausente', gerado: 'presente' });
  }
  // elementos repetidos ou sem chave legível (nos dois lados)
  for (const chave of new Set([...a.ocorrencias.keys(), ...b.ocorrencias.keys()])) {
    const x = a.ocorrencias.get(chave) || 0;
    const y = b.ocorrencias.get(chave) || 0;
    if ((x > 0 && y > 0 && x !== y) || x > 1 || y > 1) difs.push({ chave, campo: '(duplicado)', original: x, gerado: y });
  }
  for (const nome of new Set([...Object.keys(a.semChave), ...Object.keys(b.semChave)])) {
    const x = a.semChave[nome] || 0;
    const y = b.semChave[nome] || 0;
    if (x > 0 || y > 0) difs.push({ chave: nome, campo: '(sem chave)', original: x, gerado: y });
  }
  return difs;
}

/**
 * Diferenças da projeção v1 entre dois XML ECM30 (sem ler nem gerar nada).
 * @param {string} original
 * @param {string} gerado
 * @param {{versaoAlvo?: string, semProcessId?: boolean, excluir?: Set<string>}} opcoes
 * @returns {Array<{chave: string, campo: string, original: string, gerado: string}>}
 */
export function compararXml(original, gerado, opcoes = {}) {
  return compararProjecoes(projetarXml(original, opcoes), projetarXml(gerado, opcoes));
}

/* ------------------------------------------------------------------ */
/* Exclusões por item (E1..E5)                                         */
/* ------------------------------------------------------------------ */

/** Decide, pelo conteúdo do original, o que sai da projeção. Devolve { excluir, exclusoes }. */
function exclusoesDoOriginal(idx) {
  const excluir = new Set();
  const textos = [];
  const descartadas = automaticasDescartadas(idx);
  for (const [seq, no] of idx.estados) {
    const bpmn = aparar(cru(no, 'bpmnType'));
    if (bpmn === '43') continue;
    const mec = aparar(cru(no, 'engineAllocationId'));
    const chave = `S${seq}`;
    if (bpmn === '80') {
      if (mec !== '' && mec !== 'Papel' && mec !== 'Pool Papel') {
        excluir.add(`${chave}.engineAllocationId`);
        excluir.add(`${chave}.engineAllocationConfiguration`);
        textos.push(`E1: atribuição "${mec}" de ${chave} fora da v1`);
      }
    } else if (mec !== '') {
      excluir.add(`${chave}.engineAllocationId`);
      excluir.add(`${chave}.engineAllocationConfiguration`);
      textos.push(`E2: atribuição "${mec}" em atividade não humana ${chave}`);
    }
    const exec = aparar(cru(no, 'executionType'));
    if (bpmn !== '82' && exec !== '' && exec !== '0') {
      excluir.add(`${chave}.executionType`);
      textos.push(`E3: executionType ${exec} em atividade não serviço ${chave}`);
    }
  }
  if (idx.versao) {
    const v2 = inteiro(textoDe(idx.versao, 'formIdV2'));
    if (Number.isInteger(v2) && v2 > 0) {
      excluir.add('ProcessDefinitionVersion.formIdV2');
      textos.push(`E5: formIdV2 ${v2} fora da projeção`);
    }
  }
  for (const [seq, no] of idx.ligacoes) {
    if (descartadas.has(seq)) {
      textos.push(`E6: fluxo automático por prazo L${seq} ao lado da manual L${descartadas.get(seq)}, descartado (fora da v1)`);
    } else if (aparar(cru(no, 'automaticLink')).toLowerCase() === 'true') {
      textos.push(`E4: fluxo automático por prazo em L${seq} (automaticLink fora da projeção)`);
    }
  }
  return { excluir, exclusoes: textos };
}

/* ------------------------------------------------------------------ */
/* Cobertura                                                           */
/* ------------------------------------------------------------------ */

const soma = (obj, chave, n = 1) => {
  obj[chave] = (obj[chave] || 0) + n;
};

/** Campos folha (sem filhos, fora de *PK e controle) de um nó que não estão na projeção. */
function camposForaDaProjecao(no, projetados) {
  const nomes = [];
  for (const f of no.filhos) {
    if (f.filhos.length > 0 || f.nome.endsWith('PK')) continue;
    if (projetados.includes(f.nome) || CAMPOS_X4.includes(f.nome)) continue;
    if (['companyId', 'processId', 'version', 'sequence', 'openInstances', 'destinationStates'].includes(f.nome)) continue;
    if (nomes.includes(f.nome)) continue;
    nomes.push(f.nome);
  }
  return nomes;
}

function contarPerdas(idxOrig, idxGer) {
  const perdas = {};
  const comparar = (elemento, a, b, projetados) => {
    if (!a || !b) return;
    const nomes = new Set([...camposForaDaProjecao(a, projetados), ...camposForaDaProjecao(b, projetados)]);
    for (const nome of nomes) {
      if (aparar(cru(a, nome)) !== aparar(cru(b, nome))) soma(perdas, `${elemento}.${nome}`);
    }
  };
  comparar('ProcessDefinition', idxOrig.definicao, idxGer.definicao, ['processDescription']);
  comparar('ProcessDefinitionVersion', idxOrig.versao, idxGer.versao, ['formId', 'formIdV2']);
  for (const [seq, no] of idxOrig.estados) {
    const ger = idxGer.estados.get(seq);
    if (!ger) continue;
    const captura = aparar(cru(no, 'bpmnType')) === '43';
    const proj = captura ? [...CAMPOS_CAPTURA, 'positionX', 'positionY'] : CAMPOS_ESTADO;
    comparar('ProcessState', no, ger, proj);
  }
  for (const [seq, no] of idxOrig.ligacoes) comparar('ProcessLink', no, idxGer.ligacoes.get(seq), CAMPOS_LIGACAO);
  for (const [seq, no] of idxOrig.servicos) comparar('ProcessStateService', no, idxGer.servicos.get(seq), []);
  return perdas;
}

/** Cobertura calculada do XML original e da leitura (independe de a geração rodar). */
function calcularCobertura(idx, leitura) {
  const { spec, ignorados, avisos } = leitura;
  const tipoPorId = new Map(spec.atividades.map((a) => [a.id, a.tipo]));

  const foraV1 = {};
  let nForaV1 = 0;
  for (const a of spec.atividades) {
    if (!Object.prototype.hasOwnProperty.call(TIPOS, a.tipo)) {
      soma(foraV1, a.tipo);
      nForaV1 += 1;
    }
  }
  const regeradas = ignorados.filter((i) => i.codigo === 'I_CAPTURA_ERRO_REGERADA').length;
  const totalAtiv = idx.estados.size;

  const v1Id = (id) => Object.prototype.hasOwnProperty.call(TIPOS, tipoPorId.get(id));
  const pares = new Set();
  for (const l of spec.ligacoes) if (v1Id(l.de) && v1Id(l.para)) pares.add(`${l.de}\u0000${l.para}`);
  // a ligação captura -> tratamento (uma por tratamentoErro lido) é ligação v1, mesmo fora de `ligacoes`
  const ligacoesTratamento = spec.atividades.filter((x) => typeof x.tratamentoErro === 'string').length;
  let automaticas = 0;
  let padrao = 0;
  for (const no of idx.ligacoes.values()) {
    if (aparar(cru(no, 'automaticLink')).toLowerCase() === 'true') automaticas += 1;
    if (aparar(cru(no, 'defaultLink')).toLowerCase() === 'true') padrao += 1;
  }

  let js = 0;
  let porRegras = 0;
  for (const no of idx.condicoes.values()) {
    if (valorCampo(no, 'conditionType') === '1') porRegras += 1;
    else js += 1;
  }
  const condV1 = spec.ligacoes.filter((l) => l.condicao !== undefined).length;
  const regrasV1 = spec.ligacoes.reduce((n, l) => n + (l.condicao && Array.isArray(l.condicao.regras) ? l.condicao.regras.length : 0), 0);

  const atribV1 = { papel: 0, pool_papel: 0 };
  const atribFora = {};
  let atribTotal = 0;
  const respPorId = new Map(spec.atividades.map((a) => [a.id, a.responsavel]));
  for (const [seq, no] of idx.estados) {
    const mec = aparar(cru(no, 'engineAllocationId'));
    if (mec === '') continue;
    atribTotal += 1;
    const resp = respPorId.get(`s${seq}`);
    if (resp) atribV1[resp.tipo] += 1;
    else soma(atribFora, mec);
  }

  const ign = {};
  for (const i of ignorados) soma(ign, i.codigo);
  const avi = {};
  for (const a of avisos) soma(avi, a.codigo);

  return {
    atividades: { total: totalAtiv, v1: totalAtiv - nForaV1, capturasRegeradas: regeradas, foraV1 },
    ligacoes: { total: idx.ligacoes.size, v1: pares.size + ligacoesTratamento, automaticas, padrao },
    condicoes: { total: idx.condicoes.size, js, regras: porRegras, v1: condV1 },
    regras: { total: idx.regras.size, v1: regrasV1 },
    atribuicoes: { total: atribTotal, v1: atribV1, foraV1: atribFora },
    ignorados: ign,
    avisos: avi,
    perdas: {},
  };
}

/* ------------------------------------------------------------------ */
/* Spec idempotente                                                    */
/* ------------------------------------------------------------------ */

function ordenarSpec(spec, sequencias) {
  const ordem = (a) => (Number.isInteger(sequencias[a.id]) ? sequencias[a.id] : Number.MAX_SAFE_INTEGER);
  return { ...spec, atividades: [...spec.atividades].sort((x, y) => ordem(x) - ordem(y)) };
}

function compararSpecs(original, relida, sequencias, difs) {
  const a = ordenarSpec(original, sequencias);
  const b = ordenarSpec(relida, sequencias);
  const campos = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const campo of campos) {
    const x = JSON.stringify(a[campo]);
    const y = JSON.stringify(b[campo]);
    if (x !== y) difs.push({ chave: 'spec', campo, original: x === undefined ? '' : x, gerado: y === undefined ? '' : y });
  }
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Faz a ida e volta de um XML ECM30 e compara na projeção v1.
 * @param {string} xml
 * @param {{versaoAlvo?: '1.8.2'|'2.0', processIdSubstituto?: (id: string) => string}} opcoes
 */
export async function compararIdaEVolta(xml, { versaoAlvo = '1.8.2', processIdSubstituto } = {}) {
  const resultado = {
    processId: '',
    resultado: 'erro',
    diferencas: [],
    motivos: [],
    exclusoes: [],
    cobertura: null,
  };
  const erro = (codigo, mensagem) => {
    resultado.resultado = 'erro';
    resultado.motivos.push({ codigo, mensagem });
    return resultado;
  };

  let idx;
  let leitura;
  try {
    idx = indexar(xml);
    leitura = lerXmlProcesso(xml);
  } catch (e) {
    return erro('E_LEITOR', e.message);
  }
  resultado.processId = leitura.spec.processId;
  resultado.cobertura = calcularCobertura(idx, leitura);

  let spec = leitura.spec;
  let validacao = await validarSpec(spec, { versaoAlvo });
  let semProcessId = false;
  if (!validacao.ok && validacao.erros.some((e) => e.codigo === 'E_PROCESSID') && typeof processIdSubstituto === 'function') {
    const novo = processIdSubstituto(spec.processId);
    resultado.exclusoes.push(`processId substituído: "${spec.processId}" -> "${novo}"`);
    spec = { ...spec, processId: novo };
    semProcessId = true;
    validacao = await validarSpec(spec, { versaoAlvo });
  }
  if (!validacao.ok) {
    resultado.motivos = validacao.erros.map((e) => ({ codigo: e.codigo, mensagem: e.mensagem }));
    resultado.resultado = validacao.erros.every((e) => FORA_V1.includes(e.codigo)) ? 'fora_v1' : 'erro';
    return resultado;
  }

  const gerado = await gerarXmlProcesso(spec, { versaoAlvo, modelo: xml, origem: leitura.origem });
  if (!gerado.ok) {
    resultado.motivos = gerado.erros.map((e) => ({ codigo: e.codigo, mensagem: e.mensagem }));
    return resultado;
  }

  const { excluir, exclusoes } = exclusoesDoOriginal(idx);
  resultado.exclusoes.push(...exclusoes);
  let idxGer;
  let relida;
  try {
    idxGer = indexar(gerado.xml);
    relida = lerXmlProcesso(gerado.xml);
  } catch (e) {
    return erro('E_GERADO_ILEGIVEL', `O XML gerado não foi lido de volta: ${e.message}`);
  }

  const opcoesProj = { versaoAlvo, semProcessId, excluir };
  const difs = compararProjecoes(projetarIndice(idx, opcoesProj), projetarIndice(idxGer, opcoesProj));
  compararSpecs(spec, relida.spec, leitura.origem.sequencias, difs);
  resultado.diferencas = difs;
  resultado.cobertura.perdas = contarPerdas(idx, idxGer);
  resultado.resultado = difs.length === 0 ? 'igual' : 'diferente';
  return resultado;
}

/* ------------------------------------------------------------------ */
/* Relatório                                                           */
/* ------------------------------------------------------------------ */

/** Texto "o que ficou de fora": tipos fora da v1, atribuições fora da v1 e perdas, do maior para o menor. */
function principais(c, limite = 6) {
  const itens = [];
  for (const [k, n] of Object.entries(c.atividades.foraV1)) itens.push([k, n]);
  for (const [k, n] of Object.entries(c.atribuicoes.foraV1)) itens.push([k, n]);
  const porCampo = {};
  for (const [k, n] of Object.entries(c.perdas)) soma(porCampo, k.slice(k.indexOf('.') + 1), n);
  for (const [k, n] of Object.entries(porCampo)) itens.push([k, n]);
  const unicos = new Map();
  for (const [k, n] of itens) unicos.set(k, (unicos.get(k) || 0) + n);
  return [...unicos.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limite)
    .map(([k, n]) => `${k} ${n}`)
    .join('; ');
}

const fracao = (a, b) => `${a}/${b}`;

/**
 * Tabela de texto (uma linha por XML e uma de total).
 * `a/b` = reproduzido pela v1 / total no original.
 * @param {Array<{nome?: string, processId: string, resultado: string, cobertura: object|null}>} resultados
 */
export function formatarCobertura(resultados) {
  const larguras = [28, 10, 6, 6, 6, 6, 6];
  const linha = (cols, ultima) => cols.map((c, i) => String(c).padEnd(larguras[i])).join(' ') + ' ' + ultima;
  const saida = [linha(['processo', 'resultado', 'ativ', 'lig', 'cond', 'regras', 'atrib'], 'fora da v1 / perdas principais')];
  const t = { a: [0, 0], l: [0, 0], c: [0, 0], r: [0, 0], at: [0, 0] };
  for (const r of resultados) {
    const rotulo = String(r.nome || r.processId || '?');
    const c = r.cobertura;
    if (!c) {
      saida.push(linha([rotulo, r.resultado, '-', '-', '-', '-', '-'], (r.motivos || []).map((m) => m.codigo).join('; ')));
      continue;
    }
    const atV1 = c.atribuicoes.v1.papel + c.atribuicoes.v1.pool_papel;
    t.a[0] += c.atividades.v1;
    t.a[1] += c.atividades.total;
    t.l[0] += c.ligacoes.v1;
    t.l[1] += c.ligacoes.total;
    t.c[0] += c.condicoes.v1;
    t.c[1] += c.condicoes.total;
    t.r[0] += c.regras.v1;
    t.r[1] += c.regras.total;
    t.at[0] += atV1;
    t.at[1] += c.atribuicoes.total;
    saida.push(
      linha(
        [
          rotulo,
          r.resultado,
          fracao(c.atividades.v1, c.atividades.total),
          fracao(c.ligacoes.v1, c.ligacoes.total),
          fracao(c.condicoes.v1, c.condicoes.total),
          fracao(c.regras.v1, c.regras.total),
          fracao(atV1, c.atribuicoes.total),
        ],
        principais(c)
      )
    );
  }
  const contagem = {};
  for (const r of resultados) soma(contagem, r.resultado);
  saida.push(
    linha(
      ['TOTAL', `${resultados.length} xml`, fracao(...t.a), fracao(...t.l), fracao(...t.c), fracao(...t.r), fracao(...t.at)],
      Object.entries(contagem)
        .map(([k, n]) => `${k} ${n}`)
        .join('; ')
    )
  );
  return saida.join('\n');
}
