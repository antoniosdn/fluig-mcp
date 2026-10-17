import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compararIdaEVolta, compararXml, formatarCobertura, projetarXml } from '../src/flow/comparar.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { gerarXmlProcesso } from '../src/flow/gerar.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');

/** XML gerado a partir da leitura do original (a "volta"). */
async function volta(xml, versaoAlvo = '1.8.2') {
  const lido = lerXmlProcesso(xml);
  const r = await gerarXmlProcesso(lido.spec, { versaoAlvo, modelo: xml, origem: lido.origem });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  return r.xml;
}

// E1 do medicao_contrato: S7 tem atribuição "Executor Atividade", que a v1 não guarda
const EXCLUIR_S7 = new Set(['S7.engineAllocationId', 'S7.engineAllocationConfiguration']);

const dif = (difs, chave, campo) => difs.filter((d) => d.chave === chave && d.campo === campo);

/** Troca a primeira ocorrência do regex em `texto` (falha se não achar). */
function trocar(texto, re, novo) {
  assert.ok(re.test(texto), `padrão não encontrado: ${re}`);
  return texto.replace(re, novo);
}

/* ------------------------------------------------------------------ */
/* Fixtures do repositório                                             */
/* ------------------------------------------------------------------ */

test('medicao_contrato (1.8.2): ida e volta igual, com a cobertura exata', async () => {
  const r = await compararIdaEVolta(fixture('medicao_contrato'), { versaoAlvo: '1.8.2' });
  assert.equal(r.processId, 'medicao_contrato');
  assert.equal(r.resultado, 'igual', JSON.stringify(r.diferencas));
  assert.deepEqual(r.diferencas, []);
  assert.deepEqual(r.motivos, []);
  assert.equal(r.exclusoes.length, 2);
  assert.ok(r.exclusoes.some((e) => e.startsWith('E1:')));
  assert.ok(r.exclusoes.some((e) => e.startsWith('E4:')));

  const c = r.cobertura;
  assert.deepEqual(c.atividades, { total: 8, v1: 8, capturasRegeradas: 0, foraV1: {} });
  assert.deepEqual(c.ligacoes, { total: 8, v1: 8, automaticas: 1, padrao: 0 });
  assert.deepEqual(c.condicoes, { total: 3, js: 0, regras: 3, v1: 3 });
  assert.deepEqual(c.regras, { total: 3, v1: 3 });
  assert.deepEqual(c.atribuicoes, { total: 2, v1: { papel: 0, pool_papel: 1 }, foraV1: { 'Executor Atividade': 1 } });
  assert.deepEqual(c.perdas, {
    'ProcessState.instruction': 1,
    'ProcessState.deadlineTime': 2,
    'ProcessState.notifyRequisitionerDelay': 1,
    'ProcessState.frequenceRequisitionerTime': 1,
    'ProcessState.notifyRequisitionerFollowUp': 1,
    'ProcessState.periodId': 1,
    'ProcessLink.name': 4,
    'ProcessLink.automaticLink': 1,
    'ProcessStateService.sucessFullMessage': 1,
  });
  assert.equal(c.ignorados.I_SCRIPTS, 1);
  assert.equal(c.ignorados.I_RAIAS, 1);
});

test('sintetico-paralelo-2.0 (2.0): ida e volta igual (captura de erro mantém o sequence)', async () => {
  const r = await compararIdaEVolta(fixture('sintetico-paralelo-2.0'), { versaoAlvo: '2.0' });
  assert.equal(r.resultado, 'igual', JSON.stringify(r.diferencas));
  assert.deepEqual(r.diferencas, []);
  assert.deepEqual(r.cobertura.atividades, { total: 11, v1: 11, capturasRegeradas: 1, foraV1: {} });
  // a ligação captura -> tratamento conta como ligação v1
  assert.equal(r.cobertura.ligacoes.v1, r.cobertura.ligacoes.total);
});

test('rpa (1.8.2): captura de erro com tratamento volta igual; cobertura 16/16 e 16/16', async () => {
  const r = await compararIdaEVolta(fixture('rpa'), { versaoAlvo: '1.8.2' });
  assert.equal(r.resultado, 'igual', JSON.stringify([...r.motivos, ...r.diferencas]));
  assert.deepEqual(r.motivos, []);
  assert.deepEqual(r.diferencas, []);
  const c = r.cobertura;
  assert.deepEqual(c.atividades, { total: 16, v1: 16, capturasRegeradas: 2, foraV1: {} });
  assert.equal(c.ligacoes.total, 16);
  assert.equal(c.ligacoes.v1, 16);
  // campos que a v1 não guarda (iguais nas duas pontas): contados, sem virar diferença
  assert.equal(c.perdas['ProcessLink.name'], 4);
});

test('XML ilegível vira resultado erro com E_LEITOR (não lança)', async () => {
  const r = await compararIdaEVolta('<list></list>', { versaoAlvo: '1.8.2' });
  assert.equal(r.resultado, 'erro');
  assert.equal(r.motivos[0].codigo, 'E_LEITOR');
  assert.equal(r.cobertura, null);
});

/* ------------------------------------------------------------------ */
/* Sensibilidade do comparador                                         */
/* ------------------------------------------------------------------ */

test('sensibilidade: o gerado igual ao original não tem diferença', async () => {
  const xml = fixture('medicao_contrato');
  assert.deepEqual(compararXml(xml, await volta(xml), { versaoAlvo: '1.8.2', excluir: EXCLUIR_S7 }), []);
  // sem a exclusão E1 a perda de comportamento aparece
  const sem = compararXml(xml, await volta(xml), { versaoAlvo: '1.8.2' });
  assert.deepEqual(sem.map((d) => `${d.chave}.${d.campo}`), ['S7.engineAllocationId', 'S7.engineAllocationConfiguration']);
});

test('sensibilidade: cada estrago no XML gerado aparece com a chave e o campo certos', async () => {
  const xml = fixture('medicao_contrato');
  const gerado = await volta(xml);
  const opts = { versaoAlvo: '1.8.2', excluir: EXCLUIR_S7 };
  const primeiroEstado = [...projetarXml(gerado, opts).estados.keys()][0];

  // nome da atividade
  const g1 = trocar(gerado, /<stateName>[^<]*<\/stateName>/, '<stateName>OUTRO NOME</stateName>');
  assert.equal(dif(compararXml(xml, g1, opts), primeiroEstado, 'stateName').length, 1);

  // destino de uma condição
  const g2 = trocar(gerado, /<destinationSequenceId>(\d+)<\/destinationSequenceId>/, '<destinationSequenceId>999</destinationSequenceId>');
  const d2 = compararXml(xml, g2, opts).filter((d) => d.campo === 'destinationSequenceId');
  assert.equal(d2.length, 1);
  assert.equal(d2[0].gerado, '999');
  assert.match(d2[0].chave, /^C\d+:\d+$/);

  // operador de uma regra
  const g3 = trocar(gerado, /<operator>1<\/operator>/, '<operator>2</operator>');
  const d3 = compararXml(xml, g3, opts).filter((d) => d.campo === 'operator');
  assert.equal(d3.length, 1);
  assert.match(d3[0].chave, /^R\d+:\d+:\d+$/);
  assert.deepEqual([d3[0].original, d3[0].gerado], ['1', '2']);

  // ProcessLink removido
  const g4 = trocar(gerado, /<ProcessLink>[\s\S]*?<\/ProcessLink>\s*/, '');
  const d4 = compararXml(xml, g4, opts);
  assert.equal(d4.length, 1);
  assert.equal(d4[0].campo, '(elemento)');
  assert.deepEqual([d4[0].original, d4[0].gerado], ['presente', 'ausente']);
  assert.match(d4[0].chave, /^L\d+$/);

  // retorno permitido
  const g5 = trocar(gerado, /<returnPermited>false<\/returnPermited>/, '<returnPermited>true</returnPermited>');
  const d5 = compararXml(xml, g5, opts).filter((d) => d.campo === 'returnPermited');
  assert.equal(d5.length, 1);
  assert.match(d5[0].chave, /^L\d+$/);

  // papel da atribuição
  const g6 = trocar(gerado, /&lt;Role&gt;([^&]*)&lt;\/Role&gt;/, '&lt;Role&gt;papelTrocado&lt;/Role&gt;');
  const d6 = compararXml(xml, g6, opts).filter((d) => d.campo === 'engineAllocationConfiguration');
  assert.equal(d6.length, 1);
  assert.match(d6[0].chave, /^S\d+$/);
  assert.ok(d6[0].gerado.includes('papelTrocado'));

  // ProcessLink duplicado no gerado
  const g8 = trocar(gerado, /<ProcessLink>[\s\S]*?<\/ProcessLink>\s*/, (bloco) => bloco + bloco);
  const d8 = compararXml(xml, g8, opts);
  assert.equal(d8.length, 1);
  assert.equal(d8[0].campo, '(duplicado)');
  assert.match(d8[0].chave, /^L\d+$/);
  assert.deepEqual([d8[0].original, d8[0].gerado], [1, 2]);

  // ProcessState a mais, com sequence vazio
  const g9 = trocar(gerado, /<ProcessState>[\s\S]*?<\/ProcessState>\s*/, (bloco) => bloco + bloco.replace(/<sequence>\d+<\/sequence>/, '<sequence></sequence>'));
  const d9 = compararXml(xml, g9, opts);
  assert.deepEqual(d9, [{ chave: 'ProcessState', campo: '(sem chave)', original: 0, gerado: 1 }]);

  // o estrago também vem do lado do original
  const o7 = trocar(xml, /<positionX>\d+<\/positionX>/, '<positionX>12345</positionX>');
  assert.ok(compararXml(o7, gerado, opts).some((d) => d.campo === 'positionX'));
});

/* ------------------------------------------------------------------ */
/* Exclusões que não disparam                                          */
/* ------------------------------------------------------------------ */

test('exclusões: prazo, instrução, rótulo de ligação e ordem dos elementos não viram diferença', async () => {
  const xml = fixture('medicao_contrato');
  const base = await compararIdaEVolta(xml, { versaoAlvo: '1.8.2' });

  // mexe só depois do primeiro ProcessState, para não pegar o ProcessDefinition
  const corte = xml.indexOf('<ProcessState>');
  let cauda = xml.slice(corte);
  cauda = trocar(cauda, /<deadlineTime>0<\/deadlineTime>/, '<deadlineTime>777</deadlineTime>');
  cauda = trocar(cauda, /<instruction><\/instruction>/, '<instruction>texto novo</instruction>');
  cauda = trocar(cauda, /<name><\/name>/, '<name>Rótulo novo</name>');
  // inverte a ordem dos ProcessState
  const estados = cauda.match(/<ProcessState>[\s\S]*?<\/ProcessState>/g);
  assert.ok(estados.length > 2);
  const invertidos = [...estados].reverse();
  let i = 0;
  cauda = cauda.replace(/<ProcessState>[\s\S]*?<\/ProcessState>/g, () => invertidos[i++]);
  const alterado = xml.slice(0, corte) + cauda;

  const r = await compararIdaEVolta(alterado, { versaoAlvo: '1.8.2' });
  assert.equal(r.resultado, 'igual', JSON.stringify(r.diferencas));
  assert.equal(r.cobertura.perdas['ProcessState.deadlineTime'], base.cobertura.perdas['ProcessState.deadlineTime'] + 1);
  assert.equal(r.cobertura.perdas['ProcessState.instruction'], base.cobertura.perdas['ProcessState.instruction'] + 1);
  assert.equal(r.cobertura.perdas['ProcessLink.name'], base.cobertura.perdas['ProcessLink.name'] + 1);
});

/* ------------------------------------------------------------------ */
/* processIdSubstituto                                                 */
/* ------------------------------------------------------------------ */

test('processId com espaço: erro sem substituto; igual com substituto e a exclusão registrada', async () => {
  const spec = {
    processId: 'proc_min',
    descricao: 'Processo mínimo',
    formId: 10,
    atividades: [
      { id: 'ini', tipo: 'inicio', nome: 'Início' },
      { id: 'sol', tipo: 'humana', nome: 'Solicitar', responsavel: { tipo: 'pool_papel', valor: 'compras' } },
      { id: 'fim', tipo: 'fim', nome: 'Concluído' },
    ],
    ligacoes: [
      { de: 'ini', para: 'sol' },
      { de: 'sol', para: 'fim' },
    ],
  };
  const gerado = await gerarXmlProcesso(spec, { versaoAlvo: '1.8.2' });
  assert.equal(gerado.ok, true);
  const xml = gerado.xml.split('proc_min').join('proc min');
  assert.ok(xml.includes('<processId>proc min</processId>'));

  const sem = await compararIdaEVolta(xml, { versaoAlvo: '1.8.2' });
  assert.equal(sem.resultado, 'erro');
  assert.deepEqual(sem.motivos.map((m) => m.codigo), ['E_PROCESSID']);

  const com = await compararIdaEVolta(xml, {
    versaoAlvo: '1.8.2',
    processIdSubstituto: (id) => id.replace(/[^A-Za-z0-9_]/g, '_'),
  });
  assert.equal(com.resultado, 'igual', JSON.stringify(com.diferencas));
  assert.deepEqual(com.exclusoes, ['processId substituído: "proc min" -> "proc_min"']);
});

/* ------------------------------------------------------------------ */
/* formatarCobertura                                                   */
/* ------------------------------------------------------------------ */

test('formatarCobertura: cabeçalho, uma linha por XML e o total', async () => {
  const a = await compararIdaEVolta(fixture('medicao_contrato'), { versaoAlvo: '1.8.2' });
  const b = await compararIdaEVolta(fixture('rpa'), { versaoAlvo: '1.8.2' });
  const e = await compararIdaEVolta('<list></list>', { versaoAlvo: '1.8.2' });
  e.nome = 'quebrado';
  const linhas = formatarCobertura([a, b, e]).split('\n');
  assert.equal(linhas.length, 1 + 3 + 1);
  assert.match(linhas[0], /^processo\s+resultado\s+ativ\s+lig\s+cond\s+regras\s+atrib\s+fora da v1/);
  assert.match(linhas[1], /^medicao_contrato\s+igual\s+8\/8\s+8\/8\s+3\/3\s+3\/3\s+1\/2\s+/);
  assert.match(linhas[1], /Executor Atividade 1/);
  assert.match(linhas[2], /^rpa\s+igual\s+16\/16\s+16\/16\s+4\/4\s+0\/0\s+5\/7\s+/);
  assert.match(linhas[3], /^quebrado\s+erro\s+-\s+-\s+-\s+-\s+-\s+E_LEITOR/);
  assert.match(linhas[4], /^TOTAL\s+3 xml\s+24\/24\s+24\/24\s+7\/7\s+3\/3\s+6\/9\s+/);
  assert.match(linhas[4], /igual 2; erro 1/);
});

test('fluxo automático ao lado da manual (mesma origem e destino): descartado, resultado igual com E6', async () => {
  const original = fixture('medicao_contrato');
  // gêmea manual de L14 (s5→s11, automática): ProcessLink novo com linkSequence 90
  const gemea =
    '<ProcessLink><processLinkPK><companyId>1</companyId><processId>medicao_contrato</processId><version>1</version>' +
    '<linkSequence>90</linkSequence></processLinkPK><returnPermited>false</returnPermited>' +
    '<initialStateSequence>5</initialStateSequence><finalStateSequence>11</finalStateSequence>' +
    '<automaticLink>false</automaticLink><defaultLink>false</defaultLink><type>0</type></ProcessLink>';
  const xml = trocar(original, /(<linkSequence>14<\/linkSequence>\s*<\/processLinkPK>[\s\S]*?<\/ProcessLink>)/, `$1${gemea}`);
  const r = await compararIdaEVolta(xml, { versaoAlvo: '1.8.2' });
  assert.equal(r.resultado, 'igual', JSON.stringify([r.diferencas, r.motivos]));
  assert.ok(r.exclusoes.some((e) => e.startsWith('E6: fluxo automático por prazo L14 ao lado da manual L90')), JSON.stringify(r.exclusoes));
  assert.ok(!r.exclusoes.some((e) => e.startsWith('E4:')));
  assert.equal(r.cobertura.ligacoes.total, 9);
  assert.equal(r.cobertura.ligacoes.v1, 8);
});
