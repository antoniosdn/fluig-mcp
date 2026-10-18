// gerarArtefatos: spec → .process + ECM30 + SVG (src/flow/artefatos.js). Offline.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gerarArtefatos } from '../src/flow/artefatos.js';
import { instalarConversor } from '../src/flow/conversor.js';
import { tabelaFalsa, pastaPlugins } from './_conversor-falso.js';

// tmpdir isolado do arquivo: tudo que os testes criam fica aqui e some no fim
const RAIZ_TMP = mkdtempSync(join(tmpdir(), 'artefatos-raiz-'));
process.env.TMPDIR = RAIZ_TMP;
after(() => rmSync(RAIZ_TMP, { recursive: true, force: true }));
const fixture = (nome) => JSON.parse(readFileSync(new URL(`./fixtures/flow/${nome}.json`, import.meta.url), 'utf8'));
const tmp = () => mkdtempSync(join(RAIZ_TMP, 'artefatos-'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const rejeita = (p, codigo, re) => assert.rejects(p, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);
const arquivos = (dir) => {
  const saida = [];
  const anda = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) anda(join(d, e.name));
      else saida.push(join(d, e.name));
    }
  };
  if (existsSync(dir)) anda(dir);
  return saida.sort();
};
const hashes = (dir) => Object.fromEntries(arquivos(dir).map((a) => [a, sha(readFileSync(a))]));
const fluigFlowNoTmp = () => readdirSync(RAIZ_TMP).filter((n) => n.startsWith('fluig-flow-'));

test('com projeto: grava os três; segunda execução sem mudança; nenhum .tmp- sobra', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = fixture('spec-completa');
    const r = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.equal(r.process.caminho, join(projeto, 'workflow', 'diagrams', 'gerador_oraculo.process'));
    assert.equal(r.ecm30.caminho, join(projeto, 'workflow', '.resources', 'gerador_oraculo.ecm30.xml'));
    assert.equal(r.svg.caminho, join(projeto, 'workflow', '.resources', 'gerador_oraculo.processimage.svg'));
    assert.equal(readFileSync(r.process.caminho, 'utf8'), r.process.conteudo);
    assert.equal(readFileSync(r.ecm30.caminho, 'utf8'), r.ecm30.conteudo);
    assert.match(readFileSync(r.svg.caminho, 'utf8'), /<svg/);
    assert.deepEqual([r.process.alterado, r.ecm30.alterado, r.svg.alterado], [true, true, true]);
    assert.equal(r.conversor.tipo, 'proprio');
    assert.ok(r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));

    const r2 = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.deepEqual([r2.process.alterado, r2.ecm30.alterado, r2.svg.alterado], [false, false, false]);
    assert.deepEqual([r2.process.backup, r2.ecm30.backup], [null, null]);
    assert.ok(!existsSync(join(projeto, 'workflow', '.resources', '.backups')));
    assert.deepEqual(arquivos(projeto).filter((a) => a.includes('.tmp-')), []);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('.process diferente sem sobrescrever → E_PROCESS_EXISTE e nada muda; com sobrescrever → backups', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = fixture('spec-completa');
    await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    const antes = hashes(projeto);
    const outra = fixture('spec-completa');
    outra.atividades[1].nome = 'Solicitar compra';
    await rejeita(gerarArtefatos(outra, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache }), 'E_PROCESS_EXISTE', /sobrescrever/);
    assert.deepEqual(hashes(projeto), antes);

    const agora = () => new Date('2026-10-17T12:00:00.000Z');
    const r = await gerarArtefatos(outra, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache, sobrescrever: true, agora });
    assert.equal(r.ok, true);
    assert.equal(r.process.alterado, true);
    const carimbo = '2026-10-17T12-00-00-000Z';
    assert.equal(r.process.backup, join(projeto, 'workflow', '.resources', '.backups', `gerador_oraculo.process.${carimbo}.bak`));
    assert.equal(r.ecm30.backup, join(projeto, 'workflow', '.resources', '.backups', `gerador_oraculo.ecm30.xml.${carimbo}.bak`));
    assert.ok(existsSync(r.process.backup) && existsSync(r.ecm30.backup));
    assert.match(readFileSync(r.process.caminho, 'utf8'), /Solicitar compra/);
    assert.deepEqual(arquivos(projeto).filter((a) => a.includes('.tmp-')), []);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('projeto relativo ou inexistente → E_PROJETO', async () => {
  const spec = fixture('spec-completa');
  const cache = tmp();
  try {
    await rejeita(gerarArtefatos(spec, { versaoAlvo: '2.0', projeto: 'relativo/pasta', conversor: 'proprio', cache }), 'E_PROJETO', /absoluto/);
    await rejeita(gerarArtefatos(spec, { versaoAlvo: '2.0', projeto: join(RAIZ_TMP, 'nao-existe-fluig-xyz'), conversor: 'proprio', cache }), 'E_PROJETO', /não existe/);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('sem projeto: devolve os conteúdos, caminhos null e nenhum fluig-flow-* sobra no tmpdir', async () => {
  const cache = tmp();
  try {
    const antes = fluigFlowNoTmp();
    const r = await gerarArtefatos(fixture('spec-completa'), { versaoAlvo: '1.8.2', conversor: 'proprio', cache });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.deepEqual([r.process.caminho, r.ecm30.caminho, r.svg.caminho], [null, null, null]);
    assert.match(r.process.conteudo, /^<\?xml/);
    assert.match(r.ecm30.conteudo, /^<list>/);
    assert.match(r.svg.conteudo, /<svg/);
    assert.deepEqual(fluigFlowNoTmp(), antes);
    // erro depois de criar o temporário também limpa
    await assert.rejects(gerarArtefatos(fixture('spec-completa'), { versaoAlvo: '1.8.2', conversor: 'oficial', cache }), (e) => e.codigo === 'E_CONVERSOR_AUSENTE');
    assert.deepEqual(fluigFlowNoTmp(), antes);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('spec com erro → ok:false e nada criado', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = fixture('spec-completa');
    spec.ligacoes.push({ de: 'fim', para: 'sol' });
    const r = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.equal(r.ok, false);
    assert.ok(r.erros.length > 0);
    assert.deepEqual(arquivos(projeto), []);
    assert.ok(!existsSync(join(projeto, 'workflow')));
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('condicao.nome → E_PROCESS_CONDICAO_NOME sem criar arquivos', async () => {
  const projeto = tmp();
  try {
    const spec = fixture('spec-completa');
    spec.ligacoes.find((l) => l.condicao).condicao.nome = 'Maior que cem';
    await rejeita(gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio' }), 'E_PROCESS_CONDICAO_NOME');
    assert.deepEqual(arquivos(projeto), []);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test('auto com cache vazio → plano B com W_ECM30_NAO_OFICIAL; oficial com cache vazio → E_CONVERSOR_AUSENTE', async () => {
  const cache = tmp();
  try {
    const r = await gerarArtefatos(fixture('spec-ou'), { versaoAlvo: '2.0', conversor: 'auto', cache });
    assert.equal(r.conversor.tipo, 'proprio');
    assert.ok(r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));
    await rejeita(gerarArtefatos(fixture('spec-ou'), { versaoAlvo: '2.0', conversor: 'oficial', cache }), 'E_CONVERSOR_AUSENTE', /instalar-conversor/);
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

test('oficial com conversor falso: a ponte recebe o .process gravado e o ECM30 falso é gravado', async () => {
  const projeto = tmp();
  const cache = tmp();
  const fonte = tmp();
  try {
    const t = tabelaFalsa();
    const tabela = { '1.8.2.0': t['9.9.9.9'], '2.0.0.2': t['8.8.8.8'] };
    pastaPlugins(fonte);
    await instalarConversor({ de: fonte, cache, tabela });
    const ECM30 = '<list>\n  <ProcessDefinition>\n  </ProcessDefinition>\n  <ProcessDefinitionVersion>\n  </ProcessDefinitionVersion>\n</list>\n';
    const chamadas = [];
    const executar = async (arquivo, args) => {
      chamadas.push(args);
      if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "21"' };
      writeFileSync(args[args.indexOf('Ecm30Bridge') + 2], ECM30);
      return { stdout: '', stderr: '' };
    };
    const r = await gerarArtefatos(fixture('spec-completa'), {
      versaoAlvo: '1.8.2', projeto, conversor: 'oficial', cache, executar, java: '/falso/bin/java', _tabela: tabela,
    });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.equal(r.conversor.tipo, 'oficial');
    const ponte = chamadas.find((a) => a[0] !== '-version');
    assert.ok(ponte.includes(r.process.caminho), 'a ponte recebe o .process gravado');
    assert.equal(readFileSync(r.ecm30.caminho, 'utf8'), ECM30);
    assert.ok(!r.avisos.some((a) => a.codigo === 'W_ECM30_NAO_OFICIAL'));
    assert.match(readFileSync(r.svg.caminho, 'utf8'), /<svg/);
  } finally {
    for (const d of [projeto, cache, fonte]) rmSync(d, { recursive: true, force: true });
  }
});

test('erro do conversor depois de gravar o .process: o .process fica e a mensagem diz como regenerar', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = fixture('spec-completa');
    await assert.rejects(gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'oficial', cache }), (e) => {
      assert.equal(e.codigo, 'E_CONVERSOR_AUSENTE');
      assert.match(e.message, /ficou gravado[\s\S]*fluig-mcp regenerar/);
      return true;
    });
    assert.ok(existsSync(join(projeto, 'workflow', 'diagrams', 'gerador_oraculo.process')));
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('serviço: script vazio criado para o conversor oficial (temporário) e evento no ECM30 do plano B', async () => {
  const cache = tmp();
  const fonte = tmp();
  try {
    const t = tabelaFalsa();
    const tabela = { '1.8.2.0': t['9.9.9.9'], '2.0.0.2': t['8.8.8.8'] };
    pastaPlugins(fonte);
    await instalarConversor({ de: fonte, cache, tabela });
    const ECM30 = '<list>\n  <ProcessDefinition>\n  </ProcessDefinition>\n  <ProcessDefinitionVersion>\n  </ProcessDefinitionVersion>\n</list>\n';
    const vistos = [];
    const executar = async (arquivo, args) => {
      if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "21"' };
      const proc = args.find((a) => a.endsWith('.process'));
      const dirScripts = join(proc, '..', '..', 'scripts');
      for (const f of existsSync(dirScripts) ? readdirSync(dirScripts) : []) vistos.push([f, readFileSync(join(dirScripts, f), 'utf8')]);
      writeFileSync(args[args.indexOf('Ecm30Bridge') + 2], ECM30);
      return { stdout: '', stderr: '' };
    };
    const r = await gerarArtefatos(fixture('spec-completa'), {
      versaoAlvo: '1.8.2', conversor: 'oficial', cache, executar, java: '/falso/bin/java', _tabela: tabela,
    });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.equal(r.scripts.length, 2);
    assert.ok(r.scripts.every((s) => s.arquivo === null && s.criado === true));
    const el = r.ids.erp;
    assert.match(el, /^servicetask\d+$/);
    assert.deepEqual(vistos.find(([f]) => f === `gerador_oraculo.${el}.js`), [`gerador_oraculo.${el}.js`, `function ${el}() {\n}\n`]);
    const av = r.avisos.filter((a) => a.codigo === 'W_SCRIPT_SERVICO_VAZIO');
    assert.equal(av.length, 2);
    assert.match(av[0].mensagem, /^Serviço erp: criado script vazio gerador_oraculo\.servicetask\d+\.js/);
    assert.equal(fluigFlowNoTmp().length, 0);
  } finally {
    for (const d of [cache, fonte]) rmSync(d, { recursive: true, force: true });
  }
});

test('serviço: plano B leva o evento servicetask<N> ao ECM30; script existente é preservado', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = fixture('spec-completa');
    const r = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    const el = r.ids.erp;
    assert.match(r.ecm30.conteudo, new RegExp(`<eventId>${el}</eventId>`));
    const arq = join(projeto, 'workflow', 'scripts', `gerador_oraculo.${el}.js`);
    assert.equal(readFileSync(arq, 'utf8'), `function ${el}() {\n}\n`);
    assert.equal(r.scripts.find((s) => s.atividade === 'erp').arquivo, arq);

    writeFileSync(arq, `function ${el}() {\n  // meu código\n}\n`);
    const r2 = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.equal(readFileSync(arq, 'utf8'), `function ${el}() {\n  // meu código\n}\n`);
    assert.equal(r2.scripts.find((s) => s.atividade === 'erp').criado, false);
    assert.ok(!r2.avisos.some((a) => a.codigo === 'W_SCRIPT_SERVICO_VAZIO' && /Serviço erp/.test(a.mensagem)));
    assert.equal(r2.scripts.find((s) => s.atividade === 'avisa').criado, false);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});

test('serviço: spec sem serviço não cria script', async () => {
  const projeto = tmp();
  const cache = tmp();
  try {
    const spec = {
      processId: 'sem_servico',
      atividades: [
        { id: 'ini', tipo: 'inicio', nome: 'Início' },
        { id: 'hum', tipo: 'humana', nome: 'Preencher', responsavel: { tipo: 'pool_papel', valor: 'solicitante' } },
        { id: 'fim', tipo: 'fim', nome: 'Fim' },
      ],
      ligacoes: [
        { de: 'ini', para: 'hum' },
        { de: 'hum', para: 'fim' },
      ],
    };
    const r = await gerarArtefatos(spec, { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.deepEqual(r.scripts, []);
    assert.ok(!existsSync(join(projeto, 'workflow', 'scripts')));
  } finally {
    rmSync(projeto, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});
