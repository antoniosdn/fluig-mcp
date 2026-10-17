// regenerar: .process → ECM30 + SVG em .resources (src/flow/regenerar.js).
// Offline: o plano B usa o gerador próprio; o oficial usa tabela falsa e um "Java" falso injetado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { regenerar } from '../src/flow/regenerar.js';
import { lerProcess } from '../src/flow/process.js';
import { lerXmlProcesso } from '../src/flow/ler.js';
import { instalarConversor } from '../src/flow/conversor.js';
import { DIR_PONTE } from '../src/flow/fluiggers.js';
import { montarProcessoSintetico } from './_process-sintetico.js';
import { pastaPlugins, tabelaFalsa } from './_conversor-falso.js';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const tmp = () => mkdtempSync(join(tmpdir(), 'regen-teste-'));
const rejeita = (p, codigo, re) => assert.rejects(p, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);
const normSpec = (s) => ({ ...s, ligacoes: s.ligacoes.map((l) => JSON.stringify(l)).sort(), atividades: [...s.atividades].sort((a, b) => a.id.localeCompare(b.id)) });

/** Projeto temporário com workflow/diagrams/proc_x.process e um script de evento. */
function projeto(opcoesProcesso = {}, { texto } = {}) {
  const raiz = tmp();
  const dirD = join(raiz, 'workflow', 'diagrams');
  mkdirSync(dirD, { recursive: true });
  mkdirSync(join(raiz, 'workflow', 'scripts'), { recursive: true });
  const proc = texto || montarProcessoSintetico({ id: 'proc_x', ...opcoesProcesso }).texto;
  const caminho = join(dirD, 'proc_x.process');
  writeFileSync(caminho, proc);
  writeFileSync(join(raiz, 'workflow', 'scripts', 'proc_x.beforeTaskSave.js'), 'function beforeTaskSave(colleagueId, nextSequenceId, userList) {\n  // gravado & <testado>\n}\n');
  return { raiz, caminho, proc, res: join(raiz, 'workflow', '.resources') };
}

test('caminho fora de workflow/diagrams → E_CAMINHO; versão 3.0 → E_VERSAO; arquivo ausente → E_CAMINHO', async () => {
  const p = projeto();
  try {
    const fora = join(p.raiz, 'x.process');
    writeFileSync(fora, p.proc);
    await rejeita(regenerar(fora, { conversor: 'proprio' }), 'E_CAMINHO', /workflow\/diagrams/);
    await rejeita(regenerar(join(p.raiz, 'workflow', 'diagrams', 'outro.txt'), { conversor: 'proprio' }), 'E_CAMINHO');
    await rejeita(regenerar(join(p.raiz, 'workflow', 'diagrams', 'nao_existe.process'), { conversor: 'proprio' }), 'E_CAMINHO', /não encontrado/);
    await rejeita(regenerar(p.caminho, { conversor: 'proprio', versao: '3.0' }), 'E_VERSAO');
    assert.ok(!existsSync(p.res));
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
  }
});

test('plano B: grava ECM30 e SVG; ECM30 relido = lerProcess; I_SCRIPTS; idempotente; backup ao mudar; .process intacto', async () => {
  const p = projeto();
  const cache = tmp();
  try {
    const antes = sha(readFileSync(p.caminho));
    const r = await regenerar(p.caminho, { conversor: 'proprio', cache });
    assert.equal(r.conversor.tipo, 'proprio');
    assert.equal(r.ecm30.caminho, join(p.res, 'proc_x.ecm30.xml'));
    assert.equal(r.svg.caminho, join(p.res, 'proc_x.processimage.svg'));
    assert.equal(r.ecm30.alterado, true);
    assert.equal(r.svg.alterado, true);
    assert.equal(r.ecm30.backup, null);
    assert.ok(r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));
    assert.ok(r.avisos.some((a) => a.codigo === 'W_PLANO_B_PERDA' && /I_ATIVIDADE_CAMPOS/.test(a.mensagem)));
    assert.equal(readFileSync(r.ecm30.caminho, 'utf8'), r.ecm30.conteudo);
    assert.match(readFileSync(r.svg.caminho, 'utf8'), /^\s*(<\?xml[^>]*\?>\s*)?<svg/);

    const lido = lerXmlProcesso(r.ecm30.conteudo);
    assert.deepEqual(normSpec(lido.spec), normSpec(lerProcess(p.proc).spec));
    const scripts = lido.ignorados.find((i) => i.codigo === 'I_SCRIPTS');
    assert.match(scripts.mensagem, /beforeTaskSave/);
    assert.ok(r.ecm30.conteudo.includes('gravado &amp; &lt;testado&gt;'), 'script escapado no eventDescription');

    // segunda execução: nada muda, sem backup
    const r2 = await regenerar(p.caminho, { conversor: 'proprio', cache });
    assert.equal(r2.ecm30.alterado, false);
    assert.equal(r2.svg.alterado, false);
    assert.equal(r2.ecm30.backup, null);
    assert.ok(!existsSync(join(p.res, '.backups')));

    // mudar o nome de uma atividade: ECM30 e SVG mudam, o anterior vai para .backups
    writeFileSync(p.caminho, p.proc.replace('name="Aprovar"', 'name="Aprovar v2"'));
    const r3 = await regenerar(p.caminho, { conversor: 'proprio', cache, agora: () => new Date('2026-10-17T10:20:30.456Z') });
    assert.equal(r3.ecm30.alterado, true);
    assert.equal(r3.svg.alterado, true);
    assert.equal(r3.ecm30.backup, join(p.res, '.backups', 'proc_x.ecm30.xml.2026-10-17T10-20-30-456Z.bak'));
    assert.deepEqual(readdirSync(join(p.res, '.backups')), ['proc_x.ecm30.xml.2026-10-17T10-20-30-456Z.bak']);
    assert.equal(readFileSync(r3.ecm30.backup, 'utf8'), r.ecm30.conteudo);
    assert.ok(r3.ecm30.conteudo.includes('Aprovar v2'));

    // o .process só mudou porque o próprio teste o reescreveu; o regenerar nunca escreve nele
    assert.equal(sha(readFileSync(p.caminho)), sha(p.proc.replace('name="Aprovar"', 'name="Aprovar v2"')));
    assert.notEqual(antes, sha(readFileSync(p.caminho)));
    assert.deepEqual(readdirSync(p.res).filter((n) => n.includes('.tmp-')), []);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('plano B: o .process fica idêntico (hash antes = depois)', async () => {
  const p = projeto();
  const cache = tmp();
  try {
    const antes = sha(readFileSync(p.caminho));
    await regenerar(p.caminho, { conversor: 'proprio', cache });
    assert.equal(sha(readFileSync(p.caminho)), antes);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('plano B recusa atribuição fora da v1 (E_PLANO_B_RECUSADO) e não grava nada', async () => {
  const p = projeto({
    atribuicao: { mechanism: 'Executor Atividade', mechanismConfiguration: { idNode: 'startevent1', returns: '1' } },
    gateway: false,
  });
  const cache = tmp();
  try {
    await rejeita(regenerar(p.caminho, { conversor: 'proprio', cache }), 'E_PLANO_B_RECUSADO', /W_LEITOR_ATRIBUICAO_FORA_V1/);
    assert.ok(!existsSync(p.res));
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('auto sem conversor no cache → plano B com aviso; oficial sem cache → E_CONVERSOR_AUSENTE', async () => {
  const p = projeto();
  const cache = tmp();
  try {
    const r = await regenerar(p.caminho, { cache });
    assert.equal(r.conversor.tipo, 'proprio');
    assert.ok(r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));
    await rejeita(regenerar(p.caminho, { cache, conversor: 'oficial' }), 'E_CONVERSOR_AUSENTE', /instalar-conversor/);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('gravar: false não cria .resources e indica onde gravaria', async () => {
  const p = projeto();
  const cache = tmp();
  try {
    const r = await regenerar(p.caminho, { conversor: 'proprio', cache, gravar: false });
    assert.ok(!existsSync(p.res));
    assert.equal(r.ecm30.caminho, join(p.res, 'proc_x.ecm30.xml'));
    assert.equal(r.ecm30.alterado, false);
    assert.ok(r.ecm30.bytes > 0 && r.svg.bytes > 0);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ */
/* Conversor oficial com Java e tabela falsos                          */
/* ------------------------------------------------------------------ */

const ECM30_FALSO = '<list>\n  <ProcessDefinition>\n  </ProcessDefinition>\n  <ProcessDefinitionVersion>\n  </ProcessDefinitionVersion>\n</list>\n';

async function cacheFalso() {
  const cache = tmp();
  const fonte = tmp();
  const t = tabelaFalsa();
  const tabela = { '1.8.2.0': t['9.9.9.9'], '2.0.0.2': t['8.8.8.8'] };
  pastaPlugins(fonte);
  await instalarConversor({ de: fonte, cache, tabela });
  rmSync(fonte, { recursive: true, force: true });
  return { cache, tabela };
}

/** Java falso: `-version` responde 21; a chamada da ponte grava o ECM30 e manda WARN no stderr. */
function javaFalso({ saida = ECM30_FALSO, falhar = false } = {}) {
  const chamadas = [];
  const executar = async (arquivo, args, opcoes) => {
    chamadas.push({ arquivo, args, opcoes });
    if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "21"' };
    if (falhar) throw Object.assign(new Error('Command failed: java'), { stderr: 'Exception in thread "main" java.lang.Boom', stdout: 'saida-parcial' });
    const destino = args[args.indexOf('Ecm30Bridge') + 2];
    writeFileSync(destino, saida);
    return {
      stdout: '',
      stderr: 'WARN O processo não possui um evento final\nWARN Não foi encontrado o valor do campo FILE_NOT_FOUND_IN_CLASSLOADER\nlinha qualquer\n',
    };
  };
  return { executar, chamadas };
}

test('oficial com Java falso: argumentos, ECM30 gravado, aviso do conversor, temporário removido', async () => {
  const p = projeto();
  const { cache, tabela } = await cacheFalso();
  try {
    const { executar, chamadas } = javaFalso();
    const r = await regenerar(p.caminho, { cache, _tabela: tabela, executar, java: '/falso/bin/java', agora: () => new Date(0) });
    assert.equal(r.conversor.tipo, 'oficial');
    assert.equal(r.conversor.versaoStudio, '1.8.2.0');
    assert.deepEqual(r.conversor.java, { caminho: '/falso/bin/java', major: 21 });
    assert.equal(readFileSync(r.ecm30.caminho, 'utf8'), ECM30_FALSO);
    assert.deepEqual(r.avisos.filter((a) => a.codigo === 'W_CONVERSOR'), [{ codigo: 'W_CONVERSOR', mensagem: 'O processo não possui um evento final' }]);
    assert.ok(!r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));

    assert.equal(chamadas.length, 2);
    const { arquivo, args, opcoes } = chamadas[1];
    assert.equal(arquivo, '/falso/bin/java');
    assert.equal(opcoes.timeout, 120000);
    assert.equal(opcoes.maxBuffer, 16 * 1024 * 1024);
    assert.equal(args.filter((a) => a.startsWith('--add-opens=')).length, 4);
    const cp = args[args.indexOf('-cp') + 1].split(delimiter);
    assert.equal(cp[0], join(DIR_PONTE, 'classes'), 'a ponte vem primeiro');
    assert.equal(cp.length, 1 + 3 + 1);
    assert.ok(cp[1].endsWith('com.totvs.tds.ecm.designer.model_9.9.9.9.jar'), 'ordem da tabela');
    assert.ok(cp[4].endsWith('xstream.jar'));
    assert.ok(!cp.some((c) => c.includes('*')));
    const i = args.indexOf('Ecm30Bridge');
    assert.equal(args[i + 1], p.caminho);
    assert.equal(args[i + 3], '1.8.2');
    assert.equal(args.length, i + 4);
    assert.ok(!existsSync(dirname(args[i + 2])), 'temporário apagado');

    // versão 2.0 sem Studio 2.0.0.2 → o falso tem; a versão vai literal
    const j2 = javaFalso();
    const r2 = await regenerar(p.caminho, { cache, _tabela: tabela, executar: j2.executar, java: '/falso/bin/java', versao: '2.0' });
    assert.equal(r2.conversor.versaoStudio, '2.0.0.2');
    const a2 = j2.chamadas[1].args;
    assert.equal(a2[a2.indexOf('Ecm30Bridge') + 3], '2.0');
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('oficial: Java 8 sem --add-opens; saída sem <list> → E_ECM30_INVALIDO; Java que falha → E_CONVERSOR_FALHOU com stderr', async () => {
  const p = projeto();
  const { cache, tabela } = await cacheFalso();
  try {
    const j8 = javaFalso();
    const exec8 = (a, args, o) => (args[0] === '-version' ? Promise.resolve({ stdout: '', stderr: 'java version "1.8.0_492"' }) : j8.executar(a, args, o));
    await regenerar(p.caminho, { cache, _tabela: tabela, executar: exec8, java: '/falso/java' });
    assert.ok(!j8.chamadas[0].args.some((a) => a.startsWith('--add-opens=')));

    const ruim = javaFalso({ saida: '<outra coisa/>' });
    await rejeita(regenerar(p.caminho, { cache, _tabela: tabela, executar: ruim.executar, java: '/falso/java' }), 'E_ECM30_INVALIDO');

    const quebra = javaFalso({ falhar: true });
    await rejeita(regenerar(p.caminho, { cache, _tabela: tabela, executar: quebra.executar, java: '/falso/java' }), 'E_CONVERSOR_FALHOU', /java\.lang\.Boom[\s\S]*saida-parcial/);
    // nada de .tmp sobrando
    assert.deepEqual(existsSync(p.res) ? readdirSync(p.res).filter((n) => n.includes('.tmp-')) : [], []);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('oficial: atividade manual (type 85) com 2 saídas → E_PRECONDICAO antes de rodar o Java', async () => {
  const base = montarProcessoSintetico({ id: 'proc_x', gateway: false }).texto;
  const texto = base.replace('type="80"', 'type="85"').replace(/outgoing="(flow\d+)"( managerAssignmentControllerString)/, 'outgoing="$1 flow99"$2');
  assert.notEqual(texto, base);
  const p = projeto({}, { texto });
  const { cache, tabela } = await cacheFalso();
  try {
    const { executar, chamadas } = javaFalso();
    await rejeita(
      regenerar(p.caminho, { cache, _tabela: tabela, executar, java: '/falso/java' }),
      'E_PRECONDICAO',
      /exatamente um fluxo de saida em cada atividade manual\. Corrija: task2 \(2 fluxos de saida\)/
    );
    assert.equal(chamadas.length, 0);
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('oficial: cache corrompido → erro (nunca plano B em silêncio); Studio 2.0.0.2 serve para 1.8.2 com aviso', async () => {
  const p = projeto();
  const { cache, tabela } = await cacheFalso();
  try {
    writeFileSync(join(cache, 'studio', '1.8.2.0', 'plugins', 'org.eclipse.emf.ecore_9.9.jar'), 'adulterado');
    const { executar } = javaFalso();
    await rejeita(regenerar(p.caminho, { cache, _tabela: tabela, executar, java: '/falso/java' }), 'E_CONVERSOR_CACHE');
    rmSync(join(cache, 'studio', '1.8.2.0'), { recursive: true, force: true });
    const r = await regenerar(p.caminho, { cache, _tabela: tabela, executar, java: '/falso/java' });
    assert.equal(r.conversor.versaoStudio, '2.0.0.2');
    assert.ok(r.avisos.some((a) => a.codigo === 'W_STUDIO_SUBSTITUTO'));
  } finally {
    rmSync(p.raiz, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('oficial: ponte adulterada → E_PONTE antes de chamar o Java', async () => {
  const p = projeto();
  const { cache, tabela } = await cacheFalso();
  const ponte = tmp();
  try {
    cpSync(DIR_PONTE, ponte, { recursive: true });
    const arq = join(ponte, 'classes', 'Ecm30Bridge.class');
    const b = readFileSync(arq);
    b[b.length - 1] ^= 1;
    writeFileSync(arq, b);
    const { executar, chamadas } = javaFalso();
    await rejeita(regenerar(p.caminho, { cache, _tabela: tabela, _dirPonte: ponte, executar, java: '/falso/java' }), 'E_PONTE', /Ecm30Bridge\.class/);
    assert.equal(chamadas.length, 0);
  } finally {
    for (const d of [p.raiz, cache, ponte]) rmSync(d, { recursive: true, force: true });
  }
});
