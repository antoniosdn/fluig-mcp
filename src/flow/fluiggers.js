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
export const DIR_PONTE = join(DIR_VENDOR, 'ecm30-bridge');
export const HASHES_PONTE = Object.freeze({
  'Ecm30Bridge.java': '88541f9a1eff8a2214dc9b665eba93fcc54af6253295fc16404932050a7e9d17',
  'com/fluig/bpm/utils/ProjectUtils.java': '51af021b943e5a5a23369c9599b136a8ba16d36725a33cf3bfadd12d204499f7',
  'org/eclipse/core/resources/IFile.java': '5c481ef84b0d75e68fd2addda398e5c252811d904e84be9b71a9e0ce4b125e12',
  'org/eclipse/graphiti/ui/internal/services/GraphitiUiInternal.java': 'c987ee92b377cc6ccd3202852c32ca92d3d8bb7a31a415492ed84b3ad0fc1e3c',
  'org/eclipse/graphiti/ui/internal/services/IEmfService.java': '4adc165970be12d9dcb6bfdd9d677ecf86ab1b765d32a9b913989c401747c38f',
  'classes/Ecm30Bridge.class': 'ceced0595a9ff2b8a5ddb32938c3e45b2c09b4c57bbab1cd39ec42febd33c0b0',
  'classes/Ecm30Bridge$1.class': '5b6bdb4912f9f6ed16fbfbf71433fd1b4f5e9faab1e589f8b7d8bf391373a51f',
  'classes/com/fluig/bpm/utils/ProjectUtils.class': '59f8c90d38e225a68868e93d26a0a80d7a41f9852ceddc60307735d7273b0660',
  'classes/org/eclipse/core/resources/IFile.class': '81f6696c41e21b03f58095c2b50b7c5b4589ed8b9462bd3fee17a420ecfcd21d',
  'classes/org/eclipse/graphiti/ui/internal/services/GraphitiUiInternal.class': '7913815bb5abac959f7b9307f777148bc2a634dd8024fa69e798593930011dc0',
  'classes/org/eclipse/graphiti/ui/internal/services/IEmfService.class': '75f4fe7657dd8c44b71cda63c9ca0b1c82dc0221acc6bf69218bde6447f0d10e',
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
    problemasConfiguracao: exigir('33496').elementConfigurationIssues,
    editor: exigir('51077'),
    gateway: exigir('71939'),
    roteador: exigir('85565'),
    templateCriacao,
    exigir,
  });
  cache.set(dir, resultado);
  return resultado;
}

/**
 * Confere o SHA-256 dos 11 arquivos da ponte ECM30 e devolve o caminho absoluto de `classes/`
 * (o primeiro item do classpath). Lança se algum faltar ou diferir.
 */
export function conferirPonte({ dir = DIR_PONTE } = {}) {
  for (const [nome, esperado] of Object.entries(HASHES_PONTE)) {
    let bytes;
    try {
      bytes = readFileSync(join(dir, ...nome.split('/')));
    } catch {
      bytes = null;
    }
    const obtido = bytes ? createHash('sha256').update(bytes).digest('hex') : 'ausente';
    if (obtido !== esperado) {
      throw new Error(
        `Ponte ECM30 (Fluiggers ${VERSAO_FLUIGGERS}): ${nome} não confere (SHA-256 esperado ${esperado}, obtido ${obtido}). ` +
          'Regenere com `node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1>` ou restaure o arquivo do Git.'
      );
    }
  }
  return join(dir, 'classes');
}
