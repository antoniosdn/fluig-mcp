import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lerDefinicao } from '../src/flow/definicao.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');

test('lerDefinicao: medicao_contrato', () => {
  assert.deepEqual(lerDefinicao(fixture('medicao_contrato')), {
    descricao: 'Medição de Contrato',
    categoria: 'Compras',
    volume: 'Default',
    expediente: 'Default',
    instrucao: '',
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
  assert.deepEqual(d, { descricao: 'x', categoria: '', volume: '', expediente: '', instrucao: '' });
  assert.throws(() => lerDefinicao('<list><a/></list>'), /ProcessDefinition/);
  assert.throws(() => lerDefinicao(''), /./);
});
