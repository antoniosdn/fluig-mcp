// Leitor ZIP mínimo (src/flow/zip.js). Offline: os zips são montados em memória.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { abrirZip, lerZipDeBuffer } from '../src/flow/zip.js';
import { montarZip } from './_zip-builder.js';

const GRANDE = Buffer.from('conteudo repetido '.repeat(500));
const ENTRADAS = [
  { nome: 'a/armazenado.txt', dados: 'olá armazenado', metodo: 0 },
  { nome: 'b/deflate.bin', dados: GRANDE, metodo: 8 },
  { nome: 'c/acentuação-ç.txt', dados: 'nome utf8', metodo: 0 },
];

async function comArquivo(buffer, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zip-teste-'));
  try {
    const caminho = join(dir, 'x.zip');
    writeFileSync(caminho, buffer);
    const z = await abrirZip(caminho);
    try {
      return await fn(z);
    } finally {
      await z.fechar();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('lerZipDeBuffer: armazenado, deflate e nome UTF-8', () => {
  const z = lerZipDeBuffer(montarZip(ENTRADAS));
  assert.deepEqual(z.entradas.map((e) => e.nome), ['a/armazenado.txt', 'b/deflate.bin', 'c/acentuação-ç.txt']);
  assert.equal(z.ler('a/armazenado.txt').toString(), 'olá armazenado');
  assert.ok(z.ler('b/deflate.bin').equals(GRANDE));
  assert.equal(z.ler(z.entradas[2]).toString(), 'nome utf8');
  assert.equal(z.entradas[1].metodo, 8);
  assert.equal(z.entradas[1].tamanho, GRANDE.length);
  assert.throws(() => z.ler('nao/existe'), /não existe/);
});

test('abrirZip: arquivo em disco, leituras posicionais', async () => {
  await comArquivo(montarZip(ENTRADAS), async (z) => {
    assert.equal(z.entradas.length, 3);
    assert.equal((await z.ler('a/armazenado.txt')).toString(), 'olá armazenado');
    assert.ok((await z.ler('b/deflate.bin')).equals(GRANDE));
  });
});

test('zip64: EOCD saturado, localizador, EOCD64 e extra 0x0001', async () => {
  const buf = montarZip(ENTRADAS, { zip64: true });
  const z = lerZipDeBuffer(buf);
  assert.equal(z.entradas.length, 3);
  assert.ok(z.ler('b/deflate.bin').equals(GRANDE));
  await comArquivo(buf, async (a) => {
    assert.equal((await a.ler('a/armazenado.txt')).toString(), 'olá armazenado');
  });
});

test('método não suportado e entrada criptografada dão erro claro', () => {
  const metodo12 = lerZipDeBuffer(montarZip([{ nome: 'x.bin', dados: 'abc', metodo: 12 }]));
  assert.throws(() => metodo12.ler('x.bin'), (e) => e.codigo === 'E_ZIP' && /Método de compressão 12/.test(e.message));
  const cripto = lerZipDeBuffer(montarZip([{ nome: 'y.bin', dados: 'abc', cripto: true }]));
  assert.throws(() => cripto.ler('y.bin'), (e) => e.codigo === 'E_ZIP' && /criptografada/.test(e.message));
});

test('arquivo que não é zip', () => {
  assert.throws(() => lerZipDeBuffer(Buffer.from('isto não é um zip, só texto qualquer com mais de vinte e dois bytes')), (e) => e.codigo === 'E_ZIP');
});
