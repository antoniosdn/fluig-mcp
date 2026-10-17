// Cache do conversor do Studio (src/flow/conversor.js). Offline, com tabela falsa injetada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONVERSORES, conferirConversor, dirCache, instalarConversor, studioParaVersao } from '../src/flow/conversor.js';
import { montarZip } from './_zip-builder.js';
import { ARQUIVOS, XSTREAM_FALSO, pastaPlugins, sha, tabelaFalsa } from './_conversor-falso.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'conv-teste-'));
const limpar = (...d) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));
const rejeita = (p, codigo, re) => assert.rejects(p, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);

test('fonte pasta: instala, manifesto correto, conferirConversor ok; repetir = jaInstalado; forcar reinstala', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    const tabela = tabelaFalsa();
    pastaPlugins(fonte);
    const r = await instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela });
    assert.equal(r.versaoStudio, '9.9.9.9');
    assert.equal(r.jaInstalado, false);
    assert.equal(r.arquivos, 4);
    assert.equal(r.dir, join(cache, 'studio', '9.9.9.9'));
    const m = JSON.parse(readFileSync(join(r.dir, 'manifesto.json'), 'utf8'));
    assert.equal(m.formato, 1);
    assert.equal(m.versaoStudio, '9.9.9.9');
    assert.equal(m.origem.tipo, 'pasta');
    assert.ok(m.instaladoEm);
    assert.equal(m.arquivos['xstream.jar'].sha256, sha(XSTREAM_FALSO));
    assert.equal(Object.keys(m.arquivos).length, 4);
    const c = await conferirConversor(r.dir, '9.9.9.9', { tabela });
    assert.equal(c.classpath.length, 3);
    assert.equal(c.xstream, join(r.dir, 'xstream.jar'));
    assert.deepEqual(readdirSync(join(cache, 'studio')), ['9.9.9.9']);

    const de_novo = await instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela });
    assert.equal(de_novo.jaInstalado, true);
    const forcado = await instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela, forcar: true });
    assert.equal(forcado.jaInstalado, false);
    assert.deepEqual(readdirSync(join(cache, 'studio')), ['9.9.9.9']);
  } finally {
    limpar(cache, fonte);
  }
});

test('fonte pasta aceita a raiz do Eclipse (plugins/ dentro)', async () => {
  const cache = tmp();
  const raiz = tmp();
  try {
    pastaPlugins(raiz, { raizEclipse: true });
    const r = await instalarConversor({ de: raiz, versao: '9.9.9.9', cache, tabela: tabelaFalsa() });
    assert.equal(r.jaInstalado, false);
  } finally {
    limpar(cache, raiz);
  }
});

test('sem versao: instala toda versão completa na fonte; nenhuma completa lista o que falta', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    const tabela = tabelaFalsa();
    pastaPlugins(fonte);
    const r = await instalarConversor({ de: fonte, cache, tabela });
    assert.deepEqual(r.map((x) => x.versaoStudio), ['9.9.9.9', '8.8.8.8']);
    const vazio = tmp();
    try {
      await rejeita(instalarConversor({ de: vazio, cache: tmp(), tabela }), 'E_FONTE', /Studio 9\.9\.9\.9: faltam .*Studio 8\.8\.8\.8: faltam/s);
    } finally {
      limpar(vazio);
    }
  } finally {
    limpar(cache, fonte);
  }
});

test('JAR faltando → E_FONTE com a lista; bytes adulterados → E_HASH e nada no cache', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    const tabela = tabelaFalsa();
    pastaPlugins(fonte);
    rmSync(join(fonte, 'org.eclipse.emf.ecore_9.9.jar'));
    await rejeita(instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela }), 'E_FONTE', /org\.eclipse\.emf\.ecore_9\.9\.jar/);

    writeFileSync(join(fonte, 'org.eclipse.emf.ecore_9.9.jar'), Buffer.from('ecore ADULTERADO'));
    await rejeita(instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela }), 'E_HASH', /org\.eclipse\.emf\.ecore_9\.9\.jar/);
    // mesmo tamanho, conteúdo diferente: erro de SHA-256
    writeFileSync(join(fonte, 'org.eclipse.emf.ecore_9.9.jar'), Buffer.from('ecore FALSO'));
    await rejeita(instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela }), 'E_HASH', /SHA-256 esperado/);
    const studio = join(cache, 'studio');
    assert.deepEqual(existsSync(studio) ? readdirSync(studio) : [], [], 'nem a pasta temporária pode sobrar');
  } finally {
    limpar(cache, fonte);
  }
});

test('fonte zip (com prefixo eclipse/plugins/) e zip ambíguo', async () => {
  const cache = tmp();
  const dir = tmp();
  try {
    const tabela = tabelaFalsa();
    const entradas = Object.entries(ARQUIVOS).map(([nome, dados]) => ({ nome: `eclipse/plugins/${nome}`, dados, metodo: 0 }));
    writeFileSync(join(dir, 'studio.zip'), montarZip(entradas));
    const r = await instalarConversor({ de: join(dir, 'studio.zip'), versao: '9.9.9.9', cache, tabela });
    assert.equal(r.jaInstalado, false);
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'manifesto.json'), 'utf8')).origem.tipo, 'zip');
    await conferirConversor(r.dir, '9.9.9.9', { tabela });

    const dobro = [...entradas, { nome: 'outro/plugins/org.eclipse.emf.ecore_9.9.jar', dados: ARQUIVOS['org.eclipse.emf.ecore_9.9.jar'], metodo: 0 }];
    writeFileSync(join(dir, 'ambiguo.zip'), montarZip(dobro));
    await rejeita(instalarConversor({ de: join(dir, 'ambiguo.zip'), versao: '9.9.9.9', cache: tmp(), tabela }), 'E_ZIP', /ambíguo/);
  } finally {
    limpar(cache, dir);
  }
});

const respostaFalsa = (corpos, status = {}) => async (url) => {
  const nome = url.split('/').pop();
  const st = status[nome] === undefined ? 200 : status[nome];
  return { status: st, arrayBuffer: async () => new Uint8Array(corpos[nome] || Buffer.alloc(0)).buffer };
};

test('baixar com buscar falso: ok; corpo adulterado → E_HASH e nada gravado; 404 e versão sem url → E_BAIXAR', async () => {
  const cache = tmp();
  try {
    const tabela = tabelaFalsa();
    const linhas = [];
    const r = await instalarConversor({ baixar: '9.9.9.9', cache, tabela, buscar: respostaFalsa(ARQUIVOS), log: (l) => linhas.push(l) });
    assert.equal(r.jaInstalado, false);
    assert.equal(JSON.parse(readFileSync(join(r.dir, 'manifesto.json'), 'utf8')).origem.tipo, 'baixar');
    assert.ok(linhas.some((l) => l.includes('https://exemplo.invalido/plugins/')), 'lista as URLs antes de baixar');
    assert.ok(linhas.some((l) => /Eclipse Foundation/.test(l)));
    await conferirConversor(r.dir, '9.9.9.9', { tabela });

    const cache2 = tmp();
    const adulterado = { ...ARQUIVOS, 'org.eclipse.emf.ecore_9.9.jar': Buffer.from('ecore FALSO') };
    adulterado['org.eclipse.emf.ecore_9.9.jar'][0] ^= 1;
    await rejeita(instalarConversor({ baixar: '9.9.9.9', cache: cache2, tabela, buscar: respostaFalsa(adulterado) }), 'E_HASH');
    assert.deepEqual(existsSync(join(cache2, 'studio')) ? readdirSync(join(cache2, 'studio')) : [], []);

    await rejeita(
      instalarConversor({ baixar: '9.9.9.9', cache: cache2, tabela, buscar: respostaFalsa(ARQUIVOS, { 'org.eclipse.emf.ecore_9.9.jar': 404 }) }),
      'E_BAIXAR',
      /HTTP 404/
    );
    assert.deepEqual(readdirSync(join(cache2, 'studio')), []);

    await rejeita(instalarConversor({ baixar: '8.8.8.8', cache: cache2, tabela, buscar: respostaFalsa(ARQUIVOS) }), 'E_BAIXAR', /não há URL|site oficial/i);
    limpar(cache2);
  } finally {
    limpar(cache);
  }
});

test('conferirConversor: JAR extra em plugins/ e JAR trocado depois de instalado', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    const tabela = tabelaFalsa();
    pastaPlugins(fonte);
    const r = await instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela });
    writeFileSync(join(r.dir, 'plugins', 'estranho.jar'), 'x');
    await rejeita(conferirConversor(r.dir, '9.9.9.9', { tabela }), 'E_CONVERSOR_CACHE', /estranho\.jar.*não está na tabela/);
    rmSync(join(r.dir, 'plugins', 'estranho.jar'));
    await conferirConversor(r.dir, '9.9.9.9', { tabela });

    writeFileSync(join(r.dir, 'plugins', 'org.eclipse.emf.ecore_9.9.jar'), Buffer.from('ecore TROCAD'));
    await rejeita(conferirConversor(r.dir, '9.9.9.9', { tabela }), 'E_CONVERSOR_CACHE', /Rode de novo: fluig-mcp instalar-conversor/);

    // reinstalação automática: destino inválido sem --forcar é reinstalado
    const de_novo = await instalarConversor({ de: fonte, versao: '9.9.9.9', cache, tabela });
    assert.equal(de_novo.jaInstalado, false);
    await conferirConversor(r.dir, '9.9.9.9', { tabela });
  } finally {
    limpar(cache, fonte);
  }
});

test('studioParaVersao: as 4 combinações × 1.8.2 e 2.0', () => {
  const cache = tmp();
  try {
    const marcar = (v) => {
      mkdirSync(join(cache, 'studio', v), { recursive: true });
      writeFileSync(join(cache, 'studio', v, 'manifesto.json'), '{}');
    };
    assert.equal(studioParaVersao('1.8.2', { cache }), null);
    assert.equal(studioParaVersao('2.0', { cache }), null);

    marcar('1.8.2.0');
    assert.equal(studioParaVersao('1.8.2', { cache }).versaoStudio, '1.8.2.0');
    assert.equal(studioParaVersao('1.8.2', { cache }).aviso, null);
    assert.equal(studioParaVersao('2.0', { cache }), null);

    marcar('2.0.0.2');
    assert.equal(studioParaVersao('1.8.2', { cache }).versaoStudio, '1.8.2.0');
    assert.equal(studioParaVersao('2.0', { cache }).versaoStudio, '2.0.0.2');

    rmSync(join(cache, 'studio', '1.8.2.0'), { recursive: true });
    const sub = studioParaVersao('1.8.2', { cache });
    assert.equal(sub.versaoStudio, '2.0.0.2');
    assert.equal(sub.aviso.codigo, 'W_STUDIO_SUBSTITUTO');
    assert.match(sub.aviso.mensagem, /idêntica/);
    assert.equal(studioParaVersao('2.0', { cache }).aviso, null);
  } finally {
    limpar(cache);
  }
});

test('dirCache: opcoes.cache, FLUIG_MCP_CACHE, padrão', () => {
  assert.equal(dirCache({ cache: '/x/y', env: { FLUIG_MCP_CACHE: '/z' } }), '/x/y');
  assert.equal(dirCache({ env: { FLUIG_MCP_CACHE: '/z' } }), '/z');
  assert.match(dirCache({ env: {} }), /\.fluig-mcp$/);
});

test('CONVERSORES real: 13 e 14 JARs, SHA-256 válidos, URLs só na 1.8.2.0, Eclipse igual nas duas', () => {
  const a = CONVERSORES['1.8.2.0'];
  const b = CONVERSORES['2.0.0.2'];
  assert.equal(a.jars.length, 13);
  assert.equal(b.jars.length, 14);
  for (const j of [...a.jars, ...b.jars, a.xstream]) assert.match(j.sha256, /^[0-9a-f]{64}$/);
  assert.ok(a.jars.every((j) => typeof j.url === 'string' && j.url.endsWith(`/plugins/${j.nome}`)));
  assert.ok(b.jars.every((j) => j.url === undefined));
  assert.ok(a.jars.filter((j) => j.origem === 'totvs').every((j) => j.url.startsWith('http://update.fluig.com/182/plugins/')));
  assert.ok(a.jars.filter((j) => j.origem === 'eclipse').every((j) => j.url.startsWith('https://download.eclipse.org/releases/neon/201703231000/plugins/')));
  const eclipseA = a.jars.filter((j) => j.origem === 'eclipse');
  const eclipseB = b.jars.filter((j) => j.origem === 'eclipse');
  assert.equal(eclipseA.length, 9);
  assert.deepEqual(eclipseA.map((j) => [j.nome, j.bytes, j.sha256]), eclipseB.map((j) => [j.nome, j.bytes, j.sha256]));
  assert.ok(b.jars.some((j) => j.nome.startsWith('com.totvs.tds.restclient_2.0.0.2')));
  assert.equal(a.jars.reduce((s, j) => s + j.bytes, 0), 45_219_481, 'soma dos 13 JARs da 1.8.2.0');
  assert.equal(a.xstream.bytes, 483453);
});
