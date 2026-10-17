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
