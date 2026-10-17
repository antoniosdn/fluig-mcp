// Carregador do recorte da extensão Fluiggers 3.0.1 (MIT) guardado em vendor/fluiggers-3.0.1/.
// Lê, valida, edita e desenha .process em Node puro, sem VS Code. Licença: LICENSE.txt da pasta;
// origem, hashes e módulos: PROCEDENCIA.md da pasta. Confere o SHA-256 dos arquivos e executa os
// mesmos bytes conferidos, com um require restrito a node:path.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as nodePath from 'node:path';

export const VERSAO_FLUIGGERS = '3.0.1';
export const DIR_VENDOR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'fluiggers-3.0.1');
export const HASHES_VENDOR = Object.freeze({
  'LICENSE.txt': 'b005b4fd5dd5ac763957273c72b04efc4e7eb6d657893d7f99309c8ae0a0102d',
  'modulos.cjs': 'da680ff36d5e530025467e158e63cbd20516c92f7026b6b836524fd765dcc5d4',
  'creation-template.process.gz.b64': '14ded7b88e745e70c877c6fab0ecc9c4076cb55aa80a4ae8e1ac4c025fe2e9c6',
});
export const MODULOS_RECORTE = Object.freeze(
  '496 15201 21427 23776 33180 33496 40452 41558 42278 46013 46377 47337 51077 53531 54683 57862 60314 60919 67353 69129 71939 73083 75092 76760 80072 85565 87688 93356 96396'.split(' ')
);

const cache = new Map();

function lerConferido(dir, nome) {
  let bytes;
  try {
    bytes = readFileSync(join(dir, nome));
  } catch {
    bytes = null;
  }
  const esperado = HASHES_VENDOR[nome];
  const obtido = bytes ? createHash('sha256').update(bytes).digest('hex') : 'ausente';
  if (obtido !== esperado) {
    throw new Error(
      `Fluiggers ${VERSAO_FLUIGGERS}: ${nome} não confere (SHA-256 esperado ${esperado}, obtido ${obtido}). ` +
        'Regenere com `node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1>` ou restaure o arquivo do Git.'
    );
  }
  return bytes;
}

function requireRestrito(nome) {
  if (nome === 'node:path') return nodePath;
  throw new Error(`Fluiggers ${VERSAO_FLUIGGERS}: require("${nome}") não permitido no recorte`);
}

export function carregarFluiggers({ dir = DIR_VENDOR } = {}) {
  if (cache.has(dir)) return cache.get(dir);

  lerConferido(dir, 'LICENSE.txt');
  const b64 = lerConferido(dir, 'creation-template.process.gz.b64');
  const textoModulos = lerConferido(dir, 'modulos.cjs').toString('utf8');

  const modulo = { exports: {} };
  const fn = vm.compileFunction(textoModulos, ['module', 'exports', 'require'], {
    filename: join(dir, 'modulos.cjs'),
  });
  fn.call(modulo.exports, modulo, modulo.exports, requireRestrito);
  const mods = modulo.exports;

  const chaves = Object.keys(mods).sort();
  if (chaves.join(' ') !== [...MODULOS_RECORTE].sort().join(' ')) {
    throw new Error(`Fluiggers ${VERSAO_FLUIGGERS}: módulos de modulos.cjs diferem de MODULOS_RECORTE`);
  }

  const prontos = {};
  function exigir(id) {
    const chave = String(id);
    if (!MODULOS_RECORTE.includes(chave)) {
      throw new Error(`Fluiggers ${VERSAO_FLUIGGERS}: módulo ${chave} não está no recorte do vendor`);
    }
    if (prontos[chave]) return prontos[chave].exports;
    const m = (prontos[chave] = { exports: {} });
    mods[chave].call(m.exports, m, m.exports, exigir);
    return m.exports;
  }

  const m46377 = exigir('46377');
  const m41558 = exigir('41558');
  const m80072 = exigir('80072');
  const m15201 = exigir('15201');

  const templateCriacao = gunzipSync(Buffer.from(b64.toString('utf8').trim(), 'base64')).toString('utf8');

  const resultado = Object.freeze({
    versao: VERSAO_FLUIGGERS,
    parseProcess: m46377.parseProcess,
    validateProcess: m41558.validateProcess,
    buildProcessScaffold: m80072.buildProcessScaffold,
    renderProcessImageSvg: m15201.renderProcessImageSvg,
    editor: exigir('51077'),
    gateway: exigir('71939'),
    roteador: exigir('85565'),
    templateCriacao,
    exigir,
  });
  cache.set(dir, resultado);
  return resultado;
}
