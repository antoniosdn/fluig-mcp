import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { validarSpec } from '../src/flow/validar.js';

const fixture = (nome) =>
  readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');

const codigos = (itens) => itens.map((i) => i.codigo);
const temItem = (itens, codigo, ref) => itens.some((i) => i.codigo === codigo && (ref === undefined || i.ref === ref));
const contar = (itens, codigo) => itens.filter((i) => i.codigo === codigo).length;
const conjunto = (cods) => [...new Set(cods)].sort();

/* ------------------------------------------------------------------ */
/* XML inline para os casos de borda                                   */
/* ------------------------------------------------------------------ */

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function xmlEstado(e) {
  const pk = `<processStatePK><companyId>1</companyId><processId>p</processId><version>1</version>${
    e.seq === undefined ? '' : `<sequence>${e.seq}</sequence>`
  }</processStatePK>`;
  let s = `<ProcessState>${pk}`;
  if (e.nome !== undefined) s += `<stateName>${esc(e.nome)}</stateName>`;
  if (e.desc !== undefined) s += `<stateDescription>${esc(e.desc)}</stateDescription>`;
  if (e.mec !== undefined) s += `<engineAllocationId>${esc(e.mec)}</engineAllocationId>`;
  if (e.cfg !== undefined) s += `<engineAllocationConfiguration>${esc(e.cfg)}</engineAllocationConfiguration>`;
  if (e.bpmn !== undefined) s += `<bpmnType>${e.bpmn}</bpmnType>`;
  if (e.exec !== undefined) s += `<executionType>${e.exec}</executionType>`;
  if (e.parent !== undefined) s += `<parentSequence>${e.parent}</parentSequence>`;
  if (e.x !== undefined) s += `<positionX>${e.x}</positionX><positionY>${e.y}</positionY>`;
  return `${s}</ProcessState>`;
}

function xmlLigacao(l, i) {
  return (
    `<ProcessLink><processLinkPK><companyId>1</companyId><processId>p</processId><version>1</version><linkSequence>${
      l.seq === undefined ? 100 + i : l.seq
    }</linkSequence></processLinkPK>` +
    `<returnPermited>${l.ret ? 'true' : 'false'}</returnPermited>` +
    `<initialStateSequence>${l.de}</initialStateSequence><finalStateSequence>${l.para}</finalStateSequence>` +
    `<automaticLink>${l.auto ? 'true' : 'false'}</automaticLink></ProcessLink>`
  );
}

function xmlCondicao(c) {
  let s =
    `<ConditionProcessState><conditionProcessStatePK><companyId>1</companyId><processId>p</processId>` +
    `<expressionOrder>${c.ordem}</expressionOrder><version>1</version><sequence>${c.seq}</sequence></conditionProcessStatePK>`;
  if (c.cond !== undefined) s += `<condition>${esc(c.cond)}</condition>`;
  s += `<destinationSequenceId>${c.dest}</destinationSequenceId>`;
  if (c.tipo !== undefined) s += `<conditionType>${c.tipo}</conditionType>`;
  if (c.nome !== undefined) s += `<conditionName>${esc(c.nome)}</conditionName>`;
  return `${s}</ConditionProcessState>`;
}

function xmlRegra(r) {
  return (
    `<ConditionProcessAutomaticRules><sequence>${r.seq}</sequence><expressionOrder>${r.ordem}</expressionOrder>` +
    `<ruleOrder>${r.regra === undefined ? 1 : r.regra}</ruleOrder><field>${esc(r.field)}</field>` +
    `<value>${esc(r.value === undefined ? '' : r.value)}</value><operator>${r.op}</operator>` +
    `<valueType>${r.vt === undefined ? 1 : r.vt}</valueType></ConditionProcessAutomaticRules>`
  );
}

/** Monta um ECM30 mínimo; `omitir` remove blocos para testar as exceções. */
function montarXml({ estados = [], ligacoes = [], condicoes = [], regras = [], extras = '', omitir = [] } = {}) {
  const def = omitir.includes('processId')
    ? '<ProcessDefinition><processDefinitionPK><companyId>1</companyId></processDefinitionPK></ProcessDefinition>'
    : '<ProcessDefinition><processDefinitionPK><companyId>1</companyId><processId>p</processId></processDefinitionPK></ProcessDefinition>';
  return (
    '<list>' +
    (omitir.includes('definicao') ? '' : def) +
    `<list>${estados.map(xmlEstado).join('')}</list>` +
    `<list>${condicoes.map(xmlCondicao).join('')}</list>` +
    `<list>${ligacoes.map(xmlLigacao).join('')}</list>` +
    `<list>${regras.map(xmlRegra).join('')}</list>` +
    (extras ? `<list>${extras}</list>` : '') +
    '</list>'
  );
}

const ini = { seq: 1, nome: 'Início', bpmn: 10 };
const fim = { seq: 99, nome: 'Fim', bpmn: 60 };
const hum = (seq, extra = {}) => ({ seq, nome: `H${seq}`, bpmn: 80, exec: 0, ...extra });
const gw = { seq: 5, nome: 'Gw', bpmn: 120 };

/* ------------------------------------------------------------------ */
/* Fixtures do demo                                                    */
/* ------------------------------------------------------------------ */

test('fixture medicao_contrato (demo, saneada)', async () => {
  const { spec, origem, ignorados, avisos } = lerXmlProcesso(fixture('medicao_contrato'));

  assert.equal(spec.processId, 'medicao_contrato');
  assert.equal(spec.formId, 31);
  assert.deepStrictEqual(
    spec.atividades.map((a) => [a.id, a.tipo]),
    [
      ['s4', 'inicio'],
      ['s5', 'humana'],
      ['s7', 'humana'],
      ['s9', 'servico'],
      ['s6', 'gateway_exclusivo'],
      ['s10', 'fim'],
      ['s11', 'cancelamento'],
      ['s20', 'cancelamento'],
    ]
  );
  assert.deepStrictEqual(spec.atividades[1].responsavel, { tipo: 'pool_papel', valor: 'admin' });
  assert.equal(spec.atividades[3].execucao, 'imediata');

  const saidas = spec.ligacoes.filter((l) => l.de === 's6');
  assert.equal(saidas.length, 3);
  const porOrdem = [...saidas].sort((a, b) => a.ordem - b.ordem);
  assert.deepStrictEqual(
    porOrdem.map((l) => [l.ordem, l.para, l.condicao]),
    [
      [1, 's9', { regras: [{ campo: 'parecergestor', op: 'igual', valor: 'sim' }] }],
      [2, 's20', { regras: [{ campo: 'parecergestor', op: 'igual', valor: 'nao' }] }],
      [3, 's7', { regras: [{ campo: 'parecergestor', op: 'igual', valor: 'ajustar' }] }],
    ]
  );
  assert.deepStrictEqual(origem.linkSequences, [12, 13, 14, 15, 16, 17, 18, 19]);

  for (const versaoAlvo of ['1.8.2', '2.0']) {
    const r = await validarSpec(spec, { versaoAlvo });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.deepStrictEqual(conjunto(codigos(r.avisos)), ['W_HUMANA_SEM_RESPONSAVEL', 'W_SEM_LOOKUP']);
  }

  for (const c of ['I_RAIAS', 'I_SCRIPTS', 'I_SERVICO_CONFIG']) assert.ok(temItem(ignorados, c), c);
  assert.ok(temItem(avisos, 'W_LEITOR_ATRIBUICAO_FORA_V1', 's7'));
  assert.ok(temItem(avisos, 'W_LEITOR_FLUXO_AUTOMATICO', 'ligacao s5→s11'));
});

test('fixture rpa (demo, saneada): captura de erro ligada fica como captura_erro', async () => {
  const { spec, avisos } = lerXmlProcesso(fixture('rpa'));

  const servicos = spec.atividades.filter((a) => a.tipo === 'servico');
  assert.deepStrictEqual(servicos.map((a) => [a.id, a.execucao]), [['s32', 'automatizada'], ['s38', 'automatizada']]);
  assert.deepStrictEqual(
    spec.atividades.filter((a) => a.tipo === 'captura_erro').map((a) => a.id),
    ['s40', 's42']
  );
  assert.ok(spec.ligacoes.some((l) => l.de === 's40' && l.para === 's41'));
  assert.ok(spec.ligacoes.some((l) => l.de === 's42' && l.para === 's43'));

  assert.equal(contar(avisos, 'W_LEITOR_FLUXO_ERRO'), 2);
  assert.ok(temItem(avisos, 'W_LEITOR_ATRIBUICAO_FORA_V1', 's4')); // Campo Formulário
  assert.ok(temItem(avisos, 'W_LEITOR_ATRIBUICAO_FORA_V1', 's12')); // Executor Atividade
  // "Todos os Usuários" só aparece em ProcessAttachmentSecurity (anexos), não em atividade:
  assert.equal(contar(avisos, 'W_LEITOR_ATRIBUICAO_FORA_V1'), 2);

  // a v1 não modela o fluxo de erro: o validador acusa as duas capturas e para na fase 1
  const r = await validarSpec(spec, { versaoAlvo: '2.0' });
  assert.equal(r.ok, false);
  assert.deepStrictEqual(
    r.erros.map((e) => [e.codigo, e.caminho]),
    [
      ['E_TIPO_FORA_V1', `atividades[${spec.atividades.findIndex((a) => a.id === 's40')}].tipo`],
      ['E_TIPO_FORA_V1', `atividades[${spec.atividades.findIndex((a) => a.id === 's42')}].tipo`],
    ]
  );
});

test('fixture sintética sintetico-paralelo-2.0 (montada à mão)', async () => {
  const { spec, origem, ignorados, avisos } = lerXmlProcesso(fixture('sintetico-paralelo-2.0'));

  assert.deepStrictEqual(spec, {
    processId: 'sinteticoParalelo',
    descricao: 'Processo sintético com fluxo paralelo',
    formId: 100,
    atividades: [
      { id: 's2', tipo: 'inicio', nome: 'Início', posicao: { x: 100, y: 100 } },
      { id: 's3', tipo: 'gateway_paralelo_abertura', nome: 'Abertura paralela', posicao: { x: 200, y: 100 } },
      { id: 's4', tipo: 'humana', nome: 'Revisar', responsavel: { tipo: 'papel', valor: 'revisor' }, posicao: { x: 300, y: 60 } },
      { id: 's5', tipo: 'humana', nome: 'Aprovar', responsavel: { tipo: 'pool_papel', valor: 'aprovador' }, posicao: { x: 300, y: 140 } },
      { id: 's6', tipo: 'gateway_paralelo_juncao', nome: 'Junção', posicao: { x: 400, y: 100 } },
      { id: 's7', tipo: 'servico', nome: 'Integrar', execucao: 'automatizada', posicao: { x: 500, y: 100 } },
      { id: 's9', tipo: 'gateway_exclusivo', nome: 'Aprovado?', posicao: { x: 600, y: 100 } },
      { id: 's10', tipo: 'fim', nome: 'Concluído', posicao: { x: 700, y: 60 } },
      { id: 's11', tipo: 'fim_terminativo', nome: 'Encerrado', posicao: { x: 700, y: 140 } },
    ],
    ligacoes: [
      { de: 's2', para: 's3' },
      { de: 's3', para: 's4' },
      { de: 's3', para: 's5' },
      { de: 's4', para: 's6' },
      { de: 's5', para: 's6' },
      { de: 's6', para: 's7' },
      { de: 's7', para: 's9' },
      {
        de: 's9',
        para: 's10',
        ordem: 1,
        condicao: {
          regras: [
            { campo: 'status', op: 'igual', valor: 'A' },
            { campo: 'valor', op: 'preenchido' },
          ],
          nome: 'Aprovado',
        },
        retorno: true,
      },
      { de: 's9', para: 's11', ordem: 2, condicao: { js: 'hAPI.getCardValue("status") != "A"' } },
    ],
  });

  assert.ok(temItem(ignorados, 'I_CAPTURA_ERRO_REGERADA', 's8'));
  assert.ok(!('s8' in origem.sequencias));
  assert.ok(temItem(ignorados, 'I_DIAGRAMA'));
  const campos = ignorados.find((i) => i.codigo === 'I_PROCESSO_CAMPOS');
  assert.ok(campos && campos.mensagem.includes('icon') && campos.mensagem.includes('processCategoryId'));
  assert.deepStrictEqual(avisos, []);

  const r20 = await validarSpec(spec, { versaoAlvo: '2.0' });
  assert.equal(r20.ok, true, JSON.stringify(r20.erros));
  const r18 = await validarSpec(spec, { versaoAlvo: '1.8.2' });
  assert.equal(r18.ok, false);
  assert.deepStrictEqual(codigos(r18.erros), ['E_VERSAO_RECURSO']);

  // origem
  assert.equal(origem.processId, 'sinteticoParalelo');
  assert.equal(origem.versao, 3);
  assert.deepStrictEqual(origem.sequencias, { s2: 2, s3: 3, s4: 4, s5: 5, s6: 6, s7: 7, s9: 9, s10: 10, s11: 11 });
  assert.deepStrictEqual(origem.linkSequences, [20, 21, 22, 23, 24, 25, 26, 27, 28]);
});

test('determinismo: duas leituras iguais e a entrada não muda', () => {
  for (const nome of ['medicao_contrato', 'rpa', 'sintetico-paralelo-2.0']) {
    const xml = fixture(nome);
    const copia = String(xml);
    const a = lerXmlProcesso(xml);
    const b = lerXmlProcesso(xml);
    assert.deepStrictEqual(a, b, nome);
    assert.equal(xml, copia);
  }
});

/* ------------------------------------------------------------------ */
/* Casos de borda                                                      */
/* ------------------------------------------------------------------ */

test('captura de erro: pai serviço executionType 2 ou sem parentSequence', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [
        ini,
        { seq: 2, nome: 'Srv', bpmn: 82, exec: 2 },
        { seq: 3, nome: 'Cap', bpmn: 43, parent: 2 },
        { seq: 4, nome: 'Cap2', bpmn: 43 },
      ],
    })
  );
  assert.deepStrictEqual(spec.atividades.filter((a) => a.tipo === 'captura_erro').map((a) => a.id), ['s3', 's4']);
  assert.ok(temItem(avisos, 'W_LEITOR_CAPTURA_ERRO_PAI', 's3'));
  assert.ok(temItem(avisos, 'W_LEITOR_CAPTURA_ERRO_PAI', 's4'));
});

test('serviço automatizado sem captura e serviço com executionType 0', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, { seq: 2, nome: 'A', bpmn: 82, exec: 1 }, { seq: 3, nome: 'B', bpmn: 82, exec: 0 }],
    })
  );
  assert.equal(spec.atividades[1].execucao, 'automatizada');
  assert.ok(temItem(avisos, 'W_LEITOR_SERVICO_SEM_CAPTURA', 's2'));
  assert.ok(!('execucao' in spec.atividades[2]));
  assert.ok(temItem(avisos, 'W_LEITOR_EXECUCAO', 's3'));
});

test('tipos: 32 espera, 100 subprocesso, 123 desconhecido', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [
        { seq: 1, nome: 'E', bpmn: 32 },
        { seq: 2, nome: 'S', bpmn: 100 },
        { seq: 3, nome: 'X', bpmn: 123 },
      ],
    })
  );
  assert.deepStrictEqual(spec.atividades.map((a) => a.tipo), ['espera', 'subprocesso', 'bpmn_123']);
  assert.ok(temItem(avisos, 'W_LEITOR_TIPO_DESCONHECIDO', 's3'));
});

test('atribuição: Papel, Pool Papel, Grupo, Pool Papel sem Role, atribuição no início', () => {
  const cfg = (papel) => `<AssignmentController><Role>${papel}</Role></AssignmentController>`;
  const { spec, avisos, ignorados } = lerXmlProcesso(
    montarXml({
      estados: [
        { ...ini, mec: 'Papel', cfg: cfg('x') },
        hum(2, { mec: 'Papel', cfg: cfg('revisor') }),
        hum(3, { mec: 'Pool Papel', cfg: cfg('aprovador') }),
        hum(4, { mec: 'Grupo', cfg: '<AssignmentController><Group>g</Group></AssignmentController>' }),
        hum(5, { mec: 'Pool Papel', cfg: '<AssignmentController></AssignmentController>' }),
        hum(6, { mec: '' }),
      ],
    })
  );
  const por = Object.fromEntries(spec.atividades.map((a) => [a.id, a]));
  assert.deepStrictEqual(por.s2.responsavel, { tipo: 'papel', valor: 'revisor' });
  assert.deepStrictEqual(por.s3.responsavel, { tipo: 'pool_papel', valor: 'aprovador' });
  assert.ok(!('responsavel' in por.s4));
  assert.ok(temItem(avisos, 'W_LEITOR_ATRIBUICAO_FORA_V1', 's4'));
  assert.ok(!('responsavel' in por.s5));
  assert.ok(temItem(avisos, 'W_LEITOR_ATRIBUICAO_INVALIDA', 's5'));
  assert.ok(!('responsavel' in por.s6));
  assert.ok(!('responsavel' in por.s1));
  assert.ok(temItem(ignorados, 'I_ATRIBUICAO_NAO_HUMANA', 's1'));
});

test('gateway: OU = duas condições para o mesmo destino viram duas ligações', () => {
  const { spec, origem } = lerXmlProcesso(
    montarXml({
      estados: [ini, gw, fim, { seq: 7, nome: 'Alt', bpmn: 60 }],
      ligacoes: [
        { seq: 10, de: 1, para: 5 },
        { seq: 11, de: 5, para: 99 },
        { seq: 12, de: 5, para: 7 },
      ],
      condicoes: [
        { seq: 5, ordem: 2, dest: 99, tipo: 0, cond: 'b == 2' },
        { seq: 5, ordem: 1, dest: 99, tipo: 0, cond: 'a == 1' },
        { seq: 5, ordem: 3, dest: 7, tipo: 0, cond: 'true' },
      ],
    })
  );
  assert.deepStrictEqual(spec.ligacoes, [
    { de: 's1', para: 's5' },
    { de: 's5', para: 's99', ordem: 1, condicao: { js: 'a == 1' } },
    { de: 's5', para: 's99', ordem: 2, condicao: { js: 'b == 2' } },
    { de: 's5', para: 's7', ordem: 3, condicao: { js: 'true' } },
  ]);
  assert.deepStrictEqual(origem.linkSequences, [10, 11, 11, 12]);
});

test('gateway: saída sem condição, condição sem ligação, regra órfã', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, gw, fim],
      ligacoes: [
        { de: 1, para: 5 },
        { de: 5, para: 99 },
      ],
      condicoes: [{ seq: 5, ordem: 1, dest: 42, tipo: 0, cond: 'x' }],
      regras: [{ seq: 77, ordem: 1, field: 'f', op: 1, value: 'v' }],
    })
  );
  assert.deepStrictEqual(spec.ligacoes[1], { de: 's5', para: 's99' });
  assert.ok(temItem(avisos, 'W_LEITOR_GATEWAY_SEM_CONDICAO', 'ligacao s5→s99'));
  assert.ok(temItem(avisos, 'W_LEITOR_CONDICAO_SEM_LIGACAO'));
  assert.ok(temItem(avisos, 'W_LEITOR_REGRA_ORFA'));
});

test('gateway: mesmo destino em duas ligações, as condições ficam na primeira', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, gw, fim],
      ligacoes: [
        { de: 5, para: 99 },
        { de: 5, para: 99 },
      ],
      condicoes: [{ seq: 5, ordem: 1, dest: 99, tipo: 0, cond: 'x' }],
    })
  );
  assert.deepStrictEqual(spec.ligacoes, [
    { de: 's5', para: 's99', ordem: 1, condicao: { js: 'x' } },
    { de: 's5', para: 's99' },
  ]);
  assert.ok(temItem(avisos, 'W_LEITOR_LIGACAO_REPETIDA'));
});

test('condição por regras: operador desconhecido, valueType 0, valueType estranho, sem regras', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, gw, fim, { seq: 7, nome: 'Alt', bpmn: 60 }, { seq: 8, nome: 'Alt2', bpmn: 60 }],
      ligacoes: [
        { de: 5, para: 99 },
        { de: 5, para: 7 },
        { de: 5, para: 8 },
      ],
      condicoes: [
        { seq: 5, ordem: 1, dest: 99, tipo: 1, cond: 'false' },
        { seq: 5, ordem: 2, dest: 7, tipo: 1 },
        { seq: 5, ordem: 3, dest: 8, tipo: 9, cond: 'js' },
      ],
      regras: [
        { seq: 5, ordem: 1, regra: 2, field: 'b', op: 42, value: '1', vt: 0 },
        { seq: 5, ordem: 1, regra: 1, field: 'a', op: 1, value: 'x', vt: 7 },
      ],
    })
  );
  assert.deepStrictEqual(spec.ligacoes[0].condicao, {
    regras: [
      { campo: 'a', op: 'igual', valor: 'x' },
      { campo: 'b', op: 'operador_42', valor: '1', valorTipo: 'campo' },
    ],
  });
  assert.deepStrictEqual(spec.ligacoes[1].condicao, { regras: [] });
  assert.deepStrictEqual(spec.ligacoes[2].condicao, { js: 'js' });
  for (const c of ['W_LEITOR_OPERADOR', 'W_LEITOR_VALOR_TIPO', 'W_LEITOR_CONDICAO_SEM_REGRAS', 'W_LEITOR_CONDICAO_TIPO']) {
    assert.ok(temItem(avisos, c), c);
  }
});

test('ligações: sequence inexistente, fluxo automático, sequence de atividade duplicado', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, hum(2), hum(2, { nome: 'Repetida' }), fim],
      ligacoes: [
        { de: 1, para: 2 },
        { de: 2, para: 55 },
        { de: 2, para: 99, auto: true },
      ],
    })
  );
  assert.equal(spec.atividades.length, 3);
  assert.equal(spec.atividades[1].nome, 'H2');
  assert.ok(temItem(avisos, 'W_LEITOR_SEQUENCE_DUPLICADA', 's2'));
  assert.ok(temItem(avisos, 'W_LEITOR_LIGACAO_ORFA', 'ligacao s2→s55'));
  assert.ok(temItem(avisos, 'W_LEITOR_FLUXO_AUTOMATICO', 'ligacao s2→s99'));
  assert.deepStrictEqual(spec.ligacoes[1], { de: 's2', para: 's55' });
});

test('nome: cai para stateDescription e depois para "Atividade <seq>"', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [
        { seq: 1, nome: '', desc: 'Só descrição', bpmn: 10 },
        { seq: 2, nome: '', desc: '', bpmn: 60 },
      ],
    })
  );
  assert.equal(spec.atividades[0].nome, 'Só descrição');
  assert.equal(spec.atividades[1].nome, 'Atividade 2');
  assert.ok(temItem(avisos, 'W_LEITOR_NOME_VAZIO', 's2'));
});

test('exceções do leitor', () => {
  assert.throws(() => lerXmlProcesso('<outra/>'), /raiz deve ser <list>/);
  assert.throws(() => lerXmlProcesso(montarXml({ estados: [ini], omitir: ['definicao'] })), /ProcessDefinition/);
  assert.throws(() => lerXmlProcesso(montarXml({ estados: [ini], omitir: ['processId'] })), /processId/);
  assert.throws(() => lerXmlProcesso(montarXml({ estados: [] })), /ProcessState/);
  assert.throws(() => lerXmlProcesso('<list><a b="1"/></list>'), /atributo não suportado/);
  assert.throws(() => lerXmlProcesso('<list>'), /não fechada/);
});

test('gateway: expressionOrder 0 e 1 vão como estão, sem aviso do leitor', () => {
  const { spec, avisos } = lerXmlProcesso(
    montarXml({
      estados: [ini, gw, fim, { seq: 7, nome: 'Alt', bpmn: 60 }],
      ligacoes: [
        { de: 5, para: 99 },
        { de: 5, para: 7 },
      ],
      condicoes: [
        { seq: 5, ordem: 0, dest: 99, tipo: 0, cond: 'a' },
        { seq: 5, ordem: 1, dest: 7, tipo: 0, cond: 'b' },
      ],
    })
  );
  assert.deepStrictEqual(spec.ligacoes.map((l) => l.ordem), [0, 1]);
  assert.deepStrictEqual(avisos, []);
});

test('sequence inválido: descartada, ref ProcessState e nome só na mensagem', () => {
  const { spec, avisos } = lerXmlProcesso(montarXml({ estados: [ini, { nome: 'Sem seq', bpmn: 80 }] }));
  assert.equal(spec.atividades.length, 1);
  const a = avisos.find((i) => i.codigo === 'W_LEITOR_SEQUENCE_INVALIDA');
  assert.equal(a.ref, 'ProcessState');
  assert.ok(a.mensagem.includes('Sem seq'));
});
