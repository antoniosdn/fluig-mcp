// Importar processo do servidor como o Studio (src/flow/importar.js). Offline: tabelas falsas do conversor
// e do importador e um "Java" falso que faz o papel das duas pontes (ImportadorBridge e Ecm30Bridge).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { DIR_PONTE_IMPORTADOR, HASHES_PONTE_IMPORTADOR, conferirImportado, conferirNumerosRegenerados, importarEcm30, ligacoesDeLink, numerosDoXml, processIdDoXml } from '../src/flow/importar.js';
import { instalarConversor } from '../src/flow/conversor.js';
import { flowImport } from '../src/flow/ferramentas.js';
import { lerProcess } from '../src/flow/process.js';
import { gerarXmlProcesso } from '../src/flow/gerar.js';
import { montarProcessoSintetico } from './_process-sintetico.js';
import { carregarFluiggers } from '../src/flow/fluiggers.js';
import { SWT_FALSO, pastaImportador, pastaPlugins, tabelaFalsa, tabelaImportadorFalsa } from './_conversor-falso.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'importar-teste-'));
const limpar = (...d) => d.forEach((x) => rmSync(x, { recursive: true, force: true }));
const rejeita = (p, codigo, re) => assert.rejects(p, (e) => e.codigo === codigo && (!re || re.test(e.message)), `esperava ${codigo}`);

const ECM30_FALSO = '<list>\n  <ProcessDefinition>\n  </ProcessDefinition>\n  <ProcessDefinitionVersion>\n  </ProcessDefinitionVersion>\n</list>\n';

/** Par coerente: .process sintético (ids = números) e o ECM30 gerado dele com a mesma origem. */
async function par(id = 'proc_x') {
  const { texto } = montarProcessoSintetico({ id });
  const l = lerProcess(texto);
  const g = await gerarXmlProcesso(l.spec, { versaoAlvo: '1.8.2', origem: l.origem });
  assert.ok(g.ok);
  return { texto, xml: g.xml };
}

/** Cache com conversor e importador falsos nas versões 1.8.2.0 e 2.0.0.2, para macOS. */
async function cacheFalso() {
  const cache = tmp();
  const fonte = tmp();
  const t = tabelaFalsa();
  const ti = tabelaImportadorFalsa();
  const _tabela = { '1.8.2.0': t['9.9.9.9'], '2.0.0.2': t['8.8.8.8'] };
  const _tabelaImportador = { '1.8.2.0': ti['9.9.9.9'], '2.0.0.2': ti['8.8.8.8'] };
  pastaPlugins(fonte);
  pastaImportador(fonte);
  await instalarConversor({ de: fonte, cache, tabela: _tabela, tabelaImportador: _tabelaImportador, plataforma: 'darwin' });
  limpar(fonte);
  return { cache, _tabela, _tabelaImportador };
}

const SETTINGS = (arch) => `Property settings:\n    os.arch = ${arch}\n\nopenjdk version "11.0.31" 2026-04-21\n`;

/**
 * Java falso. ImportadorBridge: grava o .process e os scripts em <pastaSaida>/workflow e imprime o eco do
 * decoder + o JSON. Ecm30Bridge: grava o ECM30 falso.
 */
function javaFalso({ processo, scripts = { 'proc_x.beforeStateEntry.js': 'function beforeStateEntry(s) {}\n' }, literais = {}, json = {}, stdout, arquitetura = 'x86_64', falhar = false, ecm30Saida } = {}) {
  const chamadas = [];
  let entradaRecebida = null; // o ECM30 que a ponte recebeu: o conversor falso devolve o mesmo (números iguais)
  const executar = async (arquivo, args, opcoes) => {
    chamadas.push({ arquivo, args, opcoes });
    if (args[0] === '-XshowSettings:properties') return { stdout: '', stderr: SETTINGS(arquitetura) };
    if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "21"' };
    if (args.includes('ImportadorBridge')) {
      if (falhar) throw Object.assign(new Error('Command failed: java'), { stderr: 'Exception in thread "main" java.lang.NoClassDefFoundError: org/eclipse/swt/Boom' });
      const i = args.indexOf('ImportadorBridge');
      const [entrada, pasta, id] = args.slice(i + 1);
      entradaRecebida = readFileSync(entrada, 'utf8');
      const wf = join(pasta, 'workflow');
      if (processo !== null) {
        mkdirSync(join(wf, 'diagrams'), { recursive: true });
        writeFileSync(join(wf, 'diagrams', `${id}.process`), processo);
      }
      for (const [dir, arquivos] of [['scripts', scripts], ['literals', literais]]) {
        for (const [n, c] of Object.entries(arquivos)) {
          mkdirSync(join(wf, dir), { recursive: true });
          writeFileSync(join(wf, dir, n), c);
        }
      }
      const resultado = { ok: true, process: 'x', formId: 7, aviso: null, subprocessos: [], desconhecidos: [], ...json };
      return { stdout: stdout !== undefined ? stdout : `<list>eco do XML pelo decoder</list>\n${JSON.stringify(resultado)}\n`, stderr: '' };
    }
    if (args.includes('Ecm30Bridge')) {
      writeFileSync(args[args.indexOf('Ecm30Bridge') + 2], ecm30Saida !== undefined ? ecm30Saida : entradaRecebida || ECM30_FALSO);
      return { stdout: '', stderr: '' };
    }
    throw new Error(`chamada inesperada: ${args.join(' ')}`);
  };
  return { executar, chamadas };
}

const opcoesBase = (c, executar, extra = {}) => ({
  cache: c.cache,
  _tabela: c._tabela,
  _tabelaImportador: c._tabelaImportador,
  plataforma: 'darwin',
  javaImportador: '/falso/x64/bin/java',
  java: '/falso/bin/java',
  executar,
  agora: () => new Date(0),
  ...extra,
});

test('processIdDoXml, numerosDoXml e conferirImportado com o par sintético', async () => {
  const { texto, xml } = await par();
  assert.equal(processIdDoXml(xml), 'proc_x');
  const n = numerosDoXml(xml);
  assert.ok(n.estados.length >= 4 && n.ligacoes.length >= 3);
  const ids = conferirImportado(texto, xml);
  for (const s of n.estados) assert.match(ids.atividades[s], new RegExp(`${s}$`));
  for (const s of n.ligacoes) assert.match(ids.ligacoes[s], new RegExp(`${s}$`));
  // ECM30 com um número de atividade que o .process não tem → E_IMPORTADOR_IDS
  assert.throws(() => conferirImportado(texto, xml.replace(/<sequence>(\d+)<\/sequence>/, '<sequence>99</sequence>')), (e) => e.codigo === 'E_IMPORTADOR_IDS' && /99/.test(e.message));
  assert.throws(() => conferirImportado('<nada/>', xml), (e) => e.codigo === 'E_IMPORTADOR_PROCESS_INVALIDO');
});

test('com projeto: grava .process, scripts e .resources; argumentos e classpath; segunda vez = sem mudança', async () => {
  const c = await cacheFalso();
  const projeto = tmp();
  try {
    const { texto, xml } = await par();
    const j = javaFalso({ processo: texto, literais: { 'proc_x_pt_BR.properties': 'a=b\n' }, json: { desconhecidos: ['ProcessDefinition.icon'], subprocessos: ['sub_y'] } });
    const r = await importarEcm30(xml, opcoesBase(c, j.executar, { projeto, versaoAlvo: '1.8.2', servidor: 'teste' }));
    assert.equal(r.ok, true);
    assert.equal(r.versaoStudio, '1.8.2.0');
    assert.deepEqual(r.java, { caminho: '/falso/x64/bin/java', major: 11, arquitetura: 'x86_64' });
    assert.equal(r.formId, 7);
    assert.equal(r.process.caminho, join(projeto, 'workflow', 'diagrams', 'proc_x.process'));
    assert.equal(readFileSync(r.process.caminho, 'utf8'), texto);
    assert.equal(r.process.alterado, true);
    assert.deepEqual(r.scripts.map((s) => s.acao), ['criado']);
    assert.ok(existsSync(join(projeto, 'workflow', 'scripts', 'proc_x.beforeStateEntry.js')));
    assert.deepEqual(r.literais.map((s) => s.acao), ['criado']);
    assert.equal(readFileSync(join(projeto, 'workflow', '.resources', 'proc_x.ecm30.xml'), 'utf8'), xml);
    assert.ok(existsSync(join(projeto, 'workflow', '.resources', 'proc_x.processimage.svg')));
    assert.ok(Object.keys(r.ids.atividades).length >= 4);
    const codigos = r.avisos.map((a) => a.codigo);
    assert.ok(codigos.includes('W_IMPORTADOR_ITENS_DESCONHECIDOS'));
    assert.ok(codigos.includes('W_IMPORTADOR_SUBPROCESSOS'));

    const ponte = j.chamadas.find((x) => x.args.includes('ImportadorBridge'));
    assert.equal(ponte.arquivo, '/falso/x64/bin/java');
    assert.equal(ponte.args[0], '-XstartOnFirstThread');
    assert.equal(ponte.args.filter((a) => a.startsWith('--add-opens=')).length, 4);
    const cp = ponte.args[ponte.args.indexOf('-cp') + 1].split(delimiter);
    assert.equal(cp[0], join(DIR_PONTE_IMPORTADOR, 'classes'), 'a ponte vem primeiro');
    assert.ok(cp[1].endsWith('com.totvs.tds.ecm.designer.model_9.9.9.9.jar'), 'depois o conversor');
    assert.ok(cp[cp.length - 2].endsWith(SWT_FALSO.darwin[0]), 'o SWT no fim do importador');
    assert.ok(cp[cp.length - 1].endsWith('xstream.jar'));
    const i = ponte.args.indexOf('ImportadorBridge');
    assert.deepEqual(ponte.args.slice(i + 3), ['proc_x', 'teste']);
    assert.ok(!existsSync(ponte.args[i + 1]), 'temporário removido');

    assert.equal(j.chamadas.filter((x) => x.args.includes('Ecm30Bridge')).length, 1, 'o conversor roda uma vez só');
    assert.equal(r.scripts[0].conteudo, 'function beforeStateEntry(s) {}\n');

    const r2 = await importarEcm30(xml, opcoesBase(c, javaFalso({ processo: texto, literais: { 'proc_x_pt_BR.properties': 'a=b\n' } }).executar, { projeto }));
    assert.equal(r2.process.alterado, false);
    assert.deepEqual([...r2.scripts, ...r2.literais].map((s) => s.acao), ['igual', 'igual']);
    assert.equal(r2.ecm30.alterado, false);
  } finally {
    limpar(c.cache, projeto);
  }
});

test('script local diferente: mantido com aviso; com sobrescrever, backup e troca; .process diferente → E_PROCESS_EXISTE', async () => {
  const c = await cacheFalso();
  const projeto = tmp();
  try {
    const { texto, xml } = await par();
    const dirScripts = join(projeto, 'workflow', 'scripts');
    mkdirSync(dirScripts, { recursive: true });
    writeFileSync(join(dirScripts, 'proc_x.beforeStateEntry.js'), '// versão local\n');
    const jm = javaFalso({ processo: texto });
    const r = await importarEcm30(xml, opcoesBase(c, jm.executar, { projeto }));
    assert.equal(r.scripts[0].acao, 'mantido');
    assert.equal(jm.chamadas.filter((x) => x.args.includes('Ecm30Bridge')).length, 2, 'script local mantido: o ECM30 é refeito com ele no projeto');
    assert.ok(r.avisos.some((a) => a.codigo === 'W_SCRIPT_LOCAL_DIFERENTE'));
    assert.equal(readFileSync(join(dirScripts, 'proc_x.beforeStateEntry.js'), 'utf8'), '// versão local\n');

    // .process local diferente: recusa sem tocar em nada
    writeFileSync(join(projeto, 'workflow', 'diagrams', 'proc_x.process'), texto.replace('Aprovar', 'Aprovar local'));
    await rejeita(importarEcm30(xml, opcoesBase(c, javaFalso({ processo: texto }).executar, { projeto })), 'E_PROCESS_EXISTE');

    const r2 = await importarEcm30(xml, opcoesBase(c, javaFalso({ processo: texto }).executar, { projeto, sobrescrever: true }));
    assert.ok(r2.process.backup && existsSync(r2.process.backup));
    assert.equal(readFileSync(r2.process.caminho, 'utf8'), texto);
    assert.equal(r2.scripts[0].acao, 'substituido');
    assert.ok(existsSync(r2.scripts[0].backup));
    assert.equal(readFileSync(r2.scripts[0].backup, 'utf8'), '// versão local\n');
  } finally {
    limpar(c.cache, projeto);
  }
});

test('sem projeto: devolve conteúdo e não grava; 2.0 usa o importador 2.0.0.2', async () => {
  const c = await cacheFalso();
  try {
    const { texto, xml } = await par();
    const r = await importarEcm30(xml, opcoesBase(c, javaFalso({ processo: texto }).executar, { versaoAlvo: '2.0' }));
    assert.equal(r.versaoStudio, '2.0.0.2');
    assert.equal(r.process.caminho, null);
    assert.equal(r.process.conteudo, texto);
    assert.equal(r.ecm30.conteudo, xml);
    assert.match(r.svg.conteudo, /<svg/);
    assert.deepEqual(r.scripts.map((s) => s.nome), ['proc_x.beforeStateEntry.js']);
  } finally {
    limpar(c.cache);
  }
});

test('falhas: ponte quebra, saída sem JSON, sem .process, ids perdidos, Java arm, importador ausente, entrada ruim', async () => {
  const c = await cacheFalso();
  const projeto = tmp();
  try {
    const { texto, xml } = await par();
    const o = (j, extra) => opcoesBase(c, j.executar, { projeto, ...extra });
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto, falhar: true }))), 'E_IMPORTADOR_FALHOU', /NoClassDefFoundError/);
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto, stdout: 'só eco\n' }))), 'E_IMPORTADOR_FALHOU', /resultado esperado/);
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto, stdout: '{"ok":false,"codigo":"vazio","motivo":"processo sem atividades"}\n' }))), 'E_IMPORTADOR_VAZIO', /proc_x/);
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: null }))), 'E_IMPORTADOR_FALHOU', /sem gravar o \.process/);
    const renumerado = montarProcessoSintetico({ id: 'proc_x', gateway: false }).texto;
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: renumerado }))), 'E_IMPORTADOR_IDS');
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto, arquitetura: 'aarch64' }))), 'E_JAVA_ARQUITETURA');
    // o conversor devolve números diferentes: recusa antes de gravar
    const outro = xml.replace(/<linkSequence>(\d+)<\/linkSequence>/, '<linkSequence>777</linkSequence>');
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto, ecm30Saida: outro }))), 'E_IMPORTADOR_IDS', /ligações só no servidor: \d+; ligações só no regenerado: 777.*Nada foi gravado/);
    assert.ok(!existsSync(join(projeto, 'workflow')), 'nada gravado no projeto');

    await rejeita(importarEcm30(xml, { ...o(javaFalso({ processo: texto })), cache: tmp() }), 'E_IMPORTADOR_AUSENTE', /instalar-conversor/);
    await rejeita(importarEcm30('<html/>', o(javaFalso({ processo: texto }))), 'E_ECM30_INVALIDO');
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto }), { processId: 'outro' })), 'E_PROCESS_ID', /proc_x/);
    for (const ruim of ['../fora', 'a/b', 'a\\b', 'x:y', 'a|b', '..']) {
      const x2 = xml.replace(/<processId>proc_x<\/processId>/g, `<processId>${ruim}</processId>`);
      await rejeita(importarEcm30(x2, o(javaFalso({ processo: texto }))), 'E_PROCESS_ID', undefined);
    }
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto }), { projeto: 'relativo/x' })), 'E_PROJETO');
    await rejeita(importarEcm30(xml, o(javaFalso({ processo: texto }), { versaoAlvo: '3.0' })), 'E_VERSAO');
    await rejeita(importarEcm30(xml, { ...o(javaFalso({ processo: texto })), plataforma: 'linux' }), 'E_IMPORTADOR_PLATAFORMA');
  } finally {
    limpar(c.cache, projeto);
  }
});

test('ponte adulterada → E_PONTE; os hashes da tabela batem com os arquivos versionados', async () => {
  const c = await cacheFalso();
  const copia = tmp();
  try {
    const { texto, xml } = await par();
    cpSync(DIR_PONTE_IMPORTADOR, copia, { recursive: true });
    writeFileSync(join(copia, 'classes', 'ImportadorBridge.class'), 'adulterado');
    const j = javaFalso({ processo: texto });
    await rejeita(importarEcm30(xml, opcoesBase(c, j.executar, { _dirPonteImportador: copia, _hashesPonteImportador: HASHES_PONTE_IMPORTADOR })), 'E_PONTE', /ImportadorBridge\.class/);
    assert.ok(!j.chamadas.some((x) => x.args.includes('ImportadorBridge')), 'não executa a ponte adulterada');
    // toda fonte .java da pasta está na tabela (nada fica sem conferência)
    const listar = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listar(join(d, e.name)) : [join(d, e.name)]));
    const versionados = listar(DIR_PONTE_IMPORTADOR).map((p) => p.slice(DIR_PONTE_IMPORTADOR.length + 1).split('\\').join('/'));
    assert.deepEqual(versionados.sort(), Object.keys(HASHES_PONTE_IMPORTADOR).sort());
  } finally {
    limpar(c.cache, copia);
  }
});

test('flowImport: exporta pela versão pedida, passa o env como servidor, ganchos só por internos; sem projeto devolve conteúdo', async () => {
  const c = await cacheFalso();
  const projeto = tmp();
  try {
    const { texto, xml } = await par();
    const chamadas = [];
    const cliente = {
      async exportProcessXml(processId, version) {
        chamadas.push([processId, version]);
        return xml;
      },
    };
    const j = javaFalso({ processo: texto });
    const internos = { _tabela: c._tabela, _tabelaImportador: c._tabelaImportador, plataforma: 'darwin', javaImportador: '/falso/x64/bin/java', java: '/falso/bin/java', executar: j.executar };
    const r = await flowImport(cliente, { env: 'teste', processId: 'proc_x', version: 3, versaoAlvo: '1.8.2', projeto, cache: c.cache }, internos);
    assert.deepEqual(chamadas, [['proc_x', 3]]);
    assert.equal(r.ok, true);
    assert.equal(r.version, 3);
    assert.equal(r.process.caminho, join(projeto, 'workflow', 'diagrams', 'proc_x.process'));
    assert.equal(r.process.conteudo, undefined, 'com projeto, sem conteúdo por padrão');
    assert.equal(r.scripts[0].acao, 'criado');
    assert.equal(r.scripts[0].conteudo, undefined);
    const comConteudo = await flowImport(cliente, { env: 'teste', processId: 'proc_x', versaoAlvo: '1.8.2', projeto, cache: c.cache, incluirConteudo: true }, { ...internos, executar: javaFalso({ processo: texto }).executar });
    assert.equal(comConteudo.process.conteudo, texto);
    assert.equal(comConteudo.scripts[0].conteudo, 'function beforeStateEntry(s) {}\n');
    const ponte = j.chamadas.find((x) => x.args.includes('ImportadorBridge'));
    assert.equal(ponte.args[ponte.args.length - 1], 'teste', 'o env vira o serverId');

    const sem = await flowImport(cliente, { env: 'teste', processId: 'proc_x', versaoAlvo: '1.8.2', cache: c.cache }, { ...internos, executar: javaFalso({ processo: texto }).executar });
    assert.equal(sem.version, 'corrente');
    assert.equal(sem.process.conteudo, texto);
    assert.ok(sem.scripts[0].conteudo);

    // ganchos em args (o que a MCP repassa) não valem: sem internos o cache falso não confere e nada roda
    const executarDeArgs = async () => {
      throw new Error('não devia rodar');
    };
    await assert.rejects(flowImport(cliente, { env: 'teste', processId: 'proc_x', versaoAlvo: '1.8.2', cache: c.cache, executar: executarDeArgs, _tabela: c._tabela }));
    await assert.rejects(flowImport(cliente, { env: 'teste', versaoAlvo: '1.8.2' }), /processId/);
  } finally {
    limpar(c.cache, projeto);
  }
});

test('processId com espaço (o Fluig aceita): importa para "<id>.process"', async () => {
  const c = await cacheFalso();
  const projeto = tmp();
  try {
    // o esqueleto do vendor não aceita espaço no id: o par sai como proc_x e o ECM30 ganha o id com espaço
    const { texto, xml: base } = await par();
    const xml = base.replace(/<processId>proc_x<\/processId>/g, '<processId>Emissao cracha</processId>');
    const r = await importarEcm30(xml, opcoesBase(c, javaFalso({ processo: texto, scripts: {} }).executar, { projeto }));
    assert.equal(r.processId, 'Emissao cracha');
    assert.equal(r.process.caminho, join(projeto, 'workflow', 'diagrams', 'Emissao cracha.process'));
    assert.ok(existsSync(join(projeto, 'workflow', '.resources', 'Emissao cracha.ecm30.xml')));
  } finally {
    limpar(c.cache, projeto);
  }
});

test('par de eventos de link (36 → 42): a ligação não precisa de fluxo no .process; o portão final confere o número', async () => {
  const xml = `<list>
  <list>
    <ProcessState><processStatePK><companyId>1</companyId><processId>p</processId><version>1</version><sequence>41</sequence></processStatePK><bpmnType>36</bpmnType></ProcessState>
    <ProcessState><processStatePK><companyId>1</companyId><processId>p</processId><version>1</version><sequence>43</sequence></processStatePK><bpmnType>42</bpmnType></ProcessState>
    <ProcessState><processStatePK><companyId>1</companyId><processId>p</processId><version>1</version><sequence>44</sequence></processStatePK><bpmnType>80</bpmnType></ProcessState>
  </list>
  <list>
    <ProcessLink><processLinkPK><companyId>1</companyId><processId>p</processId><version>1</version><linkSequence>45</linkSequence></processLinkPK><initialStateSequence>41</initialStateSequence><finalStateSequence>43</finalStateSequence></ProcessLink>
    <ProcessLink><processLinkPK><companyId>1</companyId><processId>p</processId><version>1</version><linkSequence>46</linkSequence></processLinkPK><initialStateSequence>43</initialStateSequence><finalStateSequence>44</finalStateSequence></ProcessLink>
  </list>
</list>`;
  assert.deepEqual([...ligacoesDeLink(xml)], [45]);
  assert.doesNotThrow(() => conferirNumerosRegenerados(xml, xml));
  assert.throws(() => conferirNumerosRegenerados(xml, xml.replace('<linkSequence>45</linkSequence>', '<linkSequence>47</linkSequence>')), (e) => e.codigo === 'E_IMPORTADOR_IDS' && /só no servidor: 45/.test(e.message));
  assert.throws(() => conferirNumerosRegenerados(xml, xml.replace('<sequence>44</sequence>', '<sequence>48</sequence>')), (e) => /atividades só no servidor: 44; atividades só no regenerado: 48/.test(e.message));
});

test('raia com o mesmo número de uma atividade: o mapa de ids aponta para a atividade, e a raia não cobre atividade renumerada', async () => {
  const F = carregarFluiggers();
  const { texto: base, xml } = await par();
  const pool = F.editor.createPool(base, { x: 10, y: 10, templateText: F.templateCriacao });
  const lane = F.editor.createSwimLane(pool.text, { poolId: pool.elementId, templateText: F.templateCriacao });
  const comRaia = lane.text.split(lane.elementId).join('bpmnswimlane2');
  assert.equal(conferirImportado(comRaia, xml).atividades[2], 'task2');
  assert.throws(() => conferirImportado(comRaia.replace(/\btask2\b/g, 'task22'), xml), (e) => e.codigo === 'E_IMPORTADOR_IDS' && /Atividades sem id com o número: 2/.test(e.message));
});
