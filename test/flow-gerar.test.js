import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarXmlProcesso, escaparXml } from '../src/flow/gerar.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { parseXml, filho, textoDe } from '../src/flow/xml.js';
import { OPERADORES } from '../src/flow/spec.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');
const VERSOES = ['1.8.2', '2.0'];
const codigos = (itens) => itens.map((i) => i.codigo);
const clone = (o) => JSON.parse(JSON.stringify(o));

/* ------------------------------------------------------------------ */
/* Specs sintéticas                                                    */
/* ------------------------------------------------------------------ */

const ini = { id: 'ini', tipo: 'inicio', nome: 'Início' };
const fimOk = { id: 'fim', tipo: 'fim', nome: 'Concluído' };

/** S1 mínima: inicio -> humana (pool_papel) -> fim, com formId e posições. */
const S1 = () => ({
  processId: 'proc_min',
  descricao: 'Processo mínimo',
  formId: 10,
  atividades: [
    { ...ini, posicao: { x: 100, y: 120 } },
    { id: 'sol', tipo: 'humana', nome: 'Solicitar', responsavel: { tipo: 'pool_papel', valor: 'compras' }, posicao: { x: 300, y: 120 } },
    { ...fimOk, posicao: { x: 500, y: 120 } },
  ],
  ligacoes: [
    { de: 'ini', para: 'sol' },
    { de: 'sol', para: 'fim' },
  ],
});

/** S2 gateway: regras (E), JS com aspas, retorno e duas ligações OU para o cancelamento. */
const S2 = (com20 = false) => {
  const nome = (n) => (com20 ? { nome: n } : {});
  return {
    processId: 'proc_gateway',
    descricao: 'Processo com gateway',
    formId: 20,
    atividades: [
      ini,
      { id: 'hum', tipo: 'humana', nome: 'Analisar', responsavel: { tipo: 'papel', valor: 'gestor' } },
      { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Aprovado?' },
      fimOk,
      { id: 'canc', tipo: 'cancelamento', nome: 'Cancelado' },
    ],
    ligacoes: [
      { de: 'ini', para: 'hum' },
      { de: 'hum', para: 'gw' },
      {
        de: 'gw',
        para: 'fim',
        ordem: 1,
        condicao: {
          regras: [
            { campo: 'aprovado', op: 'igual', valor: 'sim' },
            { campo: 'valor', op: 'igual', valor: 'limite', valorTipo: 'campo' },
          ],
          ...nome('Aprovado'),
        },
      },
      {
        de: 'gw',
        para: 'hum',
        ordem: 2,
        condicao: { js: 'hAPI.getCardValue("aprovado") == "revisar"', ...nome('Revisar') },
        retorno: true,
      },
      { de: 'gw', para: 'canc', ordem: 3, condicao: { regras: [{ campo: 'aprovado', op: 'igual', valor: 'nao' }] } },
      { de: 'gw', para: 'canc', ordem: 4, condicao: { js: 'hAPI.getCardValue("aprovado") == "cancelar"' } },
    ],
  };
};

/** S3 serviços: um automatizado (com captura de erro) e um imediato. */
const S3 = () => ({
  processId: 'proc_servicos',
  descricao: 'Processo com serviços',
  formId: 30,
  atividades: [
    ini,
    { id: 'auto', tipo: 'servico', nome: 'Integrar', execucao: 'automatizada' },
    { id: 'imed', tipo: 'servico', nome: 'Registrar', execucao: 'imediata' },
    fimOk,
  ],
  ligacoes: [
    { de: 'ini', para: 'auto' },
    { de: 'auto', para: 'imed' },
    { de: 'imed', para: 'fim' },
  ],
});

/** S4 paralelo: abertura -> 2 ramos humanos -> junção -> fim terminativo. */
const S4 = () => ({
  processId: 'proc_paralelo',
  descricao: 'Processo paralelo',
  formId: 40,
  atividades: [
    ini,
    { id: 'ab', tipo: 'gateway_paralelo_abertura', nome: 'Abertura' },
    { id: 'h1', tipo: 'humana', nome: 'Ramo 1', responsavel: { tipo: 'papel', valor: 'rh' } },
    { id: 'h2', tipo: 'humana', nome: 'Ramo 2', responsavel: { tipo: 'papel', valor: 'ti' } },
    { id: 'ju', tipo: 'gateway_paralelo_juncao', nome: 'Junção' },
    { id: 'ft', tipo: 'fim_terminativo', nome: 'Encerrado' },
  ],
  ligacoes: [
    { de: 'ini', para: 'ab' },
    { de: 'ab', para: 'h1' },
    { de: 'ab', para: 'h2' },
    { de: 'h1', para: 'ju' },
    { de: 'h2', para: 'ju' },
    { de: 'ju', para: 'ft' },
  ],
});

/** S5 operadores: um gateway com uma saída por operador. */
const S5 = () => {
  const ops = Object.keys(OPERADORES);
  const regra = (op, i) => {
    if (op === 'vazio' || op === 'preenchido') return { campo: `campo${i}`, op };
    if (op === 'igual') return { campo: `campo${i}`, op, valor: 5 };
    return { campo: `campo${i}`, op, valor: `v${i}` };
  };
  return {
    processId: 'proc_operadores',
    descricao: 'Processo com operadores',
    formId: 50,
    atividades: [
      ini,
      { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Qual?' },
      { id: 'fimA', tipo: 'fim', nome: 'Fim A' },
      { id: 'fimB', tipo: 'fim', nome: 'Fim B' },
    ],
    ligacoes: [
      { de: 'ini', para: 'gw' },
      ...ops.map((op, i) => ({
        de: 'gw',
        para: i % 2 === 0 ? 'fimA' : 'fimB',
        ordem: i + 1,
        condicao: { regras: [regra(op, i)] },
      })),
    ],
  };
};

/** S6 escape: caracteres especiais, acentos e quebra de linha em nomes, descrição, papel e JS. */
const S6 = () => ({
  processId: 'proc_escape',
  descricao: 'Descrição & <teste> "aspas" \'apos\'\r\nSegunda linha',
  formId: 60,
  atividades: [
    { id: 'ini', tipo: 'inicio', nome: 'Início & <fim>' },
    { id: 'hum', tipo: 'humana', nome: 'Atenção "x" \'y\'\r\nz', responsavel: { tipo: 'papel', valor: 'a&b' } },
    { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Será?' },
    fimOk,
    { id: 'canc', tipo: 'cancelamento', nome: 'Não' },
  ],
  ligacoes: [
    { de: 'ini', para: 'hum' },
    { de: 'hum', para: 'gw' },
    { de: 'gw', para: 'fim', ordem: 1, condicao: { js: 'if (a < b && x == "y") { return true; }' } },
    { de: 'gw', para: 'canc', ordem: 2, condicao: { js: 'return a > b;' } },
  ],
});

const TODAS = { S1, S2, S3, S4, S5, S6 };

async function gerar(spec, versaoAlvo = '1.8.2', extra = {}) {
  const r = await gerarXmlProcesso(spec, { versaoAlvo, ...extra });
  assert.equal(r.ok, true, `geração falhou: ${JSON.stringify(r.erros)}`);
  return r;
}

/* Leitura do XML gerado */
const bloco = (raiz, nome) => raiz.filhos.find((c) => c.nome === 'list' && c.filhos.length > 0 && c.filhos[0].nome === nome);
const estadosDe = (raiz) => (bloco(raiz, 'ProcessState') ? bloco(raiz, 'ProcessState').filhos : []);
const seqDe = (no) => Number(textoDe(filho(no, 'processStatePK'), 'sequence'));
const porBpmn = (raiz, bpmn) => estadosDe(raiz).filter((e) => textoDe(e, 'bpmnType') === String(bpmn));

/* ------------------------------------------------------------------ */
/* 1. Recusa                                                           */
/* ------------------------------------------------------------------ */

test('recusa: spec inválida devolve os erros do validador, sem xml', async () => {
  const spec = S1();
  spec.atividades = spec.atividades.filter((a) => a.id !== 'fim');
  spec.ligacoes = [{ de: 'ini', para: 'sol' }];
  const r = await gerarXmlProcesso(spec, { versaoAlvo: '1.8.2' });
  assert.equal(r.ok, false);
  assert.equal(r.xml, undefined);
  assert.ok(codigos(r.erros).includes('E_FIM_AUSENTE'));
  assert.ok(Array.isArray(r.avisos));
});

test('recusa: versaoAlvo ausente é erro do validador', async () => {
  const r = await gerarXmlProcesso(S1(), {});
  assert.equal(r.ok, false);
  assert.ok(codigos(r.erros).includes('E_VERSAO_ALVO'));
});

test('recusa: caractere de controle num nome -> E_GERADOR_CARACTERE com o caminho', async () => {
  const spec = S1();
  spec.atividades[1].nome = 'Solicitar\u0001';
  const r = await gerarXmlProcesso(spec, { versaoAlvo: '1.8.2' });
  assert.equal(r.ok, false);
  const e = r.erros.find((x) => x.codigo === 'E_GERADOR_CARACTERE');
  assert.ok(e);
  assert.equal(e.caminho, 'atividades[1].nome');
});

test('recusa: surrogate sozinho e U+FFFE também são recusados; par válido passa', async () => {
  for (const ruim of ['a\uD800b', 'a\uDC00', 'a￾b']) {
    const spec = S1();
    spec.descricao = ruim;
    const r = await gerarXmlProcesso(spec, { versaoAlvo: '1.8.2' });
    assert.equal(r.ok, false, JSON.stringify(ruim));
    assert.equal(r.erros.find((x) => x.codigo === 'E_GERADOR_CARACTERE').caminho, 'descricao');
  }
  const bom = S1();
  bom.descricao = 'Emoji 😀 e tab\te';
  assert.equal((await gerarXmlProcesso(bom, { versaoAlvo: '1.8.2' })).ok, true);
});

test('recusa: modelo ilegível ou sem ProcessDefinition -> E_MODELO', async () => {
  for (const modelo of ['lixo', '<list/>', '<outro><x/></outro>', 42]) {
    const r = await gerarXmlProcesso(S1(), { versaoAlvo: '1.8.2', modelo });
    assert.equal(r.ok, false, String(modelo));
    assert.ok(codigos(r.erros).includes('E_MODELO'), String(modelo));
  }
});

test('recusa: origem com número repetido, inválido ou fora do formato -> E_GERADOR_ORIGEM', async () => {
  const casos = [
    { sequencias: { ini: 5, sol: 5 } },
    { sequencias: { ini: 0 } },
    { sequencias: { ini: 1.5 } },
    { linkSequences: [7, 7] },
    { linkSequences: [-1] },
    { sequencias: [] },
    { linkSequences: 'x' },
  ];
  for (const origem of casos) {
    const r = await gerarXmlProcesso(S1(), { versaoAlvo: '1.8.2', origem });
    assert.equal(r.ok, false, JSON.stringify(origem));
    assert.ok(codigos(r.erros).includes('E_GERADOR_ORIGEM'), JSON.stringify(origem));
  }
  const r = await gerarXmlProcesso(S1(), { versaoAlvo: '1.8.2', origem: { sequencias: { ini: 5, sol: 5 } } });
  assert.equal(r.erros[0].caminho, 'origem.sequencias.sol');
});

/* ------------------------------------------------------------------ */
/* 2. Ida e volta                                                      */
/* ------------------------------------------------------------------ */

const IGNORADOS_ESPERADOS = new Set([
  'I_CAPTURA_ERRO_REGERADA',
  'I_ATIVIDADE_CAMPOS',
  'I_PROCESSO_CAMPOS',
  'I_LIGACAO_CAMPOS',
  'I_SERVICO_CONFIG',
]);

function normRegra(r) {
  const o = { campo: r.campo, op: r.op, valorTipo: r.valorTipo === undefined ? 'fixo' : r.valorTipo };
  if (r.valor !== undefined && r.valor !== null) o.valor = String(r.valor);
  return o;
}

function normCondicao(c, com20) {
  if (c === undefined) return null;
  const o = {};
  if (c.regras) o.regras = c.regras.map(normRegra);
  else o.js = c.js;
  if (com20 && c.nome) o.nome = c.nome;
  return o;
}

for (const [rotulo, montar] of Object.entries(TODAS)) {
  for (const versao of VERSOES) {
    test(`ida e volta ${rotulo} (${versao}): ler(gerar(spec)) == spec`, async () => {
      const spec = montar(versao === '2.0');
      const r = await gerar(spec, versao);
      const lido = lerXmlProcesso(r.xml);

      assert.deepEqual(lido.avisos, [], JSON.stringify(lido.avisos));
      for (const ig of lido.ignorados) assert.ok(IGNORADOS_ESPERADOS.has(ig.codigo), `ignorado inesperado: ${ig.codigo}`);

      // ids s<n> de volta para os ids da spec
      const inverso = {};
      for (const [id, n] of Object.entries(r.sequencias)) inverso[`s${n}`] = id;
      const volta = (id) => inverso[id];

      assert.equal(lido.spec.processId, spec.processId);
      assert.equal(lido.spec.descricao, spec.descricao ?? spec.processId);
      assert.equal(lido.spec.formId, spec.formId);

      assert.equal(lido.spec.atividades.length, spec.atividades.length);
      const lidasPorId = new Map(lido.spec.atividades.map((a) => [volta(a.id), a]));
      for (const a of spec.atividades) {
        const l = lidasPorId.get(a.id);
        assert.ok(l, `atividade ${a.id} não voltou`);
        assert.equal(l.tipo, a.tipo);
        assert.equal(l.nome, a.nome);
        assert.deepEqual(l.responsavel, a.responsavel);
        assert.equal(l.execucao, a.execucao);
        if (a.posicao) assert.deepEqual(l.posicao, a.posicao);
      }

      const tipoPorId = Object.fromEntries(spec.atividades.map((a) => [a.id, a.tipo]));
      const normLigacao = (l) =>
        JSON.stringify({
          de: l.de,
          para: l.para,
          ordem: l.ordem ?? null,
          condicao: normCondicao(l.condicao, versao === '2.0'),
          retorno: l.retorno === true,
        });
      const lidas = lido.spec.ligacoes.map((l) => ({ ...l, de: volta(l.de), para: volta(l.para) }));
      assert.deepEqual(lidas.map(normLigacao).sort(), spec.ligacoes.map(normLigacao).sort());

      // fora das saídas de gateway exclusivo a ordem também se mantém
      const foraGateway = (ls) => ls.filter((l) => tipoPorId[l.de] !== 'gateway_exclusivo').map((l) => `${l.de}>${l.para}:${l.retorno === true}`);
      assert.deepEqual(foraGateway(lidas), foraGateway(spec.ligacoes));
    });
  }
}

/* ------------------------------------------------------------------ */
/* 3. Estrutura × fixtures do demo                                     */
/* ------------------------------------------------------------------ */

const assinatura = (no) =>
  no.filhos.map((f) => (f.filhos.length > 0 ? `${f.nome}{${f.filhos.map((g) => g.nome).join(',')}}` : f.nome)).join(' ');

function chaveElemento(e) {
  if (e.nome === 'ProcessState') return `ProcessState|${textoDe(e, 'bpmnType')}|${textoDe(e, 'executionType') ?? ''}`;
  if (e.nome === 'ConditionProcessState') return `ConditionProcessState|${textoDe(e, 'conditionType')}`;
  return e.nome;
}

function elementosDe(raiz) {
  const todos = [];
  for (const c of raiz.filhos) {
    if (c.nome === 'list') todos.push(...c.filhos);
    else todos.push(c);
  }
  return todos;
}

/** Spec que usa todos os tipos com par no demo: 10, 80, 82-1, 82-2, 43, 120 (regras e JS), 60, 65. */
const SG = () => ({
  processId: 'proc_tipos',
  descricao: 'Todos os tipos',
  formId: 70,
  atividades: [
    ini,
    { id: 'hum', tipo: 'humana', nome: 'Humana', responsavel: { tipo: 'papel', valor: 'gestor' } },
    { id: 'auto', tipo: 'servico', nome: 'Auto', execucao: 'automatizada' },
    { id: 'imed', tipo: 'servico', nome: 'Imediata', execucao: 'imediata' },
    { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Decisão' },
    fimOk,
    { id: 'canc', tipo: 'cancelamento', nome: 'Cancelado' },
  ],
  ligacoes: [
    { de: 'ini', para: 'hum' },
    { de: 'hum', para: 'auto' },
    { de: 'auto', para: 'imed' },
    { de: 'imed', para: 'gw' },
    { de: 'gw', para: 'fim', ordem: 1, condicao: { regras: [{ campo: 'a', op: 'igual', valor: 'x' }] } },
    { de: 'gw', para: 'canc', ordem: 2, condicao: { js: 'true' } },
  ],
});

const FIXTURES = ['medicao_contrato', 'rpa'].map((n) => parseXml(fixture(n)));
const POOL = new Map(); // chave -> { assinaturas: Set, exemplo: no }
for (const raiz of FIXTURES) {
  for (const e of elementosDe(raiz)) {
    const k = chaveElemento(e);
    if (!POOL.has(k)) POOL.set(k, { assinaturas: new Set(), exemplo: e });
    POOL.get(k).assinaturas.add(assinatura(e));
  }
}

test('estrutura: raiz com 20 filhos e blocos nas mesmas posições da fixture', async () => {
  const raiz = parseXml((await gerar(SG())).xml);
  assert.equal(raiz.nome, 'list');
  assert.equal(raiz.filhos.length, 20);
  for (const fix of FIXTURES) {
    assert.equal(fix.filhos.length, 20);
    for (const nome of ['ProcessState', 'ConditionProcessState', 'ProcessLink', 'ProcessStateService', 'ConditionProcessAutomaticRules']) {
      const iFix = fix.filhos.findIndex((c) => c.nome === 'list' && c.filhos[0] && c.filhos[0].nome === nome);
      const iGer = raiz.filhos.findIndex((c) => c.nome === 'list' && c.filhos[0] && c.filhos[0].nome === nome);
      if (iFix !== -1) assert.equal(iGer, iFix, nome);
    }
  }
  // os blocos que o gerador não preenche saem vazios
  const preenchidos = [2, 3, 4, 15, 19];
  raiz.filhos.forEach((c, i) => {
    if (i >= 2 && !preenchidos.includes(i)) assert.equal(c.filhos.length, 0, `bloco ${i}`);
  });
});

test('estrutura: lista de campos de cada elemento igual à de um elemento da fixture do mesmo tipo (1.8.2)', async () => {
  const raiz = parseXml((await gerar(SG())).xml);
  const vistas = new Set();
  for (const e of elementosDe(raiz)) {
    const k = chaveElemento(e);
    const par = POOL.get(k);
    assert.ok(par, `a fixture não tem par para ${k}`);
    assert.ok(par.assinaturas.has(assinatura(e)), `campos de ${k} diferem da fixture:\n${assinatura(e)}`);
    vistas.add(k);
  }
  for (const k of [
    'ProcessDefinition',
    'ProcessDefinitionVersion',
    'ProcessState|10|',
    'ProcessState|80|0',
    'ProcessState|82|1',
    'ProcessState|82|2',
    'ProcessState|43|',
    'ProcessState|120|',
    'ProcessState|60|',
    'ProcessState|65|',
    'ProcessLink',
    'ConditionProcessState|0',
    'ConditionProcessState|1',
    'ConditionProcessAutomaticRules',
    'ProcessStateService',
  ]) {
    assert.ok(vistas.has(k), `o teste não cobriu ${k}`);
  }
});

test('estrutura: stateType, bpmnType, automatic, executionType e initialState iguais aos da fixture por tipo', async () => {
  const raiz = parseXml((await gerar(SG())).xml);
  for (const e of estadosDe(raiz)) {
    const par = POOL.get(chaveElemento(e)).exemplo;
    for (const campo of ['stateType', 'bpmnType', 'automatic', 'executionType', 'initialState']) {
      assert.equal(textoDe(e, campo), textoDe(par, campo), `${chaveElemento(e)} / ${campo}`);
    }
  }
});

test('estrutura: captura de erro só no serviço automatizado e todo serviço tem ProcessStateService', async () => {
  const r = await gerar(SG());
  const raiz = parseXml(r.xml);
  const capturas = porBpmn(raiz, 43);
  assert.equal(capturas.length, 1);
  assert.equal(textoDe(capturas[0], 'parentSequence'), String(r.sequencias.auto));
  const servicos = bloco(raiz, 'ProcessStateService').filhos;
  assert.deepEqual(
    servicos.map((s) => Number(textoDe(s, 'sequence'))),
    [r.sequencias.auto, r.sequencias.imed]
  );
  // sem serviço automatizado não há captura
  const r2 = await gerar(S1());
  assert.equal(porBpmn(parseXml(r2.xml), 43).length, 0);
});

test('estrutura: 126, 127 e 68 têm os campos do 120/60 e os stateType 3, 4 e 6', async () => {
  const raiz = parseXml((await gerar(S4())).xml);
  const sig120 = [...POOL.get('ProcessState|120|').assinaturas][0];
  const sig60 = [...POOL.get('ProcessState|60|').assinaturas][0];
  for (const [bpmn, stateType] of [[126, '3'], [127, '4']]) {
    const [e] = porBpmn(raiz, bpmn);
    assert.ok(e, `bpmnType ${bpmn}`);
    assert.equal(assinatura(e), sig120);
    assert.equal(textoDe(e, 'stateType'), stateType);
    assert.equal(textoDe(e, 'automatic'), 'false');
  }
  const [t] = porBpmn(raiz, 68);
  assert.equal(assinatura(t), sig60);
  assert.equal(textoDe(t, 'stateType'), '6');
});

test('estrutura: o primeiro <processId> do texto é o da spec', async () => {
  for (const montar of Object.values(TODAS)) {
    const spec = montar();
    const r = await gerar(spec);
    assert.equal(/<processId>([^<]*)<\/processId>/.exec(r.xml)[1], spec.processId);
  }
});

test('estrutura: ProcessDefinitionVersion usa a descrição no processId da chave e formId da spec', async () => {
  const raiz = parseXml((await gerar(S1())).xml);
  const v = filho(raiz, 'ProcessDefinitionVersion');
  assert.equal(textoDe(filho(v, 'processDefinitionVersionPK'), 'processId'), 'Processo mínimo');
  assert.equal(textoDe(v, 'formId'), '10');
});

/* ------------------------------------------------------------------ */
/* 4. Versões                                                          */
/* ------------------------------------------------------------------ */

test('versões: formIdV2 e conditionName só em 2.0; campos do servidor nunca', async () => {
  const spec = S2();
  const r182 = await gerar(spec, '1.8.2');
  const r20 = await gerar(spec, '2.0');
  const raiz182 = parseXml(r182.xml);
  const raiz20 = parseXml(r20.xml);

  const nomesV = (raiz) => filho(raiz, 'ProcessDefinitionVersion').filhos.map((f) => f.nome);
  assert.ok(!nomesV(raiz182).includes('formIdV2'));
  const n20 = nomesV(raiz20);
  assert.equal(n20[n20.indexOf('formId') + 1], 'formIdV2');
  assert.equal(textoDe(filho(raiz20, 'ProcessDefinitionVersion'), 'formIdV2'), '0');

  const conds182 = bloco(raiz182, 'ConditionProcessState').filhos;
  const conds20 = bloco(raiz20, 'ConditionProcessState').filhos;
  assert.equal(conds182.length, 4);
  assert.equal(conds20.length, 4);
  for (const c of conds182) assert.equal(filho(c, 'conditionName'), undefined);
  for (const c of conds20) assert.equal(c.filhos[c.filhos.length - 1].nome, 'conditionName');

  for (const xml of [r182.xml, r20.xml]) {
    for (const proibido of ['processDiagram', 'icon', 'processCategoryId', 'authorName', 'creationDate']) {
      assert.ok(!xml.includes(`<${proibido}`), proibido);
    }
  }

  // fora esses dois campos, os XMLs são iguais
  const semV2 = r20.xml
    .split('\n')
    .filter((l) => l.trim() !== '<formIdV2>0</formIdV2>' && l.trim() !== '<conditionName></conditionName>')
    .join('\n');
  assert.equal(semV2, r182.xml);
});

test('versões: conditionName leva condicao.nome em 2.0', async () => {
  const raiz = parseXml((await gerar(S2(true), '2.0')).xml);
  const nomes = bloco(raiz, 'ConditionProcessState').filhos.map((c) => textoDe(c, 'conditionName'));
  assert.deepEqual(nomes, ['Aprovado', 'Revisar', '', '']);
});

test('versões: nome de condição em 1.8.2 é recusado pelo validador', async () => {
  const r = await gerarXmlProcesso(S2(true), { versaoAlvo: '1.8.2' });
  assert.equal(r.ok, false);
  assert.ok(codigos(r.erros).includes('E_VERSAO_RECURSO'));
});

/* ------------------------------------------------------------------ */
/* 5. Numeração                                                        */
/* ------------------------------------------------------------------ */

test('numeração: atividades a partir de 2, captura logo depois do serviço, ligações acima', async () => {
  const r = await gerar(S3());
  assert.deepEqual(r.sequencias, { ini: 2, auto: 3, imed: 5, fim: 6 });
  const raiz = parseXml(r.xml);
  assert.deepEqual(estadosDe(raiz).map(seqDe), [2, 3, 4, 5, 6]);
  assert.equal(textoDe(porBpmn(raiz, 43)[0], 'parentSequence'), '3');
  const links = bloco(raiz, 'ProcessLink').filhos;
  assert.deepEqual(
    links.map((l) => Number(textoDe(filho(l, 'processLinkPK'), 'linkSequence'))),
    [7, 8, 9]
  );
  assert.deepEqual(
    links.map((l) => [textoDe(l, 'initialStateSequence'), textoDe(l, 'finalStateSequence')]),
    [['2', '3'], ['3', '5'], ['5', '6']]
  );
});

test('numeração: S2 com OU gera 5 ProcessLink e 4 ConditionProcessState', async () => {
  const raiz = parseXml((await gerar(S2())).xml);
  const links = bloco(raiz, 'ProcessLink').filhos;
  assert.equal(links.length, 5);
  assert.equal(bloco(raiz, 'ConditionProcessState').filhos.length, 4);
  // o retorno liga gw -> hum; o OU para cancelamento é um link só
  const comRetorno = links.filter((l) => textoDe(l, 'returnPermited') === 'true');
  assert.equal(comRetorno.length, 1);
  assert.equal(textoDe(comRetorno[0], 'initialStateSequence'), '4'); // gw
  assert.equal(textoDe(comRetorno[0], 'finalStateSequence'), '3'); // hum
  // regras: só da condição por regras, uma linha por regra
  assert.equal(bloco(raiz, 'ConditionProcessAutomaticRules').filhos.length, 3);
});

test('numeração: com origem usa os números informados e o resto vem acima do maior (contador único)', async () => {
  const origem = { sequencias: { ini: 10, sol: 20 }, linkSequences: [100, null] };
  const r = await gerar(S1(), '1.8.2', { origem });
  assert.deepEqual(r.sequencias, { ini: 10, sol: 20, fim: 101 });
  const raiz = parseXml(r.xml);
  assert.deepEqual(estadosDe(raiz).map(seqDe), [10, 20, 101]);
  assert.deepEqual(
    bloco(raiz, 'ProcessLink').filhos.map((l) => Number(textoDe(filho(l, 'processLinkPK'), 'linkSequence'))),
    [100, 102]
  );
});

test('numeração: com origem a captura de erro pega número livre acima do maior', async () => {
  const r = await gerar(S3(), '1.8.2', { origem: { sequencias: { auto: 30 } } });
  // ini ganha o próximo livre acima do maior informado (31); a captura vem depois do serviço
  assert.deepEqual(r.sequencias, { ini: 31, auto: 30, imed: 33, fim: 34 });
  const raiz = parseXml(r.xml);
  const captura = porBpmn(raiz, 43)[0];
  assert.equal(textoDe(captura, 'parentSequence'), '30');
  assert.equal(seqDe(captura), 32);
  const todas = estadosDe(raiz).map(seqDe);
  assert.equal(new Set(todas).size, todas.length);
});

test('numeração: id de origem que não está na spec é ignorado com aviso', async () => {
  const r = await gerar(S1(), '1.8.2', { origem: { sequencias: { fantasma: 7 } } });
  const av = r.avisos.find((a) => a.codigo === 'W_GERADOR_ORIGEM_ID');
  assert.ok(av);
  assert.deepEqual(r.sequencias, { ini: 2, sol: 3, fim: 4 });
});

/* ------------------------------------------------------------------ */
/* 6. Layout                                                           */
/* ------------------------------------------------------------------ */

const posicoes = (raiz) => {
  const o = {};
  for (const e of estadosDe(raiz)) o[seqDe(e)] = { x: Number(textoDe(e, 'positionX')), y: Number(textoDe(e, 'positionY')), bpmn: textoDe(e, 'bpmnType') };
  return o;
};

test('layout: colunas de 250 e linhas de 150 a partir do início', async () => {
  const spec = S1();
  for (const a of spec.atividades) delete a.posicao;
  const r = await gerar(spec);
  const p = posicoes(parseXml(r.xml));
  assert.deepEqual([p[r.sequencias.ini], p[r.sequencias.sol], p[r.sequencias.fim]].map((q) => [q.x, q.y]), [
    [100, 100],
    [350, 100],
    [600, 100],
  ]);
});

test('layout: ramos paralelos e saídas de gateway ficam um embaixo do outro', async () => {
  const r = await gerar(S4());
  const p = posicoes(parseXml(r.xml));
  const q = (id) => [p[r.sequencias[id]].x, p[r.sequencias[id]].y];
  assert.deepEqual(q('ini'), [100, 100]);
  assert.deepEqual(q('ab'), [350, 100]);
  assert.deepEqual(q('h1'), [600, 100]);
  assert.deepEqual(q('h2'), [600, 250]);
  assert.deepEqual(q('ju'), [850, 100]);
  assert.deepEqual(q('ft'), [1100, 100]);

  // laço de retorno não empurra coluna: em S2 o gateway volta à humana
  const r2 = await gerar(S2());
  const p2 = posicoes(parseXml(r2.xml));
  const q2 = (id) => [p2[r2.sequencias[id]].x, p2[r2.sequencias[id]].y];
  assert.deepEqual(q2('hum'), [350, 100]);
  assert.deepEqual(q2('gw'), [600, 100]);
  assert.deepEqual(q2('fim'), [850, 100]);
  assert.deepEqual(q2('canc'), [850, 250]);
});

test('layout: captura de erro fica em +60 / -30 do serviço', async () => {
  const r = await gerar(S3());
  const p = posicoes(parseXml(r.xml));
  const servico = p[r.sequencias.auto];
  const captura = p[r.sequencias.auto + 1];
  assert.equal(captura.bpmn, '43');
  assert.deepEqual([captura.x, captura.y], [servico.x + 60, servico.y - 30]);
});

test('layout: posição da spec é preservada, arredondada com aviso', async () => {
  const r = await gerar(S1());
  const p = posicoes(parseXml(r.xml));
  assert.deepEqual([p[2].x, p[2].y, p[3].x, p[3].y], [100, 120, 300, 120]);
  assert.ok(!codigos(r.avisos).includes('W_GERADOR_POSICAO_ARREDONDADA'));
  assert.ok(!codigos(r.avisos).includes('W_GERADOR_POSICAO_PARCIAL'));

  const spec = S1();
  spec.atividades[1].posicao = { x: 300.4, y: 120.6 };
  const r2 = await gerar(spec);
  const p2 = posicoes(parseXml(r2.xml));
  assert.deepEqual([p2[3].x, p2[3].y], [300, 121]);
  const av = r2.avisos.find((a) => a.codigo === 'W_GERADOR_POSICAO_ARREDONDADA');
  assert.ok(av);
  assert.equal(av.caminho, 'atividades[1].posicao');
});

test('layout: posição em só parte das atividades gera aviso', async () => {
  const spec = S1();
  delete spec.atividades[1].posicao;
  const r = await gerar(spec);
  assert.ok(codigos(r.avisos).includes('W_GERADOR_POSICAO_PARCIAL'));
  const p = posicoes(parseXml(r.xml));
  assert.deepEqual([p[2].x, p[2].y], [100, 120]); // informada, mantida
  assert.deepEqual([p[3].x, p[3].y], [350, 100]); // calculada
});

/* ------------------------------------------------------------------ */
/* 7. Escape                                                           */
/* ------------------------------------------------------------------ */

test('escape: escaparXml com cada caractere', () => {
  assert.equal(escaparXml('&'), '&amp;');
  assert.equal(escaparXml('<'), '&lt;');
  assert.equal(escaparXml('>'), '&gt;');
  assert.equal(escaparXml('"'), '&quot;');
  assert.equal(escaparXml("'"), '&apos;');
  assert.equal(escaparXml('\r'), '&#xd;');
  assert.equal(escaparXml('a\nb\tc'), 'a\nb\tc');
  assert.equal(escaparXml('Atenção'), 'Atenção');
  assert.equal(escaparXml('&lt;'), '&amp;lt;'); // texto cru sempre escapa, mesmo o que já parece entidade
  assert.equal(escaparXml(12), '12');
});

test('escape: o texto de S6 relido pelo parseXml volta igual', async () => {
  const spec = S6();
  const r = await gerar(spec);
  assert.ok(!r.xml.includes('\r'));
  const raiz = parseXml(r.xml);
  assert.equal(textoDe(filho(raiz, 'ProcessDefinition'), 'processDescription'), spec.descricao);
  const nomes = estadosDe(raiz).map((e) => textoDe(e, 'stateName'));
  for (const a of spec.atividades) assert.ok(nomes.includes(a.nome), a.nome);
  const conds = bloco(raiz, 'ConditionProcessState').filhos.map((c) => textoDe(c, 'condition'));
  assert.deepEqual(conds, ['if (a < b && x == "y") { return true; }', 'return a > b;']);
});

test('escape: engineAllocationConfiguration com papel a&b relida dá Role = a&b', async () => {
  const raiz = parseXml((await gerar(S6())).xml);
  const [humana] = porBpmn(raiz, 80);
  assert.equal(textoDe(humana, 'engineAllocationId'), 'Papel');
  const config = textoDe(humana, 'engineAllocationConfiguration');
  assert.equal(config, '<AssignmentController><Role>a&amp;b</Role></AssignmentController>');
  assert.equal(textoDe(parseXml(config), 'Role'), 'a&b');
});

test('escape: pool_papel grava "Pool Papel"', async () => {
  const raiz = parseXml((await gerar(S1())).xml);
  assert.equal(textoDe(porBpmn(raiz, 80)[0], 'engineAllocationId'), 'Pool Papel');
});

/* ------------------------------------------------------------------ */
/* 8. Formato                                                          */
/* ------------------------------------------------------------------ */

test('formato: sem declaração, sem CR, sem quebra no fim, indentação de 2 espaços, <list/> nos vazios', async () => {
  const { xml } = await gerar(S1());
  assert.ok(!xml.startsWith('<?xml'));
  assert.ok(!xml.includes('\r'));
  assert.ok(!xml.endsWith('\n'));
  assert.ok(xml.startsWith('<list>\n  <ProcessDefinition>\n'));
  assert.ok(xml.endsWith('\n  <list/>\n</list>'));
  for (const linha of xml.split('\n')) {
    const recuo = /^ */.exec(linha)[0].length;
    assert.equal(recuo % 2, 0, linha);
  }
  assert.ok(xml.includes('\n    <processStates/>\n'));
  assert.ok(xml.includes('\n      <destinationStates/>\n'));
  assert.ok(xml.includes('\n      <instruction></instruction>\n'));
  const raiz = parseXml(xml);
  const vazios = raiz.filhos.filter((c) => c.nome === 'list' && c.filhos.length === 0).length;
  assert.equal(vazios, (xml.match(/^ {2}<list\/>$/gm) || []).length);
  assert.equal(vazios, 16); // 18 listas, só estados e ligações preenchidos
});

/* ------------------------------------------------------------------ */
/* 9. Determinismo e pureza                                            */
/* ------------------------------------------------------------------ */

test('determinismo: duas chamadas dão o mesmo texto e nada é alterado', async () => {
  for (const montar of Object.values(TODAS)) {
    const spec = montar();
    const opcoes = {
      versaoAlvo: '1.8.2',
      origem: { sequencias: { ini: 5 }, linkSequences: [50] },
      modelo: fixture('medicao_contrato'),
      lookups: {},
    };
    const specCopia = clone(spec);
    const opcoesCopia = clone(opcoes);
    const a = await gerarXmlProcesso(spec, opcoes);
    const b = await gerarXmlProcesso(spec, opcoes);
    assert.equal(a.ok, true);
    assert.equal(a.xml, b.xml);
    assert.deepEqual(a.sequencias, b.sequencias);
    assert.deepEqual(spec, specCopia);
    assert.deepEqual(opcoes, opcoesCopia);
  }
});

/* ------------------------------------------------------------------ */
/* 10. Modelo                                                          */
/* ------------------------------------------------------------------ */

test('modelo: lê categoria, volume, período e empresa do processo-modelo', async () => {
  const r = await gerar(S1(), '1.8.2', { modelo: fixture('medicao_contrato') });
  const def = filho(parseXml(r.xml), 'ProcessDefinition');
  assert.equal(textoDe(def, 'categoryId'), 'Compras');
  assert.equal(textoDe(def, 'volumeId'), 'Default');
  assert.equal(textoDe(def, 'periodId'), 'Default');
  assert.equal(textoDe(filho(def, 'processDefinitionPK'), 'companyId'), '1');
  assert.ok(!codigos(r.avisos).includes('W_GERADOR_SEM_MODELO'));
  // o resto do modelo é ignorado
  assert.equal(textoDe(def, 'processDescription'), 'Processo mínimo');
});

test('modelo: sem modelo a categoria sai vazia, com aviso', async () => {
  const r = await gerar(S1());
  const def = filho(parseXml(r.xml), 'ProcessDefinition');
  assert.equal(textoDe(def, 'categoryId'), '');
  assert.ok(codigos(r.avisos).includes('W_GERADOR_SEM_MODELO'));
});

/* ------------------------------------------------------------------ */
/* 11. Avisos fixos                                                    */
/* ------------------------------------------------------------------ */

test('avisos: SEM_DESENHO sempre, SERVICO_SEM_SCRIPT por serviço, SEM_FORMULARIO sem formId', async () => {
  for (const montar of Object.values(TODAS)) {
    assert.ok(codigos((await gerar(montar())).avisos).includes('W_GERADOR_SEM_DESENHO'));
  }
  const r3 = await gerar(S3());
  const scripts = r3.avisos.filter((a) => a.codigo === 'W_GERADOR_SERVICO_SEM_SCRIPT');
  assert.equal(scripts.length, 2);
  assert.ok(scripts[0].mensagem.includes('servicetask3'));
  assert.ok(scripts[1].mensagem.includes('servicetask5'));
  assert.equal((await gerar(S1())).avisos.filter((a) => a.codigo === 'W_GERADOR_SERVICO_SEM_SCRIPT').length, 0);

  assert.ok(!codigos((await gerar(S1())).avisos).includes('W_GERADOR_SEM_FORMULARIO'));
  const spec = S1();
  delete spec.formId;
  const r = await gerar(spec);
  assert.ok(codigos(r.avisos).includes('W_GERADOR_SEM_FORMULARIO'));
  assert.equal(textoDe(filho(parseXml(r.xml), 'ProcessDefinitionVersion'), 'formId'), '0');
});

test('avisos: os do validador são repassados antes dos do gerador', async () => {
  const r = await gerar(S3());
  const cods = codigos(r.avisos);
  assert.ok(cods.includes('W_SERVICO_AUTOMATIZADO'));
  assert.ok(cods.indexOf('W_SERVICO_AUTOMATIZADO') < cods.indexOf('W_GERADOR_SEM_DESENHO'));
});

test('avisos: OU com retorno divergente gera W_GERADOR_RETORNO_OU e permite o retorno', async () => {
  const spec = S2();
  spec.ligacoes[5].retorno = true; // o outro lado do OU (gw -> canc) segue sem retorno
  const r = await gerar(spec);
  const av = r.avisos.find((a) => a.codigo === 'W_GERADOR_RETORNO_OU');
  assert.ok(av);
  const raiz = parseXml(r.xml);
  const links = bloco(raiz, 'ProcessLink').filhos;
  assert.equal(links.filter((l) => textoDe(l, 'returnPermited') === 'true').length, 2);
});

test('operadores: cada operador vira o número do ECM30; vazio/preenchido gravam valor vazio', async () => {
  const raiz = parseXml((await gerar(S5())).xml);
  const regras = bloco(raiz, 'ConditionProcessAutomaticRules').filhos;
  assert.equal(regras.length, 10);
  const ops = Object.keys(OPERADORES);
  regras.forEach((r, i) => {
    assert.equal(textoDe(r, 'operator'), String(OPERADORES[ops[i]]), ops[i]);
    assert.equal(textoDe(r, 'ruleOrder'), '1');
    assert.equal(textoDe(r, 'expressionOrder'), String(i + 1));
    assert.equal(textoDe(r, 'valueType'), '1');
  });
  assert.equal(textoDe(regras[0], 'value'), '');
  assert.equal(textoDe(regras[9], 'value'), '');
  assert.equal(textoDe(regras[1], 'value'), '5');
});

test('regras: valorTipo campo grava valueType 0 e a ordem das regras vira ruleOrder', async () => {
  const raiz = parseXml((await gerar(S2())).xml);
  const regras = bloco(raiz, 'ConditionProcessAutomaticRules').filhos;
  assert.deepEqual(regras.map((r) => [textoDe(r, 'expressionOrder'), textoDe(r, 'ruleOrder'), textoDe(r, 'valueType')]), [
    ['1', '1', '1'],
    ['1', '2', '0'],
    ['3', '1', '1'],
  ]);
  // condição por regras não leva <condition>; a de JS leva
  const conds = bloco(raiz, 'ConditionProcessState').filhos;
  assert.deepEqual(conds.map((c) => textoDe(c, 'conditionType')), ['1', '0', '1', '0']);
  assert.deepEqual(conds.map((c) => filho(c, 'condition') !== undefined), [false, true, false, true]);
});

test('serviço: valores de ProcessStateService por execução', async () => {
  const raiz = parseXml((await gerar(S3())).xml);
  const [auto, imed] = bloco(raiz, 'ProcessStateService').filhos;
  assert.deepEqual([textoDe(auto, 'attempts'), textoDe(auto, 'frequency')], ['3', '5']);
  assert.deepEqual([textoDe(imed, 'attempts'), textoDe(imed, 'frequency')], ['0', '1']);
  assert.equal(textoDe(auto, 'sucessFullMessage'), '');
});

test('origem (a): ida e volta com OU mantém sequences, linkSequences e o texto', async () => {
  for (const versao of VERSOES) {
    const spec = S2(versao === '2.0');
    const r1 = await gerar(spec, versao);
    const lido = lerXmlProcesso(r1.xml);
    const r2 = await gerar(spec, versao, { origem: lido.origem });
    // lido.origem usa ids s<n>; mapeia para os ids da spec
    const inverso = {};
    for (const [id, n] of Object.entries(r1.sequencias)) inverso[`s${n}`] = id;
    const sequencias = {};
    for (const [sid, n] of Object.entries(lido.origem.sequencias)) sequencias[inverso[sid]] = n;
    const r3 = await gerar(spec, versao, { origem: { sequencias, linkSequences: lido.origem.linkSequences } });
    assert.deepEqual(r3.sequencias, r1.sequencias);
    assert.equal(r3.xml, r1.xml);
    assert.equal(bloco(parseXml(r3.xml), 'ProcessLink').filhos.length, bloco(parseXml(r1.xml), 'ProcessLink').filhos.length);
    assert.equal(r2.ok, true);
  }
});

test('origem (b): grupo OU com números diferentes avisa e usa o da primeira', async () => {
  const spec = S2();
  // ligacoes[4] e [5] formam o grupo OU gw -> canc
  const linkSequences = [20, 21, 22, 23, 24, 25];
  const r = await gerar(spec, '1.8.2', { origem: { sequencias: { ini: 2 }, linkSequences } });
  const av = r.avisos.filter((a) => a.codigo === 'W_GERADOR_ORIGEM_OU');
  assert.equal(av.length, 1);
  assert.equal(av[0].caminho, 'origem.linkSequences[5]');
  const nums = bloco(parseXml(r.xml), 'ProcessLink').filhos.map((l) => Number(textoDe(filho(l, 'processLinkPK'), 'linkSequence')));
  assert.deepEqual(nums, [20, 21, 22, 23, 24]);
  // primeira nula: usa o primeiro número do grupo
  const r2 = await gerar(spec, '1.8.2', { origem: { linkSequences: [20, 21, 22, 23, null, 25] } });
  const nums2 = bloco(parseXml(r2.xml), 'ProcessLink').filhos.map((l) => Number(textoDe(filho(l, 'processLinkPK'), 'linkSequence')));
  assert.equal(nums2[4], 25);
});

test('origem (c): contador único soma sequencias e linkSequences', async () => {
  const spec = S3();
  const origem = { sequencias: { ini: 2, auto: 3, imed: 5 }, linkSequences: [6, 7] };
  const r = await gerar(spec, '1.8.2', { origem });
  // fim e a captura saem a partir de 8: captura (logo depois do serviço) 8, fim 9, terceiro link 10
  assert.deepEqual(r.sequencias, { ini: 2, auto: 3, imed: 5, fim: 9 });
  const raiz = parseXml(r.xml);
  assert.equal(seqDe(porBpmn(raiz, 43)[0]), 8);
  assert.deepEqual(
    bloco(raiz, 'ProcessLink').filhos.map((l) => Number(textoDe(filho(l, 'processLinkPK'), 'linkSequence'))),
    [6, 7, 10]
  );
});

test('origem (d): mesmo número em atividade e em link -> E_GERADOR_ORIGEM', async () => {
  const r = await gerarXmlProcesso(S1(), { versaoAlvo: '1.8.2', origem: { sequencias: { ini: 5 }, linkSequences: [5, null] } });
  assert.equal(r.ok, false);
  assert.ok(codigos(r.erros).includes('E_GERADOR_ORIGEM'));
  assert.equal(r.erros.find((e) => e.codigo === 'E_GERADOR_ORIGEM').caminho, 'origem.linkSequences[0]');
});

/* ------------------------------------------------------------------ */
/* Passo 4: captura de erro em origem e fluxo padrão                   */
/* ------------------------------------------------------------------ */

test('origem.capturas: a captura de erro mantém o sequence informado e entra no contador', async () => {
  const origem = { sequencias: { ini: 2, auto: 3, imed: 5 }, capturas: { auto: 40 }, linkSequences: [6, 7] };
  const r = await gerar(S3(), '1.8.2', { origem });
  const raiz = parseXml(r.xml);
  const captura = porBpmn(raiz, 43)[0];
  assert.equal(seqDe(captura), 40);
  assert.equal(textoDe(captura, 'parentSequence'), '3');
  // fim e o terceiro link vêm acima de 40
  assert.deepEqual(r.sequencias, { ini: 2, auto: 3, imed: 5, fim: 41 });
});

test('origem.capturas: repetido, inválido ou fora do formato -> E_GERADOR_ORIGEM', async () => {
  const casos = [
    { sequencias: { auto: 3 }, capturas: { auto: 3 } },
    { capturas: { auto: 0 } },
    { capturas: { auto: 1.5 } },
    { capturas: [] },
    { capturas: { auto: 9 }, linkSequences: [9, null, null] },
  ];
  for (const origem of casos) {
    const r = await gerarXmlProcesso(S3(), { versaoAlvo: '1.8.2', origem });
    assert.equal(r.ok, false, JSON.stringify(origem));
    assert.ok(codigos(r.erros).includes('E_GERADOR_ORIGEM'), JSON.stringify(origem));
  }
});

test('origem.capturas: id inexistente ou serviço não automatizado é ignorado com aviso', async () => {
  const r = await gerar(S3(), '1.8.2', { origem: { capturas: { fantasma: 7, imed: 8 } } });
  const av = r.avisos.filter((a) => a.codigo === 'W_GERADOR_ORIGEM_ID');
  assert.deepEqual(av.map((a) => a.caminho), ['origem.capturas.fantasma', 'origem.capturas.imed']);
  assert.equal(porBpmn(parseXml(r.xml), 43).length, 1);
});

/** Gateway com saída padrão sem condição. */
const SPadrao = () => ({
  processId: 'proc_padrao',
  descricao: 'Processo com saída padrão',
  formId: 50,
  atividades: [
    ini,
    { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Valor alto?' },
    { id: 'alt', tipo: 'fim', nome: 'Alto' },
    { id: 'pad', tipo: 'fim', nome: 'Normal' },
  ],
  ligacoes: [
    { de: 'ini', para: 'gw' },
    { de: 'gw', para: 'alt', ordem: 1, condicao: { regras: [{ campo: 'valor', op: 'maior', valor: '100' }] } },
    { de: 'gw', para: 'pad', padrao: true },
  ],
});

test('padrao: defaultLink=true no ProcessLink e nenhuma ConditionProcessState para a saída padrão', async () => {
  for (const versao of VERSOES) {
    const r = await gerar(SPadrao(), versao);
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    const raiz = parseXml(r.xml);
    const links = bloco(raiz, 'ProcessLink').filhos;
    assert.deepEqual(links.map((l) => textoDe(l, 'defaultLink')), ['false', 'false', 'true']);
    const conds = bloco(raiz, 'ConditionProcessState').filhos;
    assert.equal(conds.length, 1);
    assert.equal(textoDe(conds[0], 'destinationSequenceId'), String(r.sequencias.alt));
  }
});

test('padrao: ida e volta pela leitura devolve a mesma spec', async () => {
  const spec = SPadrao();
  const r = await gerar(spec, '1.8.2');
  const lido = lerXmlProcesso(r.xml);
  assert.deepEqual(lido.spec.ligacoes.map((l) => l.padrao === true), [false, false, true]);
  assert.equal(lido.spec.ligacoes[2].condicao, undefined);
  assert.equal(lido.spec.ligacoes[2].ordem, undefined);
  assert.deepEqual(lido.avisos.filter((a) => a.codigo === 'W_LEITOR_GATEWAY_SEM_CONDICAO'), []);
});

test('padrao: grupo OU com uma ligação padrão marca o ProcessLink como padrão', async () => {
  const spec = SPadrao();
  spec.ligacoes.push({ de: 'gw', para: 'alt', ordem: 2, padrao: true, condicao: { js: 'true' } });
  const r = await gerarXmlProcesso(spec, { versaoAlvo: '1.8.2' });
  assert.equal(r.ok, false); // dois destinos padrão
  assert.ok(codigos(r.erros).includes('E_PADRAO_REPETIDO'));
  const spec2 = SPadrao();
  spec2.ligacoes[1].padrao = false;
  spec2.ligacoes.push({ de: 'gw', para: 'pad', ordem: 2, condicao: { js: 'true' }, padrao: true });
  const r2 = await gerar(spec2, '1.8.2');
  assert.equal(r2.ok, true, JSON.stringify(r2.erros));
  const links = bloco(parseXml(r2.xml), 'ProcessLink').filhos;
  assert.equal(links.length, 3);
  assert.equal(textoDe(links[2], 'defaultLink'), 'true');
  assert.equal(bloco(parseXml(r2.xml), 'ConditionProcessState').filhos.length, 2);
});
