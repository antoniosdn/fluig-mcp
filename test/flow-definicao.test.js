import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerDefinicao, aplicarDefinicao, aplicarSlots, lerSlots } from '../src/flow/definicao.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');

test('lerDefinicao: medicao_contrato', () => {
  assert.deepEqual(lerDefinicao(fixture('medicao_contrato')), {
    descricao: 'Medição de Contrato',
    categoria: 'Compras',
    volume: 'Default',
    expediente: 'Default',
    instrucao: '',
    processCategoryId: '',
    icon: '',
  });
});

test('lerDefinicao: rpa', () => {
  const d = lerDefinicao(fixture('rpa'));
  assert.equal(d.descricao, 'Recibo de Pagamento de Autônomo');
  assert.equal(d.categoria, 'Financeiro');
  assert.equal(d.volume, 'Default');
  assert.equal(d.expediente, 'Default');
  assert.match(d.instrucao, /^O processo consiste em processar o pagamento/);
});

test('lerDefinicao: campo ausente vira vazio; XML sem ProcessDefinition lança', () => {
  const d = lerDefinicao('<list><ProcessDefinition><processDescription>x</processDescription></ProcessDefinition></list>');
  assert.deepEqual(d, { descricao: 'x', categoria: '', volume: '', expediente: '', instrucao: '', processCategoryId: '', icon: '' });
  assert.throws(() => lerDefinicao('<list><a/></list>'), /ProcessDefinition/);
  assert.throws(() => lerDefinicao(''), /./);
});

const BASE =
  '<list>\r\n  <ProcessDefinition>\r\n    <processDefinitionPK><processId>p</processId></processDefinitionPK>\r\n' +
  '    <processDescription>Velha</processDescription>\r\n    <instruction/>\r\n    <volumeId>Default</volumeId>\r\n' +
  '    <categoryId></categoryId>\r\n    <periodId>Default</periodId>\r\n    <warningDeadlineTime>0</warningDeadlineTime>\r\n' +
  '  </ProcessDefinition>\r\n  <Outro><categoryId>fora</categoryId></Outro>\r\n</list>';
const DEF = { descricao: 'Nova', categoria: 'Compras', volume: 'V', expediente: 'E', instrucao: 'Ins' };

test('aplicarDefinicao: troca os 5 campos (inclusive elemento vazio) e o resto fica igual', () => {
  const r = aplicarDefinicao(BASE, DEF, { versaoAlvo: '1.8.2' });
  assert.deepEqual(lerDefinicao(r), { ...DEF, processCategoryId: '', icon: '' });
  const fora = (x) => x.replace(/<ProcessDefinition>[\s\S]*<\/ProcessDefinition>/, '');
  assert.equal(fora(r), fora(BASE));
  assert.match(r, /<categoryId>fora<\/categoryId>/);
  assert.ok(!/[^\r]\n/.test(r), 'fins de linha CRLF preservados');
});

test('aplicarDefinicao: escapa XML e o lerDefinicao devolve o original', () => {
  const d = { ...DEF, descricao: 'A & B <c> "d" \'e\'', instrucao: 'x $& y' };
  const r = aplicarDefinicao(BASE, d, { versaoAlvo: '2.0' });
  assert.match(r, /A &amp; B &lt;c&gt; &quot;d&quot; &apos;e&apos;/);
  assert.equal(lerDefinicao(r).descricao, d.descricao);
  assert.equal(lerDefinicao(r).instrucao, d.instrucao);
});

test('aplicarDefinicao: chave ausente mantém o elemento', () => {
  const r = aplicarDefinicao(BASE, { categoria: 'Compras' }, { versaoAlvo: '2.0' });
  const l = lerDefinicao(r);
  assert.equal(l.categoria, 'Compras');
  assert.equal(l.descricao, 'Velha');
  assert.equal(l.volume, 'Default');
});

test('aplicarDefinicao: 2.0 insere processCategoryId e icon na ordem, depois do último elemento; troca se existem', () => {
  const d = { ...DEF, processCategoryId: 'abc', icon: 'ico' };
  const r = aplicarDefinicao(BASE, d, { versaoAlvo: '2.0' });
  assert.match(r, /<warningDeadlineTime>0<\/warningDeadlineTime>\r\n    <processCategoryId>abc<\/processCategoryId>\r\n    <icon>ico<\/icon>\r\n  <\/ProcessDefinition>/);
  assert.deepEqual(lerDefinicao(r), d);
  const r2 = aplicarDefinicao(r, { processCategoryId: 'novo', icon: 'outro' }, { versaoAlvo: '2.0' });
  assert.equal(lerDefinicao(r2).processCategoryId, 'novo');
  assert.equal(lerDefinicao(r2).icon, 'outro');
  assert.equal((r2.match(/<icon>/g) || []).length, 1);
});

test('aplicarDefinicao: 1.8.2 nunca escreve processCategoryId e icon; valor vazio também não', () => {
  const d = { ...DEF, processCategoryId: 'abc', icon: 'ico' };
  const r = aplicarDefinicao(BASE, d, { versaoAlvo: '1.8.2' });
  assert.doesNotMatch(r, /processCategoryId|<icon>/);
  const v = aplicarDefinicao(BASE, { processCategoryId: '', icon: '' }, { versaoAlvo: '2.0' });
  assert.equal(v, BASE);
});

test('aplicarDefinicao: round-trip e erro sem ProcessDefinition', () => {
  const d = { ...DEF, processCategoryId: 'abc', icon: 'ico' };
  assert.deepEqual(lerDefinicao(aplicarDefinicao(BASE, d, { versaoAlvo: '2.0' })), d);
  assert.throws(() => aplicarDefinicao('<list><a/></list>', DEF, { versaoAlvo: '2.0' }), /ProcessDefinition/);
});

const campo = (id, slot) =>
  `    <ProcessFormField>\n      <processFormFieldPK>\n        <companyId>1</companyId>\n        <processId>p</processId>\n        <fieldId>${id}</fieldId>\n      </processFormFieldPK>\n      <fieldDescription>${id}</fieldDescription>\n      <slotId>${slot}</slotId>\n    </ProcessFormField>\n`;
const comCampos = (pares) => `<list>\n  <ProcessDefinition>\n  </ProcessDefinition>\n  <list>\n${pares.map(([i, s]) => campo(i, s)).join('')}  </list>\n</list>\n`;

test('lerSlots: fieldId → slotId; ECM30 sem campos descritores → vazio', () => {
  assert.deepEqual([...lerSlots(comCampos([['date0', 2], ['number16', 1]]))], [['date0', '2'], ['number16', '1']]);
  assert.equal(lerSlots('<list><ProcessDefinition></ProcessDefinition></list>').size, 0);
});

test('aplicarSlots: mesmos campos com slots trocados → reaplica os do servidor e o resto fica igual', () => {
  const servidor = comCampos([['date0', 2], ['number16', 1], ['zoomfield1', 4], ['zoomfield2', 3]]);
  const novo = comCampos([['date0', 1], ['number16', 2], ['zoomfield1', 3], ['zoomfield2', 4]]);
  const r = aplicarSlots(novo, servidor);
  assert.equal(r.aplicado, true);
  assert.equal(r.xml, servidor);
  assert.equal(aplicarSlots(servidor, servidor).aplicado, false, 'já iguais: nada a fazer');
});

test('aplicarSlots: mesmos campos em outra ordem (reordenados no editor) → vale a numeração nova', () => {
  const servidor = comCampos([['date0', 2], ['number16', 1]]);
  const reordenado = comCampos([['number16', 1], ['date0', 2]]);
  assert.deepEqual(aplicarSlots(reordenado, servidor), { xml: reordenado, aplicado: false, motivo: 'os campos descritores foram reordenados' });
});

test('aplicarSlots: campos diferentes ou ausentes → não mexe', () => {
  const servidor = comCampos([['date0', 2], ['number16', 1]]);
  const outro = comCampos([['date0', 1], ['texto9', 2]]);
  assert.deepEqual(aplicarSlots(outro, servidor), { xml: outro, aplicado: false, motivo: 'os campos descritores mudaram' });
  const mais = comCampos([['date0', 1], ['number16', 2], ['texto9', 3]]);
  assert.equal(aplicarSlots(mais, servidor).aplicado, false);
  const vazio = '<list><ProcessDefinition></ProcessDefinition></list>';
  assert.deepEqual(aplicarSlots(vazio, vazio), { xml: vazio, aplicado: false, motivo: 'sem campos descritores' });
  assert.equal(aplicarSlots(vazio, servidor).aplicado, false);
});
