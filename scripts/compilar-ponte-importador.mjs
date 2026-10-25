#!/usr/bin/env node
// Recompila a ponte do importador do Studio (src/flow/ponte-importador) e imprime os SHA-256 para
// HASHES_PONTE_IMPORTADOR em src/flow/importar.js.
//
//   node scripts/compilar-ponte-importador.mjs [--javac <caminho>] [--cache <pasta>]
//
// Exige um JDK (javac 8 ou superior) e o conversor + importador do Studio 1.8.2.0 no cache
// (fluig-mcp instalar-conversor). Os .class saem para Java 8 (--release 8).
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { delimiter, join, relative, sep } from 'node:path';
import { conferirConversor, conferirImportador, dirCache } from '../src/flow/conversor.js';
import { DIR_PONTE_IMPORTADOR } from '../src/flow/importar.js';

const args = process.argv.slice(2);
const valor = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const javac = valor('--javac') || process.env.FLUIG_MCP_JAVAC || (process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin', 'javac') : 'javac');
const cache = dirCache({ cache: valor('--cache') });
const versao = '1.8.2.0';

const conv = await conferirConversor(join(cache, 'studio', versao), versao);
const imp = await conferirImportador(join(cache, 'importador', versao), versao);
const classpath = [...conv.classpath, ...imp.classpath, conv.xstream].join(delimiter);

function listar(dir, filtro) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...listar(p, filtro));
    else if (filtro(p)) out.push(p);
  }
  return out;
}

const classes = join(DIR_PONTE_IMPORTADOR, 'classes');
const fontes = listar(DIR_PONTE_IMPORTADOR, (p) => p.endsWith('.java') && !p.startsWith(classes + sep));
// o javac 8 escreve a versão no stderr; os mais novos, no stdout
const v = spawnSync(javac, ['-version'], { encoding: 'utf8' });
if (v.status !== 0) throw new Error(`javac não executou (${javac}): ${v.error ? v.error.message : v.stderr}`);
const versaoJavac = `${v.stdout || ''}${v.stderr || ''}`.trim();
const alvo = /javac 1\.8/.test(versaoJavac) ? ['-source', '1.8', '-target', '1.8'] : ['--release', '8', '-Xlint:-options'];
rmSync(classes, { recursive: true, force: true });
mkdirSync(classes, { recursive: true }); // o javac 8 exige a pasta de -d
execFileSync(javac, [...alvo, '-nowarn', '-encoding', 'UTF-8', '-d', classes, '-cp', classpath, ...fontes], { stdio: 'inherit' });

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const todos = [...fontes, ...listar(classes, (p) => p.endsWith('.class'))]
  .map((p) => relative(DIR_PONTE_IMPORTADOR, p).split(sep).join('/'))
  .sort();
console.log(`// ${versaoJavac}`);
console.log('export const HASHES_PONTE_IMPORTADOR = Object.freeze({');
for (const r of todos) console.log(`  '${r}': '${sha(join(DIR_PONTE_IMPORTADOR, ...r.split('/')))}',`);
console.log('});');
