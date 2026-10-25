// Tabela e "JARs" falsos para testar conversor.js e regenerar.js sem baixar nem copiar nada da TOTVS.
// Não é um teste: só um utilitário.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { montarZip } from './_zip-builder.js';

export const sha = (b) => createHash('sha256').update(b).digest('hex');

export const XSTREAM_FALSO = Buffer.from('xstream falso, apenas para teste');
const BPMN = Buffer.from(montarZip([{ nome: 'META-INF/lib/xstream.jar', dados: XSTREAM_FALSO, metodo: 8 }]));

export const ARQUIVOS = {
  'com.totvs.tds.ecm.designer.model_9.9.9.9.jar': Buffer.from('model falso'),
  'org.eclipse.emf.ecore_9.9.jar': Buffer.from('ecore falso'),
  'com.totvs.tds.ecm.designer.export.bpmn20_9.9.9.9.jar': BPMN,
};

const item = (nome, comUrl) => ({
  nome,
  bytes: ARQUIVOS[nome].length,
  sha256: sha(ARQUIVOS[nome]),
  origem: nome.startsWith('com.totvs') ? 'totvs' : 'eclipse',
  ...(comUrl ? { url: `https://exemplo.invalido/plugins/${nome}` } : {}),
});

export function tabelaFalsa() {
  const nomes = Object.keys(ARQUIVOS);
  const xstream = { bytes: XSTREAM_FALSO.length, sha256: sha(XSTREAM_FALSO) };
  return {
    '9.9.9.9': { jars: nomes.map((n) => item(n, true)), xstream },
    '8.8.8.8': { jars: nomes.map((n) => item(n, false)), xstream },
  };
}

/** Grava os JARs falsos numa pasta (ou em <raiz>/plugins) e devolve o caminho dela. */
export function pastaPlugins(raiz, { raizEclipse = false } = {}) {
  const dir = raizEclipse ? join(raiz, 'plugins') : raiz;
  mkdirSync(dir, { recursive: true });
  for (const [n, b] of Object.entries(ARQUIVOS)) writeFileSync(join(dir, n), b);
  return dir;
}

// ---------------------------------------------------------------- importador do Studio (falso)

export const ARQUIVOS_IMPORTADOR = {
  'com.totvs.tds.ecm.designer.gui_9.9.9.9.jar': Buffer.from('gui falso'),
  'org.eclipse.graphiti_9.9.jar': Buffer.from('graphiti falso'),
};
export const SWT_FALSO = {
  darwin: ['org.eclipse.swt.cocoa_9.9.jar', Buffer.from('swt cocoa falso')],
  win32: ['org.eclipse.swt.win32_9.9.jar', Buffer.from('swt win32 falso')],
};

const itemImp = (nome, buf, comUrl) => ({
  nome,
  bytes: buf.length,
  sha256: sha(buf),
  origem: nome.startsWith('com.totvs') ? 'totvs' : 'eclipse',
  ...(comUrl ? { url: `https://exemplo.invalido/plugins/${nome}` } : {}),
});

/** Tabela no formato de IMPORTADORES, com as mesmas versões falsas de tabelaFalsa (9.9.9.9 com URL, 8.8.8.8 sem). */
export function tabelaImportadorFalsa() {
  const def = (comUrl) => ({
    jars: Object.entries(ARQUIVOS_IMPORTADOR).map(([n, b]) => itemImp(n, b, comUrl)),
    swt: Object.fromEntries(Object.entries(SWT_FALSO).map(([p, [n, b]]) => [p, itemImp(n, b, comUrl)])),
  });
  return { '9.9.9.9': def(true), '8.8.8.8': def(false) };
}

/** Todos os arquivos do importador falso (JARs + os dois SWT), por nome. */
export const TODOS_IMPORTADOR = { ...ARQUIVOS_IMPORTADOR, ...Object.fromEntries(Object.values(SWT_FALSO)) };

/** Grava os JARs falsos do importador (e os dois SWT) numa pasta. `sem` lista nomes a omitir. */
export function pastaImportador(dir, { sem = [] } = {}) {
  mkdirSync(dir, { recursive: true });
  for (const [n, b] of Object.entries(TODOS_IMPORTADOR)) if (!sem.includes(n)) writeFileSync(join(dir, n), b);
  return dir;
}
