// Localização e argumentos do Java do conversor (src/flow/java.js). Offline, sem rodar Java.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { argumentosJava, lerVersaoJava, resolverJava, versaoJava } from '../src/flow/java.js';

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
