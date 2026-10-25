// Cache do importador do Studio (src/flow/conversor.js: IMPORTADORES, instalação e conferência). Offline,
// com tabelas falsas injetadas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONVERSORES, IMPORTADORES, conferirImportador, importadorParaVersao, instalarConversor, jarsImportador } from '../src/flow/conversor.js';
import { ARQUIVOS, SWT_FALSO, TODOS_IMPORTADOR, pastaImportador, pastaPlugins, tabelaFalsa, tabelaImportadorFalsa } from './_conversor-falso.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'imp-cache-'));
const limpar = (...d) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));
const rejeita = (p, codigo, re) => assert.rejects(p, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);

/** Fonte com o conversor falso e, se pedido, o importador falso na mesma pasta. */
function fonte({ importador = true, sem = [] } = {}) {
  const dir = tmp();
  pastaPlugins(dir);
  if (importador) pastaImportador(dir, { sem });
  return dir;
}

/** Os JARs do importador falso sem os dois SWT. */
function jarsSemSwt() {
  const swt = new Set(Object.values(SWT_FALSO).map(([n]) => n));
  return Object.fromEntries(Object.entries(TODOS_IMPORTADOR).filter(([n]) => !swt.has(n)));
}

test('--de completo: instala conversor e importador; manifesto com plataforma; repetir = jaInstalado', async () => {
  const cache = tmp();
  const de = fonte();
  try {
    const opcoes = { de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), plataforma: 'darwin' };
    const r = await instalarConversor(opcoes);
    assert.equal(r.jaInstalado, false);
    assert.equal(r.importador.instalado, true);
    assert.equal(r.importador.dir, join(cache, 'importador', '9.9.9.9'));
    assert.equal(r.importador.arquivos, 3, '2 JARs + o SWT da plataforma');
    const m = JSON.parse(readFileSync(join(r.importador.dir, 'manifesto.json'), 'utf8'));
    assert.equal(m.versaoStudio, '9.9.9.9');
    assert.equal(m.plataforma, 'darwin');
    assert.equal(m.origem.tipo, 'pasta');
    assert.deepEqual(readdirSync(join(r.importador.dir, 'plugins')).sort(), [...Object.keys(jarsSemSwt()), SWT_FALSO.darwin[0]].sort());
    // o conversor continua sem nada a mais em studio/<versão>
    assert.deepEqual(readdirSync(join(cache, 'studio', '9.9.9.9', 'plugins')).sort(), Object.keys(ARQUIVOS).sort());

    const c = await conferirImportador(r.importador.dir, '9.9.9.9', { tabela: tabelaImportadorFalsa(), plataforma: 'darwin' });
    assert.equal(c.classpath.length, 3);
    assert.ok(c.classpath[2].endsWith(SWT_FALSO.darwin[0]), 'SWT no fim do classpath');
    assert.equal(c.swt, c.classpath[2]);

    const de_novo = await instalarConversor(opcoes);
    assert.equal(de_novo.importador.jaInstalado, true);
  } finally {
    limpar(cache, de);
  }
});

test('--de sem o importador: conversor instalado, importador não, com a lista do que falta', async () => {
  const cache = tmp();
  const de = fonte({ sem: ['org.eclipse.graphiti_9.9.jar'] });
  try {
    const r = await instalarConversor({ de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), plataforma: 'darwin' });
    assert.equal(r.jaInstalado, false);
    assert.equal(r.importador.instalado, false);
    assert.equal(r.importador.codigo, 'E_FONTE');
    assert.match(r.importador.motivo, /org\.eclipse\.graphiti_9\.9\.jar/);
    assert.deepEqual(readdirSync(cache), ['studio']);
  } finally {
    limpar(cache, de);
  }
});

test('importador: false não instala; plataforma sem SWT → E_IMPORTADOR_PLATAFORMA; versão fora da tabela → sem campo', async () => {
  const cache = tmp();
  const de = fonte();
  try {
    const sem = await instalarConversor({ de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), importador: false });
    assert.equal(sem.importador, undefined);
    assert.deepEqual(readdirSync(cache), ['studio']);

    const linux = await instalarConversor({ de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), plataforma: 'linux' });
    assert.equal(linux.importador.instalado, false);
    assert.equal(linux.importador.codigo, 'E_IMPORTADOR_PLATAFORMA');

    const forados = await instalarConversor({ de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: {} });
    assert.equal(forados.importador, undefined);
  } finally {
    limpar(cache, de);
  }
});

test('sem versão (todas): cada versão completa leva o importador', async () => {
  const cache = tmp();
  const de = fonte();
  try {
    const r = await instalarConversor({ de, cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), plataforma: 'win32' });
    assert.deepEqual(r.map((x) => [x.versaoStudio, x.importador.instalado]), [['9.9.9.9', true], ['8.8.8.8', true]]);
    assert.ok(readdirSync(join(cache, 'importador', '8.8.8.8', 'plugins')).includes(SWT_FALSO.win32[0]));
  } finally {
    limpar(cache, de);
  }
});

test('--baixar: baixa o importador junto (URLs listadas); sem URL → instalado false com E_BAIXAR', async () => {
  const cache = tmp();
  const cache2 = tmp();
  try {
    const todos = { ...ARQUIVOS, ...TODOS_IMPORTADOR };
    const buscar = async (url) => {
      const nome = url.split('/').pop();
      return { status: 200, arrayBuffer: async () => todos[nome] };
    };
    const linhas = [];
    const r = await instalarConversor({ baixar: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabelaImportadorFalsa(), plataforma: 'darwin', buscar, log: (l) => linhas.push(l) });
    assert.equal(r.importador.instalado, true);
    assert.equal(JSON.parse(readFileSync(join(r.importador.dir, 'manifesto.json'), 'utf8')).origem.tipo, 'baixar');
    assert.ok(linhas.some((l) => /Download do importador do Studio 9\.9\.9\.9 \(darwin\)/.test(l)));
    assert.ok(linhas.some((l) => l.includes(SWT_FALSO.darwin[0])));
    assert.ok(!linhas.some((l) => l.includes(SWT_FALSO.win32[0])), 'só o SWT da plataforma');

    // conversor com URL, importador sem URL
    const tabelaImp = { '9.9.9.9': tabelaImportadorFalsa()['8.8.8.8'] };
    const r2 = await instalarConversor({ baixar: '9.9.9.9', cache: cache2, tabela: tabelaFalsa(), tabelaImportador: tabelaImp, plataforma: 'darwin', buscar });
    assert.equal(r2.importador.instalado, false);
    assert.equal(r2.importador.codigo, 'E_BAIXAR');
  } finally {
    limpar(cache, cache2);
  }
});

test('conferirImportador: JAR extra, JAR trocado, outra plataforma e manifesto ausente', async () => {
  const cache = tmp();
  const de = fonte();
  try {
    const tabela = tabelaImportadorFalsa();
    const r = await instalarConversor({ de, versao: '9.9.9.9', cache, tabela: tabelaFalsa(), tabelaImportador: tabela, plataforma: 'darwin' });
    const dir = r.importador.dir;
    await rejeita(conferirImportador(dir, '9.9.9.9', { tabela, plataforma: 'win32' }), 'E_IMPORTADOR_CACHE', /instalado para "darwin"/);
    writeFileSync(join(dir, 'plugins', 'intruso.jar'), 'x');
    await rejeita(conferirImportador(dir, '9.9.9.9', { tabela, plataforma: 'darwin' }), 'E_IMPORTADOR_CACHE', /intruso\.jar: JAR que não está na tabela/);
    rmSync(join(dir, 'plugins', 'intruso.jar'));
    writeFileSync(join(dir, 'plugins', 'org.eclipse.graphiti_9.9.jar'), 'adulterado');
    await rejeita(conferirImportador(dir, '9.9.9.9', { tabela, plataforma: 'darwin' }), 'E_IMPORTADOR_CACHE', /tamanho|SHA-256/);
    rmSync(join(dir, 'manifesto.json'));
    await rejeita(conferirImportador(dir, '9.9.9.9', { tabela, plataforma: 'darwin' }), 'E_IMPORTADOR_CACHE', /manifesto\.json/);
    await rejeita(conferirImportador(dir, '7.7.7.7', { tabela, plataforma: 'darwin' }), 'E_IMPORTADOR_CACHE', /sem importador/);
  } finally {
    limpar(cache, de);
  }
});

test('importadorParaVersao: exige conversor e importador da mesma versão; 1.8.2 cai no 2.0.0.2 com aviso', () => {
  const cache = tmp();
  try {
    const marcar = (raiz, v) => {
      mkdirSync(join(cache, raiz, v), { recursive: true });
      writeFileSync(join(cache, raiz, v, 'manifesto.json'), '{}');
    };
    assert.equal(importadorParaVersao('1.8.2', { cache }), null);
    marcar('studio', '1.8.2.0');
    assert.equal(importadorParaVersao('1.8.2', { cache }), null, 'só o conversor não basta');
    marcar('studio', '2.0.0.2');
    marcar('importador', '2.0.0.2');
    const sub = importadorParaVersao('1.8.2', { cache });
    assert.equal(sub.versaoStudio, '2.0.0.2');
    assert.equal(sub.aviso.codigo, 'W_IMPORTADOR_SUBSTITUTO');
    assert.equal(importadorParaVersao('2.0', { cache }).aviso, null);
    marcar('importador', '1.8.2.0');
    const ok = importadorParaVersao('1.8.2', { cache });
    assert.deepEqual([ok.versaoStudio, ok.aviso, ok.dirImportador], ['1.8.2.0', null, join(cache, 'importador', '1.8.2.0')]);
  } finally {
    limpar(cache);
  }
});

test('IMPORTADORES real: 16 JARs + SWT de macOS e Windows, SHA-256 válidos, Eclipse igual nas duas, URL só na 1.8.2.0', () => {
  assert.deepEqual(Object.keys(IMPORTADORES), Object.keys(CONVERSORES));
  for (const [v, def] of Object.entries(IMPORTADORES)) {
    assert.equal(def.jars.length, 16, v);
    assert.deepEqual(Object.keys(def.swt).sort(), ['darwin', 'win32']);
    for (const j of [...def.jars, ...Object.values(def.swt)]) {
      assert.match(j.sha256, /^[0-9a-f]{64}$/, j.nome);
      assert.ok(Number.isInteger(j.bytes) && j.bytes > 0, j.nome);
      if (v === '1.8.2.0') assert.ok(/^https?:\/\//.test(j.url), `${j.nome} com URL`);
      else assert.equal(j.url, undefined, `${j.nome} sem URL`);
    }
    assert.ok(def.jars[0].nome.startsWith('com.totvs.tds.ecm.designer.gui_'));
    assert.equal(jarsImportador(def, 'darwin').length, 17);
    assert.throws(() => jarsImportador(def, 'linux'), (e) => e.codigo === 'E_IMPORTADOR_PLATAFORMA');
  }
  const eclipse = (v) => IMPORTADORES[v].jars.filter((j) => j.origem === 'eclipse').map((j) => `${j.nome}:${j.sha256}`);
  assert.deepEqual(eclipse('1.8.2.0'), eclipse('2.0.0.2'));
  // nenhum JAR do importador repete um do conversor (o classpath junta os dois)
  const doConversor = new Set(CONVERSORES['1.8.2.0'].jars.map((j) => j.nome));
  assert.ok(IMPORTADORES['1.8.2.0'].jars.every((j) => !doConversor.has(j.nome)));
});

test('--de sem o SWT da plataforma: completa com o importador de outra versão já instalado (mesmos bytes)', async () => {
  const cache = tmp();
  const completa = fonte();
  const semSwtMac = fonte({ sem: [SWT_FALSO.darwin[0]] });
  try {
    const tabela = tabelaFalsa();
    const ti = tabelaImportadorFalsa();
    // a mesma tabela falsa nas duas versões: os JARs do importador são idênticos
    const tabelaImp = { '9.9.9.9': ti['9.9.9.9'], '8.8.8.8': ti['8.8.8.8'] };
    const opc = { cache, tabela, tabelaImportador: tabelaImp, plataforma: 'darwin' };
    // sem nada no cache, a 8.8.8.8 não instala e a mensagem orienta a instalar a outra antes
    const sem = await instalarConversor({ ...opc, de: semSwtMac, versao: '8.8.8.8' });
    assert.equal(sem.importador.instalado, false);
    assert.match(sem.importador.motivo, /instalar-conversor --baixar 1\.8\.2\.0/);
    // com a 9.9.9.9 instalada, a 8.8.8.8 completa o SWT pelo cache
    await instalarConversor({ ...opc, de: completa, versao: '9.9.9.9' });
    const linhas = [];
    const r = await instalarConversor({ ...opc, de: semSwtMac, versao: '8.8.8.8', log: (l) => linhas.push(l) });
    assert.equal(r.importador.instalado, true, JSON.stringify(r.importador));
    assert.ok(linhas.some((l) => l.includes(SWT_FALSO.darwin[0]) && l.includes('do cache')));
    const m = JSON.parse(readFileSync(join(cache, 'importador', '8.8.8.8', 'manifesto.json'), 'utf8'));
    assert.equal(m.origem.doCache.length, 1);
    await conferirImportador(join(cache, 'importador', '8.8.8.8'), '8.8.8.8', { tabela: tabelaImp, plataforma: 'darwin' });
  } finally {
    limpar(cache, completa, semSwtMac);
  }
});
