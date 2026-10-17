/**
 * Localiza e executa o Java do conversor ECM30 (passo 5.2). Mesma ordem de busca e mesmos
 * argumentos da extensão Fluiggers 3.0.1, com classpath explícito (sem curinga).
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { ErroFluxo } from './erro.js';

const ADD_OPENS = [
  '--add-opens=java.base/java.util=ALL-UNNAMED',
  '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
  '--add-opens=java.base/java.text=ALL-UNNAMED',
  '--add-opens=java.desktop/java.awt.font=ALL-UNNAMED',
];

/** 'openjdk version "21.0.12.1"' → 21; 'java version "1.8.0_492"' → 8. */
export function lerVersaoJava(texto) {
  const m = /version\s+"([^"]+)"/.exec(String(texto));
  if (!m) throw new ErroFluxo('E_JAVA_VERSAO', `Não foi possível ler a versão do Java na saída de "java -version": ${String(texto).slice(0, 200)}`);
  const partes = m[1].split(/[._-]/);
  let major = Number(partes[0]);
  if (major === 1) major = Number(partes[1]);
  if (!Number.isInteger(major) || major < 1) {
    throw new ErroFluxo('E_JAVA_VERSAO', `Versão do Java ilegível: "${m[1]}".`);
  }
  return major;
}

function semAspas(s) {
  return String(s).trim().replace(/^["']+|["']+$/g, '');
}

/** Resolve o executável a partir de um caminho que pode ser o executável ou uma pasta de JDK. */
function deCaminho(p, existe, plataforma) {
  const base = semAspas(p);
  const exe = plataforma === 'win32' ? 'java.exe' : 'java';
  const candidatos = [base, join(base, 'bin', exe), join(base, 'Contents', 'Home', 'bin', exe)];
  for (const c of candidatos) if (existe(c) && /(^|[\\/])java(\.exe)?$/i.test(c)) return c;
  return null;
}

/** opcoes.java → FLUIG_MCP_JAVA → JAVA_HOME → 'java'. */
export function resolverJava({ java, env = process.env, existe = existsSync, plataforma = process.platform } = {}) {
  for (const fonte of [java, env.FLUIG_MCP_JAVA]) {
    if (fonte && String(fonte).trim()) {
      return deCaminho(fonte, existe, plataforma) || semAspas(fonte);
    }
  }
  if (env.JAVA_HOME && String(env.JAVA_HOME).trim()) {
    const r = deCaminho(env.JAVA_HOME, existe, plataforma);
    if (r) return r;
  }
  return 'java';
}

/** Executável padrão: child_process.execFile em promessa. */
export function executarPadrao(arquivo, args, opcoes) {
  return new Promise((resolve, reject) => {
    execFile(arquivo, args, opcoes, (erro, stdout, stderr) => {
      if (erro) {
        erro.stdout = stdout;
        erro.stderr = stderr;
        reject(erro);
      } else resolve({ stdout, stderr });
    });
  });
}

export const OPCOES_EXECUCAO = Object.freeze({ windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });

/** Roda `<java> -version` e devolve o major. */
export async function versaoJava(caminho, { executar = executarPadrao } = {}) {
  let r;
  try {
    r = await executar(caminho, ['-version'], { ...OPCOES_EXECUCAO, timeout: 30000 });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new ErroFluxo('E_JAVA_AUSENTE', 'Java 8 ou superior não encontrado. Instale um JRE/JDK ou defina JAVA_HOME ou FLUIG_MCP_JAVA.');
    }
    throw new ErroFluxo('E_JAVA_AUSENTE', `Falha ao executar "${caminho} -version": ${e && e.message}. Instale um JRE/JDK ou defina JAVA_HOME ou FLUIG_MCP_JAVA.`);
  }
  const major = lerVersaoJava(`${r.stderr || ''}\n${r.stdout || ''}`);
  if (major < 8) {
    throw new ErroFluxo('E_JAVA_VERSAO', `Java ${major} não serve: o conversor exige Java 8 ou superior. Defina JAVA_HOME ou FLUIG_MCP_JAVA para um JDK mais novo.`);
  }
  return major;
}

/** Argumentos do `java` para a ponte. `classpath` = [classesDaPonte, ...jars, xstreamJar]. */
export function argumentosJava({ major, classpath, entrada, saida, versao }) {
  const args = [];
  if (major >= 9) args.push(...ADD_OPENS);
  args.push('-cp', classpath.join(delimiter), 'Ecm30Bridge', entrada, saida, versao);
  return args;
}
