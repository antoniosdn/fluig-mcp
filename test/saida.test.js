import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  entregarTexto, gravarNaSaida, lerNaSaida, MARCA_CORTE, MAX_CHARS_PADRAO, pastaSaidaPadrao, recusarCortado,
} from '../src/saida.js';

function pasta(t) {
  const dir = mkdtempSync(join(tmpdir(), 'saida-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('texto curto volta inteiro', () => {
  assert.equal(entregarTexto('abc'), 'abc');
});

test('texto acima do limite volta cortado, com aviso de quanto faltou e como pegar tudo', () => {
  const texto = 'x'.repeat(MAX_CHARS_PADRAO + 500);
  const r = entregarTexto(texto);
  assert.ok(r.startsWith('x'.repeat(MAX_CHARS_PADRAO)));
  assert.match(r, /500 de \d+ caracteres omitidos/);
  assert.match(r, /destino/);
  assert.ok(r.includes(MARCA_CORTE));
  assert.equal(entregarTexto('abcdef', { maxChars: 3 }).slice(0, 3), 'abc');
});

test('o corte não parte par substituto e maxChars fracionário vira inteiro', () => {
  const r = entregarTexto('a😀bcd', { maxChars: 2 });
  assert.ok(r.startsWith('a\n'), 'o emoji inteiro fica de fora em vez de virar meio caractere');
  assert.match(entregarTexto('abcdef', { maxChars: 2.5 }), /4 de 6 caracteres omitidos/);
  for (const invalido of [0, -1, NaN, 'abc', null]) {
    assert.equal(entregarTexto('abc', { maxChars: invalido }), 'abc');
  }
});

test('com destino grava o conteúdo inteiro dentro da pasta base (criando subpastas) e devolve só o resumo', (t) => {
  const dir = pasta(t);
  const texto = '<x>' + 'á'.repeat(30000) + '</x>';
  const destino = join(dir, 'proc.xml');
  assert.deepEqual(entregarTexto(texto, { destino, base: dir }), { arquivo: destino, caracteres: texto.length });
  assert.equal(readFileSync(destino, 'utf8'), texto);
  assert.equal(entregarTexto('y', { destino: 'sub/rel.txt', base: dir }).arquivo, join(dir, 'sub', 'rel.txt'));
});

test('binário é gravado byte a byte, e regravar substitui sem deixar temporário', (t) => {
  const dir = pasta(t);
  const bin = Buffer.from([0x00, 0xff, 0xd8, 0xfe, 0x0a, 0x0d]);
  const arquivo = gravarNaSaida('anexo.bin', bin, { base: dir });
  assert.deepEqual(readFileSync(arquivo), bin);
  gravarNaSaida('anexo.bin', Buffer.from('novo'), { base: dir });
  assert.equal(readFileSync(arquivo, 'utf8'), 'novo');
  assert.deepEqual(readdirSync(dir), ['anexo.bin']);
});

test('arquivo 0600 e pasta 0700: fonte de dataset pode trazer credencial', { skip: process.platform === 'win32' }, (t) => {
  const dir = pasta(t);
  const arquivo = gravarNaSaida('ds/fonte.js', 'x', { base: join(dir, 'saida') });
  assert.equal(statSync(arquivo).mode & 0o777, 0o600);
  assert.equal(statSync(join(dir, 'saida')).mode & 0o077, 0);
  assert.equal(statSync(join(dir, 'saida', 'ds')).mode & 0o077, 0);
});

test('a pasta padrão fica na home do usuário, não na pasta onde o MCP roda', () => {
  // A pasta de trabalho é o projeto (dava para sobrescrever .git/hooks) ou "/" (Claude Desktop no macOS,
  // onde criar a pasta falha com EACCES). A home é do usuário e sempre gravável.
  assert.equal(pastaSaidaPadrao({}, '/home/fulano'), join('/home/fulano', 'fluig-mcp-saida'));
  assert.equal(pastaSaidaPadrao({ FLUIG_SAIDA_DIR: '/saidas' }, '/home/fulano'), '/saidas');
  assert.equal(pastaSaidaPadrao({}), join(homedir(), 'fluig-mcp-saida'));
});

test('pasta que não dá para criar vira erro claro', (t) => {
  const dir = pasta(t);
  const arquivo = join(dir, 'sou-um-arquivo');
  writeFileSync(arquivo, '');
  assert.throws(() => entregarTexto('x', { destino: 'a.txt', base: join(arquivo, 'saida') }), /não consegui criar/);
});

// Fork: sem a trava da pasta de saída da 1.2.0 do original.
test('destino fora da pasta base é aceito; relativo continua relativo a ela', (t) => {
  const dir = pasta(t);
  const base = join(dir, 'base');
  assert.equal(entregarTexto('x', { destino: '../fora.txt', base }).arquivo, join(dir, 'fora.txt'));
  assert.equal(entregarTexto('y', { destino: join(dir, 'outra', 'a.txt'), base }).arquivo, join(dir, 'outra', 'a.txt'));
  assert.equal(readFileSync(join(dir, 'outra', 'a.txt'), 'utf8'), 'y');
  assert.throws(() => entregarTexto('x', { destino: '.', base: dir }), /própria pasta/);
  assert.throws(() => entregarTexto('x', { destino: 'sub/', base: dir }), /nome de arquivo/);
});

test('nome que só começa com dois pontos é um nome comum, dentro da pasta', (t) => {
  const dir = pasta(t);
  assert.equal(gravarNaSaida('..config', 'x', { base: dir }), join(dir, '..config'));
  // "..." termina em ponto: nome comum no Linux e no macOS, inválido no Windows (ver verificadores.test.js).
  if (process.platform === 'win32') assert.throws(() => gravarNaSaida('...', 'x', { base: dir }), /inválido no Windows/);
  else assert.equal(gravarNaSaida('...', 'x', { base: dir }), join(dir, '...'));
});

test('link simbólico no nome final é recusado e o alvo fica intacto', (t) => {
  const dir = pasta(t);
  const base = join(dir, 'base');
  mkdirSync(base);
  writeFileSync(join(dir, 'alvo.txt'), 'original');
  try {
    symlinkSync(join(dir, 'alvo.txt'), join(base, 'link.txt'), 'file');
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('sem privilégio para criar symlink de arquivo (Windows sem Developer Mode)');
    throw e;
  }
  assert.throws(() => entregarTexto('x', { destino: 'link.txt', base }), /link simbólico/);
  assert.equal(readFileSync(join(dir, 'alvo.txt'), 'utf8'), 'original');
});

test('link FÍSICO dentro da base não leva a escrita para o arquivo de fora', (t) => {
  // O_NOFOLLOW não cobre hardlink, e criar um não exige privilégio (NTFS, ext4, APFS). Gravar por
  // temporário + rename troca a entrada do diretório em vez de truncar o inode compartilhado.
  const dir = pasta(t);
  const base = join(dir, 'base');
  mkdirSync(base);
  writeFileSync(join(dir, 'fora.txt'), 'original');
  linkSync(join(dir, 'fora.txt'), join(base, 'h.txt'));
  gravarNaSaida('h.txt', 'gravado', { base });
  assert.equal(readFileSync(join(dir, 'fora.txt'), 'utf8'), 'original');
  assert.equal(readFileSync(join(base, 'h.txt'), 'utf8'), 'gravado');
});

test('lerNaSaida lê byte a byte o arquivo de dentro da pasta, por caminho relativo a ela ou absoluto', (t) => {
  const dir = pasta(t);
  const bin = Buffer.from([0x00, 0xff, 0x0a, 0x0d, 0xc3]);
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'form.zip'), bin);
  assert.deepEqual(lerNaSaida('sub/form.zip', { base: dir }), bin);
  assert.deepEqual(lerNaSaida(join(dir, 'sub', 'form.zip'), { base: dir }), bin);
  writeFileSync(join(dir, 'proc.xml'), '<x>ação</x>');
  assert.equal(lerNaSaida('proc.xml', { base: dir, encoding: 'utf8' }), '<x>ação</x>');
});

test('lerNaSaida lê fora da pasta (absoluto ou ../) e recusa caminho vazio citando o parâmetro', (t) => {
  const dir = pasta(t);
  const base = join(dir, 'base');
  mkdirSync(base);
  writeFileSync(join(dir, 'proc.xml'), '<x/>');
  for (const caminho of [join(dir, 'proc.xml'), '../proc.xml', 'sub/../../proc.xml']) {
    assert.equal(lerNaSaida(caminho, { base, campo: 'xmlPath', encoding: 'utf8' }), '<x/>', caminho);
  }
  assert.throws(() => lerNaSaida('.', { base, campo: 'zipPath' }), /zipPath .*própria pasta de saída/);
  assert.throws(() => lerNaSaida('', { base, campo: 'zipPath' }), /zipPath inválido/);
  assert.throws(() => lerNaSaida(undefined, { base, campo: 'zipPath' }), /zipPath inválido/);
});

test('lerNaSaida: arquivo que não existe, pasta e pasta base ausente viram erro claro', (t) => {
  const dir = pasta(t);
  mkdirSync(join(dir, 'sub'));
  assert.throws(() => lerNaSaida('nao-existe.zip', { base: dir, campo: 'zipPath' }), /zipPath: arquivo não encontrado/);
  assert.throws(() => lerNaSaida('sub', { base: dir, campo: 'zipPath' }), /zipPath não é um arquivo comum/);
  assert.throws(() => lerNaSaida('a.zip', { base: join(dir, 'nao-criada'), campo: 'zipPath' }),
    /zipPath: arquivo não encontrado/);
});

test('texto cortado não pode ser gravado de volta no Fluig', () => {
  const cortado = entregarTexto('x'.repeat(50), { maxChars: 10 });
  assert.throws(() => recusarCortado(cortado, 'code'), /code contém o aviso de corte/);
  assert.doesNotThrow(() => recusarCortado('function createDataset() {}', 'code'));
  assert.doesNotThrow(() => recusarCortado(undefined, 'code'));
});
