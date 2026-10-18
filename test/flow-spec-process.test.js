// spec v1 → .process pelo vendor Fluiggers (src/flow/spec-process.js). Offline: sem Java, sem Studio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NO_VENDOR, specParaProcess, compararSpecProcess, conferirConfiguracao } from '../src/flow/spec-process.js';
import { montarProcessoSintetico } from './_process-sintetico.js';
import { TIPOS } from '../src/flow/spec.js';
import { carregarFluiggers } from '../src/flow/fluiggers.js';
import { lerProcess } from '../src/flow/process.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { gerarXmlProcesso } from '../src/flow/gerar.js';
import { compararXml } from '../src/flow/comparar.js';
import { regenerar } from '../src/flow/regenerar.js';

const fixture = (nome) => JSON.parse(readFileSync(new URL(`./fixtures/flow/${nome}.json`, import.meta.url), 'utf8'));
const semPosicoes = (spec) => {
  for (const a of spec.atividades) delete a.posicao;
  return spec;
};
const rejeita = (fn, codigo, re) => assert.throws(fn, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);
const CASOS = [
  ['spec-completa com posições', () => fixture('spec-completa')],
  ['spec-completa sem posições', () => semPosicoes(fixture('spec-completa'))],
  ['spec-ou', () => fixture('spec-ou')],
];

test('NO_VENDOR tem as mesmas chaves de TIPOS', () => {
  assert.deepEqual(Object.keys(NO_VENDOR).sort(), Object.keys(TIPOS).sort());
});

for (const [nome, obter] of CASOS) {
  test(`${nome}: validateProcess 0 erros, só ASCII, lerProcess sem avisos, compararSpecProcess []`, () => {
    const spec = obter();
    const r = specParaProcess(spec, { versaoAlvo: '2.0' });
    const F = carregarFluiggers();
    const v = F.validateProcess(F.parseProcess(r.texto));
    assert.deepEqual(v.errors, []);
    assert.match(r.texto, /^[\x00-\x7f]*$/);
    assert.ok(r.texto.includes('Fluxo de exemplo do gerador'));
    const lida = lerProcess(r.texto);
    assert.deepEqual(lida.avisos, []);
    assert.deepEqual(compararSpecProcess(spec, lida.spec, { ids: r.ids, posicoes: r.posicoes }), []);
    assert.deepEqual(r.avisos, []);
    // prefixos dos ids do vendor e captura de erro logo depois do serviço
    assert.match(r.ids.ini, /^startevent\d+$/);
    assert.match(r.ids.sol, /^task\d+$/);
    assert.match(r.ids.erp, /^servicetask\d+$/);
    assert.match(r.ids.gw, /^exclusivegateway\d+$/);
    assert.match(r.ids.abre, /^parallelgateway\d+$/);
    assert.match(r.ids.junta, /^joingateway\d+$/);
    assert.match(r.ids.fim, /^endevent\d+$/);
    assert.equal(r.origem.capturas.erp, Number(/\d+$/.exec(r.ids.erp)[0]) + 1);
    assert.match(r.texto, new RegExp(`intermediateerror${r.origem.capturas.erp}`));
    assert.equal(r.fluxos.length, spec.ligacoes.length);
  });
}

for (const [nome, obter] of CASOS) {
  test(`${nome}: a captura de erro sai ligada ao tratamento e o editor não acusa pendência`, () => {
    const spec = obter();
    const r = specParaProcess(spec, { versaoAlvo: '2.0' });
    const captura = `intermediateerror${r.origem.capturas.erp}`;
    const f = carregarFluiggers().parseProcess(r.texto);
    const fluxo = f.flows.filter((x) => x.attributes.sourceRef === captura);
    assert.equal(fluxo.length, 1);
    assert.equal(fluxo[0].attributes.targetRef, r.ids.trata);
    assert.equal(fluxo[0].id, r.fluxosTratamento.erp);
    assert.deepEqual(r.origem.tratamentos, { erp: Number(/\d+$/.exec(r.fluxosTratamento.erp)[0]) });
    // a ligação da captura não é uma ligação da spec
    assert.equal(r.fluxos.length, spec.ligacoes.length);
    assert.ok(!r.fluxos.includes(r.fluxosTratamento.erp));
    assert.deepEqual(conferirConfiguracao(r.texto), []);
  });
}

test('regressão: captura de erro sem saída → o editor acusa "Elemento sem fluxo de saída."', () => {
  const { texto, ids } = montarProcessoSintetico({ gateway: false, servico: 'sem_saida' });
  const pend = conferirConfiguracao(texto);
  assert.deepEqual(pend.filter((x) => x.id === ids.captura), [{ id: ids.captura, mensagem: 'Elemento sem fluxo de saída.' }]);
  // a atividade de tratamento do sintético fica sem entrada quando a captura não tem saída
  assert.deepEqual(pend.filter((x) => x.id !== ids.captura).map((x) => x.id), [ids.tratamento]);
  assert.match(ids.captura, /^intermediateerror\d+$/);
  // com o fluxo para o tratamento a pendência some
  const ok = montarProcessoSintetico({ gateway: false, servico: 'tratado' });
  assert.deepEqual(conferirConfiguracao(ok.texto), []);
});

test('P2: compararSpecProcess detecta divergência em tratamentoErro', () => {
  const spec = fixture('spec-completa');
  const r = specParaProcess(spec);
  const lida = lerProcess(r.texto).spec;
  const alterada = fixture('spec-completa');
  alterada.atividades.find((a) => a.id === 'erp').tratamentoErro = 'ges';
  const campos = compararSpecProcess(alterada, lida, { ids: r.ids, posicoes: r.posicoes }).map((d) => d.campo);
  assert.deepEqual(campos, ['atividades.erp.tratamentoErro']);
});

test('acentos da descrição saem como referência numérica', () => {
  const spec = fixture('spec-completa');
  spec.descricao = 'Solicitação á';
  const r = specParaProcess(spec);
  assert.ok(r.texto.includes('Solicita&#xe7;&#xe3;o &#xe1;'));
  assert.match(r.texto, /^[\x00-\x7f]*$/);
  assert.equal(lerProcess(r.texto).spec.descricao, 'Solicitação á');
});

test('OU: um único fluxo gw→destino e duas condições com o mesmo targetId', () => {
  const spec = fixture('spec-ou');
  const r = specParaProcess(spec);
  const iGw = spec.ligacoes.findIndex((l) => l.de === 'gw' && l.para === 'abre');
  const iGw2 = spec.ligacoes.findIndex((l, i) => i > iGw && l.de === 'gw' && l.para === 'abre');
  assert.ok(iGw >= 0 && iGw2 > iGw);
  assert.equal(r.fluxos[iGw], r.fluxos[iGw2]);
  assert.equal(r.origem.linkSequences[iGw], r.origem.linkSequences[iGw2]);
  const F = carregarFluiggers();
  const p = F.parseProcess(r.texto);
  assert.equal(p.flows.filter((f) => f.attributes.sourceRef === r.ids.gw && f.attributes.targetRef === r.ids.abre).length, 1);
  const no = p.elements.find((e) => e.id === r.ids.gw);
  const condicoes = F.gateway.parseGatewayConditions(no.attributes.condition).conditions;
  assert.equal(condicoes.filter((c) => c.targetTask === r.ids.abre).length, 2);
  assert.equal(condicoes.length, 3);
});

test('atribuição: a humana tem managerMechanism e managerAssignmentControllerString', () => {
  const spec = fixture('spec-completa');
  const r = specParaProcess(spec);
  const F = carregarFluiggers();
  const p = F.parseProcess(r.texto);
  const sol = p.elements.find((e) => e.id === r.ids.sol);
  assert.equal(sol.attributes.managerMechanism, 'Pool Papel');
  assert.match(sol.attributes.managerAssignmentControllerString, /admin/);
  const ges = p.elements.find((e) => e.id === r.ids.ges);
  assert.equal(ges.attributes.managerMechanism, 'Papel');
});

test('regressão do contorno 1: uma chamada do vendor grava só um atributo; duas gravam os dois', () => {
  const F = carregarFluiggers();
  const T = { templateText: F.templateCriacao };
  const base = F.buildProcessScaffold(F.templateCriacao, 'regressao', { description: 'x' }).text;
  const criada = F.editor.createIsolatedNode(base, { kind: 'task', subtype: '80', x: 10, y: 10, ...T });
  const cfg = { mechanism: 'Papel', mechanismConfiguration: { roleId: 'gestor' } };
  const um = F.editor.patchTaskAssignment(criada.text, criada.elementId, cfg);
  const dois = F.editor.patchTaskAssignment(um.text, criada.elementId, cfg);
  const attrs = (texto) => F.parseProcess(texto).elements.find((e) => e.id === criada.elementId).attributes;
  assert.equal(attrs(um.text).managerMechanism, undefined, 'o defeito da 3.0.1 mudou: revise o contorno 1');
  assert.ok(attrs(um.text).managerAssignmentControllerString);
  assert.equal(attrs(dois.text).managerMechanism, 'Papel');
  assert.ok(attrs(dois.text).managerAssignmentControllerString);
});

test('layout sem posições: coordenadas exatas para início, tarefa e gateway', () => {
  const spec = {
    processId: 'layout_x',
    atividades: [
      { id: 'a', tipo: 'inicio', nome: 'Início' },
      { id: 'b', tipo: 'humana', nome: 'Tarefa', responsavel: { tipo: 'papel', valor: 'gestor' } },
      { id: 'c', tipo: 'gateway_exclusivo', nome: 'Decide' },
      { id: 'd', tipo: 'fim', nome: 'Fim' },
      { id: 'e', tipo: 'cancelamento', nome: 'Cancelado' },
    ],
    ligacoes: [
      { de: 'a', para: 'b' },
      { de: 'b', para: 'c' },
      { de: 'c', para: 'd', ordem: 1, condicao: { js: 'true' } },
      { de: 'c', para: 'e', padrao: true },
    ],
  };
  const r = specParaProcess(spec);
  assert.deepEqual(r.posicoes.a, { x: 135, y: 110 }); // coluna 0, linha 0: +35, +10
  assert.deepEqual(r.posicoes.b, { x: 350, y: 100 }); // coluna 1: 0, 0
  assert.deepEqual(r.posicoes.c, { x: 623, y: 98 }); // coluna 2: +23, -2
  assert.deepEqual(r.posicoes.d, { x: 885, y: 110 }); // coluna 3, linha 0
  assert.deepEqual(r.posicoes.e, { x: 885, y: 260 }); // coluna 3, linha 1
  const lida = lerProcess(r.texto).spec;
  assert.deepEqual(lida.atividades.find((x) => x.id === `s${/\d+$/.exec(r.ids.c)[0]}`).posicao, { x: 623, y: 98 });
});

test('posições parciais e não inteiras viram aviso', () => {
  const parcial = fixture('spec-completa');
  delete parcial.atividades[0].posicao;
  assert.ok(specParaProcess(parcial).avisos.some((a) => a.codigo === 'W_GERADOR_POSICAO_PARCIAL'));
  const quebrada = fixture('spec-completa');
  quebrada.atividades[1].posicao = { x: 10.6, y: 20 };
  const r = specParaProcess(quebrada);
  assert.ok(r.avisos.some((a) => a.codigo === 'W_GERADOR_POSICAO_ARREDONDADA'));
  assert.deepEqual(r.posicoes.sol, { x: 11, y: 20 });
});

test('determinismo: a mesma spec gera o mesmo texto', () => {
  assert.equal(specParaProcess(fixture('spec-completa')).texto, specParaProcess(fixture('spec-completa')).texto);
});

test('condicao.nome → E_PROCESS_CONDICAO_NOME', () => {
  const spec = fixture('spec-completa');
  spec.ligacoes.find((l) => l.condicao).condicao.nome = 'Maior que cem';
  rejeita(() => specParaProcess(spec), 'E_PROCESS_CONDICAO_NOME', /tire `nome` da ligação gw→abre/);
});

test('vendor lançando → E_PROCESS_VENDOR (ligação para id inexistente, spec não validada)', () => {
  const spec = fixture('spec-completa');
  spec.ligacoes.push({ de: 'fim', para: 'nao_existe' });
  rejeita(() => specParaProcess(spec), 'E_PROCESS_VENDOR', /ligação de fim→nao_existe/);
});

test('P2: compararSpecProcess detecta divergência', () => {
  const spec = fixture('spec-completa');
  const r = specParaProcess(spec);
  const lida = lerProcess(r.texto).spec;
  const alterada = fixture('spec-completa');
  alterada.atividades[1].nome = 'Outro nome';
  alterada.atividades[1].responsavel.valor = 'outro';
  alterada.ligacoes.pop();
  const campos = compararSpecProcess(alterada, lida, { ids: r.ids, posicoes: r.posicoes }).map((d) => d.campo);
  assert.ok(campos.includes('atividades.sol.nome'));
  assert.ok(campos.includes('atividades.sol.responsavel'));
  assert.ok(campos.includes('ligacoes.length'));
});

test('oráculo offline com o plano B: .process → ECM30 próprio → spec igual e igual ao gerarXmlProcesso', async () => {
  for (const [nome, obter] of CASOS) {
    const spec = obter();
    const r = specParaProcess(spec, { versaoAlvo: '2.0' });
    const raiz = mkdtempSync(join(tmpdir(), 'spec-process-'));
    const cache = mkdtempSync(join(tmpdir(), 'cache-vazio-'));
    try {
      mkdirSync(join(raiz, 'workflow', 'diagrams'), { recursive: true });
      const caminho = join(raiz, 'workflow', 'diagrams', `${spec.processId}.process`);
      writeFileSync(caminho, r.texto);
      for (const versaoAlvo of ['1.8.2', '2.0']) {
        const g = await regenerar(caminho, { versao: versaoAlvo, conversor: 'proprio', cache });
        const lido = lerXmlProcesso(g.ecm30.conteudo);
        assert.deepEqual(compararSpecProcess(spec, lido.spec, { ids: r.ids, posicoes: r.posicoes }), [], `${nome} ${versaoAlvo}`);
        // o layout automático do .process centraliza na célula (deslocamentos da §4); o gerarXmlProcesso não.
        // Por isso o cruzamento usa a spec com as posições efetivamente gravadas no .process.
        const comPosicoes = JSON.parse(JSON.stringify(spec));
        for (const a of comPosicoes.atividades) a.posicao = r.posicoes[a.id];
        const direto = await gerarXmlProcesso(comPosicoes, { versaoAlvo, origem: r.origem });
        assert.equal(direto.ok, true, JSON.stringify(direto.erros));
        assert.deepEqual(compararXml(g.ecm30.conteudo, direto.xml, { versaoAlvo }), [], `${nome} ${versaoAlvo}`);
      }
    } finally {
      rmSync(raiz, { recursive: true, force: true });
      rmSync(cache, { recursive: true, force: true });
    }
  }
});

test('specParaProcess com geral: categoria e instrução no BpmnProcess (volume e expediente Default); sem erro no validateProcess', () => {
  const spec = fixture('spec-completa');
  const r = specParaProcess(spec, { versaoAlvo: '2.0', geral: { categoria: 'Compras', instrucao: 'Instrução X' } });
  const F = carregarFluiggers();
  assert.deepEqual(F.validateProcess(F.parseProcess(r.texto)).errors, []);
  const bp = /<bpmn2:BpmnProcess\b[\s\S]*?>\s*</.exec(r.texto)[0];
  assert.match(bp, /category="Compras"/);
  assert.match(bp, /volume="Default"/);
  assert.match(bp, /expedient="Default"/);
  assert.match(bp, /instruction="Instru/);
});

test('specParaProcess com geral: sem descricao na spec, name = geral.descricao; com descricao, a da spec', () => {
  const spec = fixture('spec-completa');
  const geral = { descricao: 'Descrição do servidor', categoria: 'Compras' };
  delete spec.descricao;
  const r = specParaProcess(spec, { versaoAlvo: '2.0', geral });
  assert.match(/<bpmn2:BpmnProcess\b[\s\S]*?>\s*</.exec(r.texto)[0], /name="Descri[^"]*do servidor"/);
  const spec2 = fixture('spec-completa');
  const r2 = specParaProcess(spec2, { versaoAlvo: '2.0', geral });
  assert.ok(r2.texto.includes('Fluxo de exemplo do gerador'));
});

test('specParaProcess sem geral: texto idêntico ao de antes (opção geral undefined)', () => {
  const spec = fixture('spec-completa');
  assert.equal(specParaProcess(spec, { versaoAlvo: '2.0' }).texto, specParaProcess(spec, { versaoAlvo: '2.0', geral: undefined }).texto);
  assert.match(/<bpmn2:BpmnProcess\b[\s\S]*?>\s*</.exec(specParaProcess(spec, { versaoAlvo: '2.0' }).texto)[0], /category=""/);
});

test('specParaProcess com geral: volume e expediente customizados do servidor são gravados e validam', () => {
  const spec = fixture('spec-completa');
  const r = specParaProcess(spec, { versaoAlvo: '2.0', geral: { categoria: 'Compras', volume: 'VolRH', expediente: 'Exp8h' } });
  const F = carregarFluiggers();
  assert.deepEqual(F.validateProcess(F.parseProcess(r.texto)).errors, []);
  const bp = /<bpmn2:BpmnProcess\b[\s\S]*?>\s*</.exec(r.texto)[0];
  assert.match(bp, /volume="VolRH"/);
  assert.match(bp, /expedient="Exp8h"/);
});
