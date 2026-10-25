// Localização e argumentos do Java do conversor (src/flow/java.js). Offline, sem rodar Java.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { argumentosImportador, argumentosJava, conferirJavaImportador, lerArquiteturaJava, lerVersaoJava, resolverJava, resolverJavaImportador, versaoJava } from '../src/flow/java.js';

test('lerVersaoJava: 8, 11, 17, 21 e texto ilegível', () => {
  assert.equal(lerVersaoJava('java version "1.8.0_492"\nJava(TM) SE Runtime Environment'), 8);
  assert.equal(lerVersaoJava('openjdk version "11.0.22" 2024-01-16'), 11);
  assert.equal(lerVersaoJava('openjdk version "17.0.10" 2024-01-16'), 17);
  assert.equal(lerVersaoJava('openjdk version "21.0.12.1" 2026-08-18 LTS'), 21);
  assert.equal(lerVersaoJava('openjdk version "21"'), 21);
  assert.throws(() => lerVersaoJava('nada que se pareça com versão'), (e) => e.codigo === 'E_JAVA_VERSAO');
});

test('resolverJava: ordem opcao → FLUIG_MCP_JAVA → JAVA_HOME → java', () => {
  const todos = () => true;
  const nenhum = () => false;
  assert.equal(resolverJava({ java: '/a/bin/java', env: { FLUIG_MCP_JAVA: '/b/bin/java', JAVA_HOME: '/c' }, existe: todos }), '/a/bin/java');
  assert.equal(resolverJava({ env: { FLUIG_MCP_JAVA: '/b/bin/java', JAVA_HOME: '/c' }, existe: todos }), '/b/bin/java');
  assert.equal(resolverJava({ env: { JAVA_HOME: '/c' }, existe: (p) => p === join('/c', 'bin', 'java'), plataforma: 'linux' }), join('/c', 'bin', 'java'));
  assert.equal(resolverJava({ env: {}, existe: nenhum }), 'java');
  // JAVA_HOME só vale se o executável existir
  assert.equal(resolverJava({ env: { JAVA_HOME: '/c' }, existe: nenhum }), 'java');
});

test('resolverJava: aceita pasta (bin/java, Contents/Home/bin/java), executável e aspas; .exe no Windows', () => {
  const so = (...ps) => (p) => ps.includes(p);
  assert.equal(resolverJava({ java: '/jdk', env: {}, existe: so(join('/jdk', 'bin', 'java')), plataforma: 'linux' }), join('/jdk', 'bin', 'java'));
  assert.equal(
    resolverJava({ java: '/jdk.jdk', env: {}, existe: so(join('/jdk.jdk', 'Contents', 'Home', 'bin', 'java')), plataforma: 'darwin' }),
    join('/jdk.jdk', 'Contents', 'Home', 'bin', 'java')
  );
  assert.equal(resolverJava({ java: '"/x/java"', env: {}, existe: so('/x/java'), plataforma: 'linux' }), '/x/java');
  assert.equal(resolverJava({ java: 'C:\\jdk', env: {}, existe: so(join('C:\\jdk', 'bin', 'java.exe')), plataforma: 'win32' }), join('C:\\jdk', 'bin', 'java.exe'));
  // pasta informada mas sem executável: devolve o texto como veio (sem aspas) e o erro aparece ao executar
  assert.equal(resolverJava({ java: '"/nao/existe"', env: {}, existe: () => false }), '/nao/existe');
});

test('versaoJava: lê o stderr de `java -version`; ENOENT → E_JAVA_AUSENTE; Java 7 → E_JAVA_VERSAO', async () => {
  const ok = async () => ({ stdout: '', stderr: 'openjdk version "21.0.12.1" 2026-08-18 LTS' });
  assert.equal(await versaoJava('java', { executar: ok }), 21);
  const ausente = async () => {
    throw Object.assign(new Error('spawn java ENOENT'), { code: 'ENOENT' });
  };
  await assert.rejects(versaoJava('java', { executar: ausente }), (e) => e.codigo === 'E_JAVA_AUSENTE' && /Java 8 ou superior não encontrado/.test(e.message));
  const velho = async () => ({ stdout: '', stderr: 'java version "1.7.0_80"' });
  await assert.rejects(versaoJava('java', { executar: velho }), (e) => e.codigo === 'E_JAVA_VERSAO');
});

test('argumentosJava: major 8 sem --add-opens, 21 com; classpath na ordem recebida', () => {
  const classpath = ['/p/classes', '/c/a.jar', '/c/b.jar', '/c/xstream.jar'];
  const a8 = argumentosJava({ major: 8, classpath, entrada: '/e.process', saida: '/s.xml', versao: '1.8.2' });
  assert.deepEqual(a8, ['-cp', classpath.join(delimiter), 'Ecm30Bridge', '/e.process', '/s.xml', '1.8.2']);
  const a21 = argumentosJava({ major: 21, classpath, entrada: '/e.process', saida: '/s.xml', versao: '2.0' });
  assert.equal(a21.filter((x) => x.startsWith('--add-opens=')).length, 4);
  assert.ok(a21.includes('--add-opens=java.base/java.util=ALL-UNNAMED'));
  assert.ok(a21.includes('--add-opens=java.desktop/java.awt.font=ALL-UNNAMED'));
  assert.ok(a21.indexOf('-cp') > a21.lastIndexOf(a21.find((x) => x.startsWith('--add-opens='))));
  assert.equal(a21[a21.indexOf('-cp') + 1], classpath.join(delimiter));
  assert.deepEqual(a21.slice(-4), ['Ecm30Bridge', '/e.process', '/s.xml', '2.0']);
  assert.ok(!a21.some((x) => x.includes('*')), 'sem curinga');
});

// ---------------------------------------------------------------- importador

const SETTINGS = (arch, versao = 'openjdk version "11.0.31" 2026-04-21') => `Property settings:\n    java.home = /x\n    os.arch = ${arch}\n    os.name = Mac OS X\n\n${versao}\nOpenJDK Runtime Environment`;

test('lerArquiteturaJava: x86_64, amd64, aarch64; sem os.arch → erro', () => {
  assert.equal(lerArquiteturaJava(SETTINGS('x86_64')), 'x86_64');
  assert.equal(lerArquiteturaJava(SETTINGS('amd64')), 'amd64');
  assert.equal(lerArquiteturaJava(SETTINGS('aarch64')), 'aarch64');
  assert.throws(() => lerArquiteturaJava('openjdk version "21"'), (e) => e.codigo === 'E_JAVA_ARQUITETURA');
});

test('resolverJavaImportador: opção → FLUIG_MCP_JAVA_IMPORTADOR → java_home -a x86_64 (macOS) → busca do conversor', async () => {
  const todos = () => true;
  const chamadas = [];
  const javaHome = async (arquivo, args) => {
    chamadas.push([arquivo, ...args]);
    return { stdout: '/jdk11.jdk/Contents/Home\n', stderr: '' };
  };
  assert.equal(await resolverJavaImportador({ javaImportador: '/a/bin/java', env: { FLUIG_MCP_JAVA_IMPORTADOR: '/b/bin/java' }, existe: todos, executar: javaHome }), '/a/bin/java');
  assert.equal(await resolverJavaImportador({ env: { FLUIG_MCP_JAVA_IMPORTADOR: '/b/bin/java' }, existe: todos, executar: javaHome }), '/b/bin/java');
  assert.equal(chamadas.length, 0, 'java_home só quando não há opção nem variável');
  const exe = join('/jdk11.jdk/Contents/Home', 'bin', 'java');
  assert.equal(await resolverJavaImportador({ env: { FLUIG_MCP_JAVA: '/c/bin/java' }, plataforma: 'darwin', existe: (p) => p === exe, executar: javaHome }), exe);
  assert.deepEqual(chamadas[0], ['/usr/libexec/java_home', '-a', 'x86_64']);
  // java_home falhou (nenhum Java x86_64): segue a busca do conversor
  const semJavaHome = async () => {
    throw new Error('Unable to find any JVMs matching architecture "x86_64"');
  };
  assert.equal(await resolverJavaImportador({ env: { FLUIG_MCP_JAVA: '/c/bin/java' }, plataforma: 'darwin', existe: todos, executar: semJavaHome }), '/c/bin/java');
  // fora do macOS não chama java_home
  const nunca = async () => {
    throw new Error('não devia chamar');
  };
  assert.equal(await resolverJavaImportador({ env: {}, plataforma: 'win32', existe: () => false, executar: nunca }), 'java');
});

test('conferirJavaImportador: 8 e 11 x86_64 ok, amd64 ok; aarch64 → E_JAVA_ARQUITETURA; Java 7 → E_JAVA_VERSAO; ausente → E_JAVA_AUSENTE', async () => {
  const resp = (texto) => async (arquivo, args) => {
    assert.deepEqual(args, ['-XshowSettings:properties', '-version']);
    return { stdout: '', stderr: texto };
  };
  assert.deepEqual(await conferirJavaImportador('java', { executar: resp(SETTINGS('x86_64', 'openjdk version "1.8.0_492"')) }), { major: 8, arquitetura: 'x86_64' });
  assert.deepEqual(await conferirJavaImportador('java', { executar: resp(SETTINGS('x86_64')) }), { major: 11, arquitetura: 'x86_64' });
  assert.deepEqual(await conferirJavaImportador('java', { executar: resp(SETTINGS('amd64')) }), { major: 11, arquitetura: 'amd64' });
  await assert.rejects(conferirJavaImportador('/arm/java', { executar: resp(SETTINGS('aarch64')) }), (e) => e.codigo === 'E_JAVA_ARQUITETURA' && /aarch64/.test(e.message) && /Rosetta/.test(e.message));
  await assert.rejects(conferirJavaImportador('java', { executar: resp(SETTINGS('x86_64', 'java version "1.7.0_80"')) }), (e) => e.codigo === 'E_JAVA_VERSAO');
  const ausente = async () => {
    throw Object.assign(new Error('spawn java ENOENT'), { code: 'ENOENT' });
  };
  await assert.rejects(conferirJavaImportador('java', { executar: ausente }), (e) => e.codigo === 'E_JAVA_AUSENTE' && /FLUIG_MCP_JAVA_IMPORTADOR/.test(e.message));
});

test('argumentosImportador: -XstartOnFirstThread só no macOS; --add-opens a partir do 9; classpath sem curinga', () => {
  const classpath = ['/p/classes', '/c/a.jar', '/i/swt.jar', '/c/xstream.jar'];
  const base = { classpath, entrada: '/t/e.xml', pastaSaida: '/t/saida', processId: 'proc_x', servidor: 'teste' };
  const mac8 = argumentosImportador({ ...base, major: 8, plataforma: 'darwin' });
  assert.deepEqual(mac8, ['-XstartOnFirstThread', '-cp', classpath.join(delimiter), 'ImportadorBridge', '/t/e.xml', '/t/saida', 'proc_x', 'teste']);
  const win11 = argumentosImportador({ ...base, major: 11, plataforma: 'win32' });
  assert.ok(!win11.includes('-XstartOnFirstThread'));
  assert.equal(win11.filter((x) => x.startsWith('--add-opens=')).length, 4);
  assert.deepEqual(win11.slice(-5), ['ImportadorBridge', '/t/e.xml', '/t/saida', 'proc_x', 'teste']);
  assert.ok(!win11.some((x) => x.includes('*')));
});
