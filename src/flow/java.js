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

// ---------------------------------------------------------------- importador do Studio

/** O SWT do Studio (Neon) só existe para x86_64: o Java do importador tem de ser dessa arquitetura. */
export const ARQUITETURAS_IMPORTADOR = Object.freeze(['x86_64', 'amd64']);

/**
 * Java do importador: opcoes.javaImportador → FLUIG_MCP_JAVA_IMPORTADOR → no macOS,
 * `/usr/libexec/java_home -a x86_64` → a mesma busca do conversor (resolverJava).
 */
export async function resolverJavaImportador({ javaImportador, env = process.env, existe = existsSync, plataforma = process.platform, executar = executarPadrao } = {}) {
  for (const fonte of [javaImportador, env.FLUIG_MCP_JAVA_IMPORTADOR]) {
    if (fonte && String(fonte).trim()) {
      return deCaminho(fonte, existe, plataforma) || semAspas(fonte);
    }
  }
  if (plataforma === 'darwin') {
    try {
      const r = await executar('/usr/libexec/java_home', ['-a', 'x86_64'], { ...OPCOES_EXECUCAO, timeout: 30000 });
      const home = String((r && r.stdout) || '').trim();
      const exe = home && deCaminho(home, existe, plataforma);
      if (exe) return exe;
    } catch {
      /* sem Java x86_64 registrado: segue a busca normal */
    }
  }
  return resolverJava({ env, existe, plataforma });
}

/** 'os.arch = x86_64' na saída de `java -XshowSettings:properties -version`. */
export function lerArquiteturaJava(texto) {
  const m = /^\s*os\.arch\s*=\s*(\S+)\s*$/m.exec(String(texto));
  if (!m) throw new ErroFluxo('E_JAVA_ARQUITETURA', `Não foi possível ler a arquitetura do Java (os.arch) na saída: ${String(texto).slice(0, 200)}`);
  return m[1];
}

/** Roda `java -XshowSettings:properties -version` uma vez: { major, arquitetura }. Exige Java 8+ x86_64. */
export async function conferirJavaImportador(caminho, { executar = executarPadrao } = {}) {
  let r;
  try {
    r = await executar(caminho, ['-XshowSettings:properties', '-version'], { ...OPCOES_EXECUCAO, timeout: 30000 });
  } catch (e) {
    throw new ErroFluxo(
      'E_JAVA_AUSENTE',
      `Java do importador não encontrado ou não executou (${caminho}): ${e && e.message}. Instale um JDK 8 ou superior x64 (no Mac com chip Apple ele roda sob Rosetta) ou defina FLUIG_MCP_JAVA_IMPORTADOR.`
    );
  }
  const texto = `${r.stderr || ''}\n${r.stdout || ''}`;
  const major = lerVersaoJava(texto);
  if (major < 8) {
    throw new ErroFluxo('E_JAVA_VERSAO', `Java ${major} não serve para o importador: exige Java 8 ou superior x64. Defina FLUIG_MCP_JAVA_IMPORTADOR.`);
  }
  const arquitetura = lerArquiteturaJava(texto);
  if (!ARQUITETURAS_IMPORTADOR.includes(arquitetura)) {
    throw new ErroFluxo(
      'E_JAVA_ARQUITETURA',
      `O Java ${caminho} é ${arquitetura}; o importador do Studio usa o SWT x86_64 e precisa de um Java x64. Instale um JDK 8 ou superior x64 (no Mac com chip Apple ele roda sob Rosetta) e aponte FLUIG_MCP_JAVA_IMPORTADOR para ele.`
    );
  }
  return { major, arquitetura };
}

/** Argumentos do `java` para a ponte do importador. No macOS o SWT exige a thread principal. */
export function argumentosImportador({ major, plataforma = process.platform, classpath, entrada, pastaSaida, processId, servidor }) {
  const args = [];
  if (plataforma === 'darwin') args.push('-XstartOnFirstThread');
  if (major >= 9) args.push(...ADD_OPENS);
  args.push('-cp', classpath.join(delimiter), 'ImportadorBridge', entrada, pastaSaida, processId, servidor);
  return args;
}

/** Argumentos do `java` para a ponte. `classpath` = [classesDaPonte, ...jars, xstreamJar]. */
export function argumentosJava({ major, classpath, entrada, saida, versao }) {
  const args = [];
  if (major >= 9) args.push(...ADD_OPENS);
  args.push('-cp', classpath.join(delimiter), 'Ecm30Bridge', entrada, saida, versao);
  return args;
}
