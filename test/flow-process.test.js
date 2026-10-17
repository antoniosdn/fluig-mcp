// lerProcess: .process → spec v1 (src/flow/process.js). Offline, com .process sintético.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerProcess } from '../src/flow/process.js';
import { validarSpec } from '../src/flow/validar.js';
import { montarProcessoSintetico } from './_process-sintetico.js';
import { carregarFluiggers } from '../src/flow/fluiggers.js';

const codigos = (itens) => itens.map((i) => i.codigo);

test('processo sintético: spec esperada, origem e validarSpec ok', async () => {
  const { texto } = montarProcessoSintetico();
  const r = lerProcess(texto);
  assert.deepEqual(r.spec, {
    processId: 'sintetico',
    descricao: 'Processo sintetico',
    atividades: [
      { id: 's1', tipo: 'inicio', nome: 'Início', posicao: { x: 60, y: 100 } },
      { id: 's2', tipo: 'humana', nome: 'Aprovar', responsavel: { tipo: 'pool_papel', valor: 'admin' }, posicao: { x: 220, y: 90 } },
      { id: 's4', tipo: 'gateway_exclusivo', nome: 'Exclusivo', posicao: { x: 400, y: 100 } },
      { id: 's5', tipo: 'fim', nome: 'Fim', posicao: { x: 600, y: 60 } },
      { id: 's6', tipo: 'cancelamento', nome: 'Fim com cancelamento de processo', posicao: { x: 600, y: 160 } },
    ],
    ligacoes: [
      { de: 's1', para: 's2' },
      { de: 's2', para: 's4' },
      {
        de: 's4',
        para: 's5',
        ordem: 1,
        condicao: {
          regras: [
            { campo: 'parecer', op: 'igual', valor: 'sim' },
            { campo: 'valor', op: 'maior', valor: 'limite', valorTipo: 'campo' },
          ],
        },
      },
      { de: 's4', para: 's5', ordem: 2, condicao: { js: 'hAPI.getCardValue("x") == "1"' } },
      { de: 's4', para: 's6', padrao: true },
    ],
  });
  assert.deepEqual(r.origem.sequencias, { s1: 1, s2: 2, s4: 4, s5: 5, s6: 6 });
  assert.deepEqual(r.origem.capturas, {});
  assert.equal(r.origem.processId, 'sintetico');
  assert.equal(r.origem.versao, 1);
  assert.equal(r.origem.linkSequences.length, 5);
  assert.deepEqual(r.avisos, []);
  assert.ok(codigos(r.ignorados).includes('I_ATIVIDADE_CAMPOS'));
  const v = await validarSpec(r.spec, { versaoAlvo: '1.8.2' });
  assert.equal(v.ok, true, JSON.stringify(v.erros));
});

test('captura de erro: tratamento absorvido, sem saída, 2 saídas e com entrada', () => {
  // uma saída, nenhuma entrada: serviço ganha tratamentoErro; o fluxo da captura não entra em ligacoes
  let { texto, ids } = montarProcessoSintetico({ gateway: false, servico: 'tratado' });
  let r = lerProcess(texto);
  const sv = `s${/(\d+)$/.exec(ids.servico)[1]}`;
  const tr = `s${/(\d+)$/.exec(ids.tratamento)[1]}`;
  const cap = `s${/(\d+)$/.exec(ids.captura)[1]}`;
  assert.deepEqual(r.avisos, []);
  assert.equal(r.spec.atividades.find((a) => a.id === sv).tratamentoErro, tr);
  assert.deepEqual(r.spec.atividades.filter((a) => a.tipo === 'captura_erro'), []);
  assert.ok(!r.spec.ligacoes.some((l) => l.de === cap || l.para === cap));
  assert.equal(r.origem.capturas[sv], Number(cap.slice(1)));
  assert.equal(Object.keys(r.origem.tratamentos).join(), sv);
  assert.equal(r.origem.linkSequences.length, r.spec.ligacoes.length);
  assert.ok(!r.origem.linkSequences.includes(r.origem.tratamentos[sv]));

  // sem saída: descartada com aviso
  ({ texto } = montarProcessoSintetico({ gateway: false, servico: 'sem_saida' }));
  r = lerProcess(texto);
  assert.ok(codigos(r.avisos).includes('W_LEITOR_CAPTURA_SEM_TRATAMENTO'));
  assert.deepEqual(r.origem.tratamentos, {});

  // 2 saídas: captura_erro + aviso reescrito
  ({ texto } = montarProcessoSintetico({ gateway: false, servico: 'duas_saidas' }));
  r = lerProcess(texto);
  assert.ok(r.spec.atividades.some((a) => a.tipo === 'captura_erro'));
  const fluxo = r.avisos.find((a) => a.codigo === 'W_LEITOR_FLUXO_ERRO');
  assert.ok(fluxo && /uma única saída para a atividade de tratamento/.test(fluxo.mensagem));

  // com entrada: captura_erro + aviso
  ({ texto } = montarProcessoSintetico({ gateway: false, servico: 'com_entrada' }));
  r = lerProcess(texto);
  assert.ok(r.spec.atividades.some((a) => a.tipo === 'captura_erro'));
  assert.ok(codigos(r.avisos).includes('W_LEITOR_FLUXO_ERRO'));
});

test('captura de erro: fluxo com permiteRetorno não é absorvido', () => {
  const { texto, ids } = montarProcessoSintetico({ gateway: false, servico: 'tratado' });
  const F = carregarFluiggers();
  const fluxo = F.parseProcess(texto).flows.find((f) => f.attributes.sourceRef === ids.captura);
  const alterado = F.editor.patchProcess(texto, fluxo.id, { permiteRetorno: 'true' }).text;
  const r = lerProcess(alterado);
  assert.ok(r.spec.atividades.some((a) => a.tipo === 'captura_erro'));
  assert.deepEqual(r.origem.tratamentos, {});
  const w = r.avisos.find((a) => a.codigo === 'W_LEITOR_FLUXO_ERRO');
  assert.ok(w && w.mensagem.includes('permiteRetorno'), JSON.stringify(r.avisos));
});

test('atribuição "Executor Atividade" → W_LEITOR_ATRIBUICAO_FORA_V1 e sem responsável', () => {
  const { texto, ids } = montarProcessoSintetico({
    atribuicao: { mechanism: 'Executor Atividade', mechanismConfiguration: { idNode: 'startevent1', returns: '1' } },
    gateway: false,
  });
  const r = lerProcess(texto);
  assert.deepEqual(codigos(r.avisos), ['W_LEITOR_ATRIBUICAO_FORA_V1']);
  const humana = r.spec.atividades.find((a) => a.tipo === 'humana');
  assert.equal(humana.responsavel, undefined);
  assert.ok(ids.humana);
});

test('atribuição "Papel" vira responsavel.tipo papel', () => {
  const { texto } = montarProcessoSintetico({ atribuicao: { mechanism: 'Papel', mechanismConfiguration: { roleId: 'compras' } }, gateway: false });
  const r = lerProcess(texto);
  assert.deepEqual(r.spec.atividades.find((a) => a.tipo === 'humana').responsavel, { tipo: 'papel', valor: 'compras' });
  assert.deepEqual(r.avisos, []);
});

test('elemento sem dígitos finais no id → erro; sequence repetido → W_LEITOR_SEQUENCE_DUPLICADA', () => {
  const { texto } = montarProcessoSintetico({ gateway: false });
  assert.throws(() => lerProcess(texto.replace(/startevent1/g, 'iniciox')), /elemento iniciox sem sequence no id/);
  const dup = lerProcess(texto.replace(/id="endevent4"/, 'id="endevent2"').replace(/(sourceRef|targetRef)="endevent4"/g, '$1="endevent2"'));
  assert.ok(codigos(dup.avisos).includes('W_LEITOR_SEQUENCE_DUPLICADA'));
});

test('texto que não é .process → erro', () => {
  assert.throws(() => lerProcess('<nada/>'));
});
