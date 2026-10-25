// Subcomandos do fluig-mcp: regenerar, gerar, instalar-conversor e importar (src/flow/cli-fluxo.js). Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executarCli } from '../src/flow/cli-fluxo.js';
import { montarProcessoSintetico } from './_process-sintetico.js';
import { pastaPlugins } from './_conversor-falso.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'cli-teste-'));
function captura() {
  const out = [];
  const err = [];
  return { out, err, opcoes: { saida: (l) => out.push(l), erro: (l) => err.push(l) } };
}

test('uso errado → 2', async () => {
  for (const argv of [
    ['regenerar'],
    ['regenerar', 'a.process', '1.8.2', 'sobra'],
    ['regenerar', 'a.process', '--proprio', '--oficial'],
    ['regenerar', 'a.process', '--desconhecida'],
    ['regenerar', 'a.process', '--cache'],
    ['gerar'],
    ['gerar', 'spec.json'],
    ['gerar', 'spec.json', '--projeto', '/tmp/x', '--proprio', '--oficial'],
    ['instalar-conversor'],
    ['instalar-conversor', '--de', 'x', '--baixar', '1.8.2.0'],
    ['instalar-conversor', 'solto'],
    ['instalar-conversor', '--de', 'x', '--sem-importador', 'solto'],
    ['importar'],
    ['importar', 'a.ecm30.xml'],
    ['importar', 'a.ecm30.xml', '1.8.2', 'sobra', '--projeto', '/tmp/x'],
    ['importar', 'a.ecm30.xml', '--projeto'],
    ['importar', 'a.ecm30.xml', '--projeto', '/tmp/x', '--desconhecida'],
    ['outro'],
  ]) {
    const c = captura();
    assert.equal(await executarCli(argv, c.opcoes), 2, argv.join(' '));
    assert.ok(c.err.some((l) => l.startsWith('erro de uso:')), argv.join(' '));
    assert.ok(c.err.some((l) => l.includes('fluig-mcp regenerar')), 'mostra o uso');
  }
});

test('regenerar --proprio --cache <vazio> no projeto temporário → 0 e linhas esperadas; --nao-gravar não cria nada', async () => {
  const raiz = tmp();
  const cache = tmp();
  try {
    mkdirSync(join(raiz, 'workflow', 'diagrams'), { recursive: true });
    const caminho = join(raiz, 'workflow', 'diagrams', 'proc_x.process');
    writeFileSync(caminho, montarProcessoSintetico({ id: 'proc_x' }).texto);

    const seco = captura();
    assert.equal(await executarCli(['regenerar', caminho, '--proprio', '--nao-gravar', '--cache', cache], seco.opcoes), 0);
    assert.ok(!existsSync(join(raiz, 'workflow', '.resources')));
    assert.ok(seco.out.some((l) => /^ecm30: .*\(\d+ bytes, não gravado\)$/.test(l)));

    const c = captura();
    assert.equal(await executarCli(['regenerar', caminho, '1.8.2', '--proprio', '--cache', cache], c.opcoes), 0);
    assert.equal(c.out[0], 'conversor: gerador próprio (plano B)');
    assert.ok(c.out.some((l) => /^ecm30: .*proc_x\.ecm30\.xml \(\d+ bytes, gravado\)$/.test(l)));
    assert.ok(c.out.some((l) => /^svg: .*proc_x\.processimage\.svg \(\d+ bytes, gravado\)$/.test(l)));
    assert.ok(c.out.some((l) => l.startsWith('aviso W_ECM30_NAO_OFICIAL: ')));
    assert.deepEqual(c.err, []);

    const de_novo = captura();
    assert.equal(await executarCli(['regenerar', caminho, '--proprio', '--cache', cache], de_novo.opcoes), 0);
    assert.ok(de_novo.out.some((l) => l.includes('sem mudança')));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('erro de execução → 1 com "erro E_..."', async () => {
  const cache = tmp();
  try {
    const c = captura();
    assert.equal(await executarCli(['regenerar', '/tmp/fora/arquivo.process', '--proprio', '--cache', cache], c.opcoes), 1);
    assert.ok(c.err[0].startsWith('erro E_CAMINHO: '));
    const o = captura();
    assert.equal(await executarCli(['instalar-conversor', '--de', join(cache, 'nao-existe'), '--cache', cache], o.opcoes), 1);
    assert.ok(o.err[0].startsWith('erro E_FONTE: '));
    const b = captura();
    assert.equal(await executarCli(['instalar-conversor', '--baixar', '9.9.9.9', '--cache', cache], b.opcoes), 1);
    assert.ok(b.err[0].startsWith('erro E_BAIXAR: '));
    assert.deepEqual(existsSync(join(cache, 'studio')) ? readdirSync(join(cache, 'studio')) : [], []);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('instalar-conversor --de com pasta que não é de um Studio conhecido → 1 listando o que falta', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    pastaPlugins(fonte); // JARs falsos: nenhuma versão real da tabela fica completa
    const c = captura();
    assert.equal(await executarCli(['instalar-conversor', '--de', fonte, '--cache', cache], c.opcoes), 1);
    assert.match(c.err.join('\n'), /erro E_FONTE: Nenhuma versão completa[\s\S]*Studio 1\.8\.2\.0: faltam[\s\S]*Studio 2\.0\.0\.2: faltam/);
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(fonte, { recursive: true, force: true });
  }
});

test('gerar <spec> --projeto <tmp> --proprio --cache <vazio> → 0 e três caminhos; segunda vez sem mudança; spec ilegível → 1', async () => {
  const raiz = tmp();
  const cache = tmp();
  try {
    const spec = join(raiz, 'spec.json');
    copyFileSync(new URL('./fixtures/flow/spec-completa.json', import.meta.url), spec);
    const projeto = join(raiz, 'projeto');
    mkdirSync(projeto);
    const c = captura();
    assert.equal(await executarCli(['gerar', spec, '--projeto', projeto, '2.0', '--proprio', '--cache', cache], c.opcoes), 0);
    assert.equal(c.out[0], 'conversor: gerador próprio (plano B)');
    assert.ok(c.out.some((l) => /^process: .*gerador_oraculo\.process \(\d+ bytes, gravado\)$/.test(l)));
    assert.ok(c.out.some((l) => /^ecm30: .*gerador_oraculo\.ecm30\.xml \(\d+ bytes, gravado\)$/.test(l)));
    assert.ok(c.out.some((l) => /^svg: .*gerador_oraculo\.processimage\.svg \(\d+ bytes, gravado\)$/.test(l)));
    assert.ok(c.out.some((l) => l.startsWith('aviso W_ECM30_NAO_OFICIAL: ')));
    assert.deepEqual(c.err, []);

    const d = captura();
    assert.equal(await executarCli(['gerar', spec, '--projeto', projeto, '2.0', '--proprio', '--cache', cache], d.opcoes), 0);
    assert.ok(d.out.filter((l) => l.includes('sem mudança')).length === 3);

    const e = captura();
    assert.equal(await executarCli(['gerar', join(raiz, 'nao-existe.json'), '--projeto', projeto, '--proprio', '--cache', cache], e.opcoes), 1);
    assert.ok(e.err[0].startsWith('erro E_SPEC: '));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('importar: ECM30 ilegível → 1; sem importador no cache → 1 com a dica do instalar-conversor', async () => {
  const raiz = tmp();
  const cache = tmp();
  try {
    const c = captura();
    assert.equal(await executarCli(['importar', join(raiz, 'nao-existe.xml'), '--projeto', raiz, '--cache', cache], c.opcoes), 1);
    assert.ok(c.err.some((l) => l.startsWith('erro E_ECM30_INVALIDO:')));
    const xml = join(raiz, 'p.ecm30.xml');
    writeFileSync(xml, '<list>\n  <ProcessDefinition>\n    <processDefinitionPK>\n      <processId>proc_x</processId>\n    </processDefinitionPK>\n  </ProcessDefinition>\n</list>\n');
    const d = captura();
    assert.equal(await executarCli(['importar', xml, '--projeto', raiz, '--cache', cache], d.opcoes), 1);
    assert.ok(d.err.some((l) => l.startsWith('erro E_IMPORTADOR_AUSENTE:') && l.includes('instalar-conversor')));
    assert.ok(!existsSync(join(raiz, 'workflow')));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('instalar-conversor --sem-importador: aceita a opção e não cria importador/', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    pastaPlugins(fonte);
    const c = captura();
    // a fonte falsa não é de um Studio real: falha no conversor, mas a opção é aceita (não é erro de uso)
    assert.equal(await executarCli(['instalar-conversor', '--de', fonte, '--cache', cache, '--sem-importador'], c.opcoes), 1);
    assert.ok(!c.err.some((l) => l.startsWith('erro de uso:')));
    assert.ok(!existsSync(join(cache, 'importador')));
  } finally {
    rmSync(cache, { recursive: true, force: true });
    rmSync(fonte, { recursive: true, force: true });
  }
});
