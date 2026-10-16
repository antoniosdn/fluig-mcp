import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cortar, assinatura, normalizarParametros, caminhoApi, resumirLog, LIMITES } from '../src/logsearch.js';

const L = (h, txt) => `2026-10-16 ${h},123 INFO  [com.fluig.X] (Worker-5) ${txt}`;

test('cortar mantém o começo e informa quanto cortou', () => {
  assert.equal(cortar('abc', 10), 'abc');
  assert.equal(cortar('x'.repeat(50), 10), 'x'.repeat(10) + ' …[+40 caracteres]');
});

test('assinatura ignora data, uuid e números', () => {
  const a = assinatura(L('19:05:50', 'job >282571a7-eb10-4bc4-a7c8-3fb54b167434 instancia 123'));
  const b = assinatura(L('19:06:13', 'job >b9bca564-2fa2-4f15-9a32-cf53fa07f5a1 instancia 987'));
  assert.equal(a, b);
  assert.notEqual(a, assinatura(L('19:06:13', 'outra coisa')));
});

test('parâmetros respeitam padrões e limites', () => {
  const p = normalizarParametros({});
  assert.equal(p.arquivo, 'server.log');
  assert.equal(p.janela, LIMITES.janelaPadrao);
  assert.equal(p.max, LIMITES.ocorrenciasPadrao);
  assert.equal(p.contexto, 0);
  assert.equal(p.agrupar, true);
  const q = normalizarParametros({ janela: 999999, max: 0, charsLinha: 5, contexto: 50 });
  assert.equal(q.janela, LIMITES.janelaMax);
  assert.equal(q.max, 1);
  assert.equal(q.charsLinha, 40);
  assert.equal(q.contexto, LIMITES.contextoMax);
});

test('caminho: filtro vai para a widget só sem contexto', () => {
  const sem = caminhoApi('/x/api/logs/', normalizarParametros({ filtro: 'ERROR' }));
  assert.match(sem, /^\/x\/api\/logs\/ler\?/);
  assert.match(sem, /filtro=ERROR/);
  assert.match(sem, /ignorarCaixa=true/);
  const com = caminhoApi('/x/api/logs', normalizarParametros({ filtro: 'ERROR', contexto: 2 }));
  assert.doesNotMatch(com, /filtro=/);
});

test('agrupa repetidas, conta e guarda primeira e última ocorrência', () => {
  const linhas = [
    L('19:05:50', 'job >282571a7-eb10-4bc4-a7c8-3fb54b167434'),
    L('19:06:00', 'ERRO no dataset ds_x'),
    L('19:06:13', 'job >b9bca564-2fa2-4f15-9a32-cf53fa07f5a1'),
  ];
  const r = resumirLog({ linhas, ocorrencias: 25353 }, { filtro: 'job' });
  assert.equal(r.ocorrenciasNoArquivo, 25353);
  assert.equal(r.gruposDistintos, 1);
  assert.equal(r.grupos[0].qtd, 2);
  assert.equal(r.grupos[0].primeira, '2026-10-16 19:05:50');
  assert.equal(r.grupos[0].ultima, '2026-10-16 19:06:13');
});

test('semStack descarta linhas de stack trace', () => {
  const linhas = ['\tat com.fluig.A.b(A.java:1)', L('19:00:00', 'ERROR falhou'), 'Caused by: java.lang.X'];
  const r = resumirLog({ linhas }, { semStack: true, agrupar: false });
  assert.deepEqual(r.linhas, [L('19:00:00', 'ERROR falhou')]);
});

test('contexto devolve vizinhas, marca a ocorrência e une blocos sobrepostos', () => {
  const linhas = ['a', 'b', 'ERRO 1', 'c', 'ERRO 2', 'd', 'e', 'f', 'g', 'ERRO 3', 'h'];
  const r = resumirLog({ linhas }, { filtro: 'erro', contexto: 1 });
  assert.equal(r.ocorrenciasNaJanela, 3);
  assert.equal(r.blocos.length, 2);
  assert.deepEqual(r.blocos[0], ['  b', '» ERRO 1', '  c', '» ERRO 2', '  d']);
  assert.deepEqual(r.blocos[1], ['  g', '» ERRO 3', '  h']);
});

test('trava de tamanho total corta os itens mais antigos', () => {
  const linhas = Array.from({ length: 100 }, (_, i) => `linha distinta ${'x'.repeat(i)} ` + 'y'.repeat(1900));
  const r = resumirLog({ linhas }, { agrupar: false, max: 100, charsLinha: 2000 });
  assert.ok(JSON.stringify(r).length <= LIMITES.charsTotalMax);
  assert.ok(r.omitidosPorTamanho > 0);
  assert.match(r.linhas[r.linhas.length - 1], /x{99}/, 'a mais recente tem que sobrar');
});

test('diferenciarCaixa: "ERROR" não pega ErrorLogServiceBean', () => {
  const linhas = [L('20:00:00', 'ERROR falhou'), '2026-10-16 20:00:01,1 INFO  [x.WorkflowProcessErrorLogServiceBean] <id'];
  assert.equal(resumirLog({ linhas }, { filtro: 'ERROR', agrupar: false }).linhas.length, 2);
  assert.equal(resumirLog({ linhas }, { filtro: 'ERROR', agrupar: false, diferenciarCaixa: true }).linhas.length, 1);
  assert.match(caminhoApi('/b', normalizarParametros({ filtro: 'ERROR', diferenciarCaixa: true })), /ignorarCaixa=false/);
});
