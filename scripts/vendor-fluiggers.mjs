#!/usr/bin/env node
// Gera vendor/fluiggers-3.0.1/ a partir da extensão Fluiggers 3.0.1 instalada (MIT).
// Só LÊ texto: nunca executa nem importa o código da extensão.
//   node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1> [--conferir]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const VERSAO = '3.0.1';
const DESTINO = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'fluiggers-3.0.1');
const ORIGEM = {
  'dist/extension.js': 'c0f603b9333648d15fcf59006652610e3bad00c22d2bb5f19d0abdd4bba25eb6',
  'LICENSE.txt': 'b005b4fd5dd5ac763957273c72b04efc4e7eb6d657893d7f99309c8ae0a0102d',
  'runtime/bpmn/creation-template.process.gz.b64': '14ded7b88e745e70c877c6fab0ecc9c4076cb55aa80a4ae8e1ac4c025fe2e9c6',
};
// Ponte ECM30 (tools/ecm30-bridge/ da extensão -> vendor/.../ecm30-bridge/), cópia byte a byte.
const PONTE = {
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
};
const RAIZES = ['51077', '80072', '46377', '41558', '71939', '15201'];
const IDS_ESPERADOS = '496 15201 21427 23776 33180 33496 40452 41558 42278 46013 46377 47337 51077 53531 54683 57862 60314 60919 67353 69129 71939 73083 75092 76760 80072 85565 87688 93356 96396'.split(' ');
const TOTAL_MODULOS = 773;
const CABECALHO =
  '/*! Recorte de fluiggers-fluig-vscode-extension 3.0.1, dist/extension.js. MIT, Copyright (c) 2020 Bruno Gasparetto (ver LICENSE.txt). Gerado por scripts/vendor-fluiggers.mjs; não editar. */\n';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const falhar = (msg) => {
  console.error(`ERRO: ${msg}`);
  process.exit(1);
};

const args = process.argv.slice(2);
const conferir = args.includes('--conferir');
const pasta = args.find((a) => !a.startsWith('--'));
if (!pasta) falhar('uso: node scripts/vendor-fluiggers.mjs <pasta da extensão 3.0.1> [--conferir]');

const pkg = JSON.parse(readFileSync(join(pasta, 'package.json'), 'utf8'));
if (pkg.version !== VERSAO) falhar(`versão da extensão é ${pkg.version}, esperado ${VERSAO}`);

const bytes = {};
for (const [rel, esperado] of Object.entries(ORIGEM)) {
  bytes[rel] = readFileSync(join(pasta, rel));
  const obtido = sha(bytes[rel]);
  if (obtido !== esperado) falhar(`${rel}: SHA-256 ${obtido}, esperado ${esperado}`);
}

const ponte = {};
for (const [rel, esperado] of Object.entries(PONTE)) {
  const b = readFileSync(join(pasta, 'tools', 'ecm30-bridge', ...rel.split('/')));
  const obtido = sha(b);
  if (obtido !== esperado) falhar(`tools/ecm30-bridge/${rel}: SHA-256 ${obtido}, esperado ${esperado}`);
  ponte[`ecm30-bridge/${rel}`] = b;
}

const fonte = bytes['dist/extension.js'].toString('utf8');
if (Buffer.byteLength(fonte, 'utf8') !== bytes['dist/extension.js'].length) falhar('extension.js não é UTF-8 puro');

// Localiza os módulos webpack.
const reInicio = /[,{](\d+)\((\w+)?(?:,(\w+))?(?:,(\w+))?\)\{/g;
const achados = [];
let m;
while ((m = reInicio.exec(fonte))) {
  achados.push({ id: m[1], p3: m[4] || null, ini: m.index + 1 });
}
const ids = new Set(achados.map((a) => a.id));
if (ids.size !== achados.length) falhar('ids de módulo repetidos');
if (achados.length !== TOTAL_MODULOS) falhar(`${achados.length} módulos encontrados, esperado ${TOTAL_MODULOS}`);
const porId = new Map();
achados.forEach((a, i) => {
  const fim = i + 1 < achados.length ? achados[i + 1].ini - 1 : null; // tira a vírgula separadora
  porId.set(a.id, { ...a, fim });
});
// O último módulo do bundle não tem próximo para delimitar o fim; só importa se estiver no recorte.
for (const a of porId.values()) a.texto = a.fim === null ? null : fonte.slice(a.ini, a.fim);

// Fecha a árvore de dependências.
const fechamento = new Set();
const fila = [...RAIZES];
while (fila.length) {
  const id = fila.pop();
  if (fechamento.has(id)) continue;
  const mod = porId.get(id);
  if (!mod) falhar(`módulo ${id} não encontrado`);
  if (mod.texto === null) falhar(`módulo ${id} sem fim determinável (último do bundle)`);
  fechamento.add(id);
  if (!mod.p3) continue;
  const re = new RegExp(`(?<![\\w$.])${mod.p3.replace(/\$/g, '\\$')}\\((\\d+)\\)`, 'g');
  let r;
  while ((r = re.exec(mod.texto))) fila.push(r[1]);
}
const idsOrdenados = [...fechamento].sort((a, b) => Number(a) - Number(b));
if (idsOrdenados.join(' ') !== IDS_ESPERADOS.join(' ')) {
  falhar(`recorte difere do esperado: ${idsOrdenados.join(' ')}`);
}

const requires = new Set();
for (const id of idsOrdenados) {
  const t = porId.get(id).texto;
  if (!t.endsWith('}')) falhar(`módulo ${id} não termina em }`);
  if (t.includes('require("vscode")')) falhar(`módulo ${id} usa vscode`);
  for (const r of t.matchAll(/require\("([^"]*)"\)/g)) requires.add(`${id}:${r[1]}`);
}
if ([...requires].join('|') !== '76760:node:path') falhar(`requires inesperados: ${[...requires].join(', ')}`);

const modulosCjs = `${CABECALHO}module.exports={\n${idsOrdenados.map((id) => porId.get(id).texto).join(',\n')}\n};\n`;
try {
  new vm.Script(modulosCjs);
} catch (e) {
  falhar(`modulos.cjs não compila: ${e.message}`);
}

const saida = {
  'LICENSE.txt': bytes['LICENSE.txt'],
  'creation-template.process.gz.b64': bytes['runtime/bpmn/creation-template.process.gz.b64'],
  'modulos.cjs': Buffer.from(modulosCjs, 'utf8'),
  ...ponte,
};

if (conferir) {
  let ok = true;
  for (const [nome, conteudo] of Object.entries(saida)) {
    let atual = null;
    try {
      atual = readFileSync(join(DESTINO, ...nome.split('/')));
    } catch {
      /* ausente */
    }
    if (!atual || !atual.equals(conteudo)) {
      console.error(`DIFERE: ${nome}`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log('vendor confere com a extensão');
} else {
  mkdirSync(DESTINO, { recursive: true });
  for (const [nome, conteudo] of Object.entries(saida)) {
    const alvo = join(DESTINO, ...nome.split('/'));
    mkdirSync(dirname(alvo), { recursive: true });
    writeFileSync(alvo, conteudo);
  }
  const arquivos = Object.fromEntries(
    Object.entries(saida)
      .filter(([n]) => !n.startsWith('ecm30-bridge/'))
      .map(([n, c]) => [n, sha(c)])
  );
  const hashesPonte = Object.fromEntries(
    Object.entries(saida)
      .filter(([n]) => n.startsWith('ecm30-bridge/'))
      .map(([n, c]) => [n.slice('ecm30-bridge/'.length), sha(c)])
  );
  const modulos = idsOrdenados.map((id) => {
    const a = porId.get(id);
    return { id, offset: Buffer.byteLength(fonte.slice(0, a.ini), 'utf8'), bytes: Buffer.byteLength(a.texto, 'utf8'), sha256: sha(a.texto) };
  });
  console.log(JSON.stringify({ arquivos, ponte: hashesPonte, modulos }, null, 2));
}
