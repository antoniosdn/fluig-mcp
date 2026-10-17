// Carregador do recorte da Fluiggers 3.0.1 (vendor/fluiggers-3.0.1). Offline.
// Opcional: com FLUIGGERS_EXT_DIR=<pasta da extensão 3.0.1> confere que o vendor é reprodutível.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carregarFluiggers, DIR_VENDOR, HASHES_VENDOR, MODULOS_RECORTE } from '../src/flow/fluiggers.js';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

function montarFumaca(F) {
  const tpl = F.templateCriacao;
  const E = F.editor;
  let texto = F.buildProcessScaffold(tpl, 'fumaca', { description: 'Teste de fumaca' }).text;
  const no = (kind, subtype, x, y) => {
    const r = E.createIsolatedNode(texto, { kind, subtype, x, y, templateText: tpl });
    texto = r.text;
    return r.elementId;
  };
  const inicio = no('start', '10', 60, 100);
  const humana = no('task', '80', 220, 90);
  const fim = no('end', '60', 420, 100);
  texto = E.patchProcess(texto, humana, { name: 'Aprovar' }).text;
  texto = E.createSequenceFlow(texto, { sourceId: inicio, targetId: humana, bendpoints: [], templateText: tpl }).text;
  texto = E.createSequenceFlow(texto, { sourceId: humana, targetId: fim, bendpoints: [], templateText: tpl }).text;
  return texto;
}

test('carrega o recorte e expõe a API', () => {
  const F = carregarFluiggers();
  assert.equal(F.versao, '3.0.1');
  for (const fn of [
    F.parseProcess,
    F.validateProcess,
    F.buildProcessScaffold,
    F.renderProcessImageSvg,
    F.editor.createIsolatedNode,
    F.editor.createSequenceFlow,
    F.editor.patchProcess,
    F.editor.patchTaskAssignment,
    F.editor.patchGatewayBranches,
    F.editor.patchProcessForm,
    F.editor.createAttachedErrorEvent,
    F.gateway.parseGatewayConditions,
    F.roteador.routeOrthogonal,
  ]) {
    assert.equal(typeof fn, 'function');
  }
  assert.ok(F.templateCriacao.startsWith('<?xml version="1.0" encoding="ASCII"?>'));
  assert.equal(carregarFluiggers(), F);
});

test('fumaça: processo sintético válido, SVG determinístico', () => {
  const F = carregarFluiggers();
  const texto = montarFumaca(F);
  const v = F.validateProcess(F.parseProcess(texto));
  assert.equal(v.errors.length, 0, JSON.stringify(v.errors));
  const svg = F.renderProcessImageSvg(texto);
  assert.equal(typeof svg, 'string');
  assert.match(svg, /^(<\?xml[^>]*\?>\s*)?<svg/);
  assert.ok(svg.trimEnd().endsWith('</svg>'));
  assert.ok(svg.includes('Aprovar'));
  assert.equal(montarFumaca(F), texto);
  assert.equal(F.renderProcessImageSvg(montarFumaca(F)), svg);
  assert.match(texto, /^[\x00-\x7F]*$/);
});

test('o validador pega referência quebrada (POS-003)', () => {
  const F = carregarFluiggers();
  const texto = montarFumaca(F);
  const alvo = 'outgoingConnections="/0/@connections.0"';
  assert.ok(texto.includes(alvo));
  const quebrado = texto.replace(alvo, 'outgoingConnections="/0/@connections.7"');
  const v = F.validateProcess(F.parseProcess(quebrado));
  assert.ok(
    v.errors.some((e) => e.code === 'POS-003'),
    JSON.stringify(v.errors.map((e) => e.code))
  );
});

test('confere o SHA-256 antes de executar', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fluiggers-'));
  try {
    cpSync(DIR_VENDOR, tmp, { recursive: true });
    const arq = join(tmp, 'modulos.cjs');
    const b = readFileSync(arq);
    b[b.length - 10] ^= 1;
    writeFileSync(arq, b);
    assert.throws(
      () => carregarFluiggers({ dir: tmp }),
      (e) =>
        e.message.includes('modulos.cjs') &&
        e.message.includes(HASHES_VENDOR['modulos.cjs']) &&
        /[0-9a-f]{64}/.test(e.message.replace(HASHES_VENDOR['modulos.cjs'], '')) &&
        e.message.includes('Regenere')
    );
    unlinkSync(join(tmp, 'LICENSE.txt'));
    assert.throws(
      () => carregarFluiggers({ dir: tmp }),
      (e) => e.message.includes('LICENSE.txt') && e.message.includes('ausente')
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('recorte fechado: módulo fora da lista é recusado', () => {
  const F = carregarFluiggers();
  assert.throws(() => F.exigir('60177'), /módulo 60177 não está no recorte do vendor/);
});

test('PROCEDENCIA.md cita os hashes e os ids do recorte', () => {
  const doc = readFileSync(join(DIR_VENDOR, 'PROCEDENCIA.md'), 'utf8');
  for (const h of Object.values(HASHES_VENDOR)) assert.ok(doc.includes(h), h);
  for (const id of MODULOS_RECORTE) assert.ok(doc.includes(`\`${id}\``), id);
  assert.deepEqual(readdirSync(DIR_VENDOR).sort(), [
    'LICENSE.txt',
    'PROCEDENCIA.md',
    'creation-template.process.gz.b64',
    'modulos.cjs',
  ]);
});

const extDir = process.env.FLUIGGERS_EXT_DIR;
test(
  'vendor reprodutível a partir da extensão instalada',
  { skip: extDir ? false : 'defina FLUIGGERS_EXT_DIR com a pasta da extensão 3.0.1 para rodar' },
  () => {
    const r = spawnSync(process.execPath, [join(raiz, 'scripts', 'vendor-fluiggers.mjs'), extDir, '--conferir'], {
      encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
);
