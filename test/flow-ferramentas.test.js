import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gerarArtefatos } from '../src/flow/artefatos.js';
import { instalarConversor } from '../src/flow/conversor.js';
import { pastaPlugins, tabelaFalsa } from './_conversor-falso.js';
import {
  compararVersoes,
  versaoServidor,
  criarLookups,
  flowValidate,
  flowGenerate,
  flowRead,
  flowDeploy,
  flowRegenerate,
} from '../src/flow/ferramentas.js';

const fixture = (nome) => readFileSync(new URL(`./fixtures/flow/${nome}.ecm30.xml`, import.meta.url), 'utf8');
const clone = (o) => JSON.parse(JSON.stringify(o));
const codigos = (itens) => itens.map((i) => i.codigo);

/** Spec base: inicio -> humana (papel) -> gateway com regra em campo -> fim / cancelamento. */
const SPEC = () => ({
  processId: 'proc_teste',
  descricao: 'Processo de teste',
  formId: 42,
  atividades: [
    { id: 'ini', tipo: 'inicio', nome: 'Início' },
    { id: 'hum', tipo: 'humana', nome: 'Analisar', responsavel: { tipo: 'papel', valor: 'gestor' } },
    { id: 'gw', tipo: 'gateway_exclusivo', nome: 'Aprovado?' },
    { id: 'fim', tipo: 'fim', nome: 'Concluído' },
    { id: 'canc', tipo: 'cancelamento', nome: 'Cancelado' },
  ],
  ligacoes: [
    { de: 'ini', para: 'hum' },
    { de: 'hum', para: 'gw' },
    { de: 'gw', para: 'fim', ordem: 1, condicao: { regras: [{ campo: 'aprovado', op: 'igual', valor: 'sim' }] } },
    { de: 'gw', para: 'canc', padrao: true },
  ],
});

/**
 * Cliente falso: registra cada chamada em `chamadas`.
 * falhas: { versao, papeis, campos, modelo, deploy } -> Error a lançar naquela chamada.
 */
function clienteFalso({ versao = '2.0.0', papeis = ['gestor'], campos = ['aprovado', 'valor'], xmlExport = '', falhas = {}, isProd = false, respostaVersao } = {}) {
  const chamadas = [];
  return {
    isProd,
    chamadas,
    async restGet(path) {
      chamadas.push({ fn: 'restGet', path });
      if (path.endsWith('/studioWorkflowRest/version')) {
        if (falhas.versao) throw falhas.versao;
        return respostaVersao !== undefined ? respostaVersao : versao;
      }
      if (path.includes('/processform/listFields/')) {
        if (falhas.campos) throw falhas.campos;
        return { content: { processFormId: 42, processFormFields: campos } };
      }
      throw new Error(`restGet inesperado: ${path}`);
    },
    async searchDataset(id, opcoes) {
      chamadas.push({ fn: 'searchDataset', id, opcoes });
      if (falhas.papeis) throw falhas.papeis;
      return { columns: ['workflowRolePK.roleId'], values: papeis.map((p) => ({ 'workflowRolePK.roleId': p })) };
    },
    async exportProcessXml(processId, version) {
      chamadas.push({ fn: 'exportProcessXml', processId, version });
      if (falhas.modelo) throw falhas.modelo;
      return xmlExport;
    },
    async deployProcess(xml, opcoes) {
      chamadas.push({ fn: 'deployProcess', xml, opcoes });
      if (falhas.deploy) throw falhas.deploy;
      return { processId: opcoes.processId, imported: 'ok', released: 'ok' };
    },
  };
}

const quantas = (c, fn) => c.chamadas.filter((x) => x.fn === fn).length;

/* 1 */
test('compararVersoes', () => {
  assert.equal(compararVersoes('2.0', '2.0.0'), 0);
  assert.equal(compararVersoes('1.8.2', '2.0'), -1);
  assert.equal(compararVersoes('1.8.2.3', '1.8.2'), 1);
  assert.throws(() => compararVersoes('2.x', '2.0'), /versão inválida/);
});

/* 2 */
test('versaoServidor: string, {content} e resposta não legível', async () => {
  assert.equal(await versaoServidor(clienteFalso({ versao: '2.0.0' })), '2.0.0');
  assert.equal(await versaoServidor(clienteFalso({ respostaVersao: { content: ' 1.8.2 ' } })), '1.8.2');
  await assert.rejects(() => versaoServidor(clienteFalso({ respostaVersao: { _raw: '<html>' } })), /ilegível/);
});

/* 3 */
test('criarLookups: papéis buscados uma vez; listFields no caminho exato; resposta sem array lança', async () => {
  const c = clienteFalso({ papeis: ['gestor', 'compras'] });
  const l = criarLookups(c);
  assert.equal(await l.papelExiste('gestor'), true);
  assert.equal(await l.papelExiste('compras'), true);
  assert.equal(await l.papelExiste('outro'), false);
  assert.equal(quantas(c, 'searchDataset'), 1);
  assert.deepEqual(c.chamadas[0].opcoes.fields, ['workflowRolePK.roleId']);

  assert.deepEqual(await l.camposFormulario(42), ['aprovado', 'valor']);
  assert.ok(c.chamadas.some((x) => x.path === '/ecm/api/rest/ecm/processform/listFields/42/1'));

  const ruim = { restGet: async () => ({ content: {} }) };
  await assert.rejects(() => criarLookups(ruim).camposFormulario(42), /lista de campos/);
});

/* 4 */
test('flowValidate: spec boa', async () => {
  const r = await flowValidate(clienteFalso(), { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(r.versaoServidor, '2.0.0');
  assert.deepEqual(r.erros, []);
});

test('flowValidate: papel inexistente e campo inexistente', async () => {
  const r1 = await flowValidate(clienteFalso({ papeis: ['outro'] }), { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r1.ok, false);
  assert.ok(codigos(r1.erros).includes('E_PAPEL_INEXISTENTE'));
  const r2 = await flowValidate(clienteFalso({ campos: ['outro'] }), { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r2.ok, false);
  assert.ok(codigos(r2.erros).includes('E_CAMPO_INEXISTENTE'));
});

test('flowValidate: alvo 2.0 com servidor 1.8.2 vira E_VERSAO_SERVIDOR', async () => {
  const r = await flowValidate(clienteFalso({ versao: '1.8.2' }), { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r.ok, false);
  assert.ok(codigos(r.erros).includes('E_VERSAO_SERVIDOR'));
  assert.equal(r.versaoServidor, '1.8.2');
});

test('flowValidate: versão ilegível vira aviso e ok é mantido', async () => {
  const r = await flowValidate(clienteFalso({ respostaVersao: { _raw: 'x' } }), { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r.ok, true);
  assert.equal(r.versaoServidor, null);
  assert.ok(codigos(r.avisos).includes('W_VERSAO_SERVIDOR'));
});

test('flowValidate: spec como texto JSON; texto inválido lança', async () => {
  const r = await flowValidate(clienteFalso(), { spec: JSON.stringify(SPEC()), versaoAlvo: '2.0' });
  assert.equal(r.ok, true);
  await assert.rejects(() => flowValidate(clienteFalso(), { spec: '{nao e json', versaoAlvo: '2.0' }), /spec não é JSON válido/);
});

/* 5 */
// conversor 'proprio' + cache vazio: os testes não dependem do Studio instalado na máquina
// cache vazio único do arquivo (plano B sem Studio), removido no fim
const CACHE_VAZIO = mkdtempSync(join(tmpdir(), 'cache-vazio-'));
after(() => rmSync(CACHE_VAZIO, { recursive: true, force: true }));
const GEN = (extra = {}) => ({ spec: SPEC(), versaoAlvo: '2.0', conversor: 'proprio', cache: CACHE_VAZIO, ...extra });

test('flowGenerate: devolve process, ecm30 e svg com conteúdo, xml = ECM30, e não grava nem publica', async () => {
  const c = clienteFalso();
  const r = await flowGenerate(c, GEN());
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.ok(r.xml.startsWith('<list>'));
  assert.equal(r.xml, r.ecm30.conteudo);
  assert.match(r.process.conteudo, /^<\?xml/);
  assert.match(r.svg.conteudo, /<svg/);
  assert.equal(r.process.caminho, null);
  assert.equal(r.conversor.tipo, 'proprio');
  assert.ok(codigos(r.avisos).includes('W_ECM30_NAO_OFICIAL'));
  assert.equal(quantas(c, 'deployProcess'), 0);
  assert.equal(quantas(c, 'exportProcessXml'), 0);
});

test('flowGenerate: com projeto grava os três e não devolve conteúdo por padrão', async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'proj-gen-'));
  try {
    const r = await flowGenerate(clienteFalso(), GEN({ projeto }));
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.equal(r.process.conteudo, undefined);
    assert.equal(r.ecm30.conteudo, undefined);
    assert.ok(r.xml);
    assert.ok(existsSync(r.process.caminho));
    assert.ok(existsSync(r.ecm30.caminho));
    assert.ok(existsSync(r.svg.caminho));
    const com = await flowGenerate(clienteFalso(), GEN({ projeto, incluirConteudo: true }));
    assert.equal(com.process.conteudo, readFileSync(com.process.caminho, 'utf8'));
    assert.equal(com.process.alterado, false);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test('flowGenerate: modeloProcessId e origem são ignorados com aviso, sem ler o servidor', async () => {
  const c = clienteFalso({ xmlExport: fixture('medicao_contrato') });
  const r = await flowGenerate(c, GEN({ modeloProcessId: 'medicao_contrato', origem: { sequencias: {} } }));
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(quantas(c, 'exportProcessXml'), 0);
  assert.ok(codigos(r.avisos).includes('W_MODELO_IGNORADO'));
  assert.ok(codigos(r.avisos).includes('W_ORIGEM_IGNORADA'));
});

test('flowGenerate: spec com erro devolve ok:false sem arquivos', async () => {
  const spec = SPEC();
  spec.ligacoes.push({ de: 'fim', para: 'hum' });
  const r = await flowGenerate(clienteFalso(), GEN({ spec }));
  assert.equal(r.ok, false);
  assert.ok(r.erros.length > 0);
  assert.equal(r.process, undefined);
});

test('flowGenerate: alvo maior que o servidor é só aviso', async () => {
  const r = await flowGenerate(clienteFalso({ versao: '1.8.2' }), GEN());
  assert.equal(r.ok, true);
  assert.ok(r.xml);
  assert.ok(codigos(r.avisos).includes('W_VERSAO_SERVIDOR'));
});

/* 6 */
test('flowRead: devolve spec, origem e ignorados; repassa version', async () => {
  const c = clienteFalso({ xmlExport: fixture('medicao_contrato') });
  const r = await flowRead(c, { processId: 'medicao_contrato', version: 3 });
  assert.ok(r.spec.processId);
  assert.ok(r.origem && typeof r.origem === 'object');
  assert.ok(Array.isArray(r.ignorados));
  assert.ok(Array.isArray(r.avisos));
  assert.equal(r.version, 3);
  const ex = c.chamadas.find((x) => x.fn === 'exportProcessXml');
  assert.equal(ex.version, 3);
  assert.equal((await flowRead(c, { processId: 'medicao_contrato' })).version, 'corrente');
});

/* 7 */
const ENTRADA = (extra = {}) => ({ env: 'teste', spec: SPEC(), versaoAlvo: '2.0', novo: true, confirm: true, conversor: 'proprio', cache: CACHE_VAZIO, ...extra });

test('flowDeploy: env prod ou client.isProd lança sem tocar o cliente', async () => {
  const c = clienteFalso();
  await assert.rejects(() => flowDeploy(c, ENTRADA({ env: 'prod' })), /não publica em produção/);
  assert.equal(c.chamadas.length, 0);
  const cp = clienteFalso({ isProd: true });
  await assert.rejects(() => flowDeploy(cp, ENTRADA()), /não publica em produção/);
  assert.equal(cp.chamadas.length, 0);
});

test('flowDeploy: sem confirm ou sem novo lança sem tocar o cliente', async () => {
  const c = clienteFalso();
  await assert.rejects(() => flowDeploy(c, ENTRADA({ confirm: undefined })), /confirm=true/);
  await assert.rejects(() => flowDeploy(c, ENTRADA({ confirm: 'true' })), /confirm=true/);
  await assert.rejects(() => flowDeploy(c, ENTRADA({ novo: undefined })), /novo=true/);
  assert.equal(c.chamadas.length, 0);
});

test('flowDeploy: servidor 1.8.2 com alvo 2.0 lança, sem deployProcess', async () => {
  const c = clienteFalso({ versao: '1.8.2' });
  await assert.rejects(() => flowDeploy(c, ENTRADA()), /maior que a versão do servidor/);
  assert.equal(quantas(c, 'deployProcess'), 0);
});

test('flowDeploy: versão ilegível lança, sem deployProcess', async () => {
  const c = clienteFalso({ respostaVersao: { _raw: 'x' } });
  await assert.rejects(() => flowDeploy(c, ENTRADA()), /publicação recusada/);
  assert.equal(quantas(c, 'deployProcess'), 0);
});

test('flowDeploy: spec com erro devolve publicado:false com erros', async () => {
  const spec = SPEC();
  spec.ligacoes.push({ de: 'fim', para: 'hum' });
  const c = clienteFalso();
  const r = await flowDeploy(c, ENTRADA({ spec }));
  assert.equal(r.publicado, false);
  assert.equal(r.motivo, 'spec com erro');
  assert.ok(r.erros.length > 0);
  assert.equal(quantas(c, 'deployProcess'), 0);
});

test('flowDeploy: falha no lookup de papel devolve publicado:false', async () => {
  const c = clienteFalso({ falhas: { papeis: new Error('dataset inexistente') } });
  const r = await flowDeploy(c, ENTRADA());
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /não conferido/);
  assert.ok(codigos(r.avisos).includes('W_LOOKUP_FALHOU'));
  assert.equal(quantas(c, 'deployProcess'), 0);
});

test('flowDeploy: spec sem formId com condição em campo devolve publicado:false', async () => {
  const spec = SPEC();
  delete spec.formId;
  const c = clienteFalso();
  const r = await flowDeploy(c, ENTRADA({ spec }));
  assert.equal(r.publicado, false);
  assert.match(r.motivo, /não conferido/);
  assert.ok(codigos(r.avisos).includes('W_SEM_FORMULARIO'));
  assert.equal(quantas(c, 'deployProcess'), 0);
});

test('flowDeploy: nenhuma entrada ou as duas lançam sem tocar o cliente', async () => {
  const c = clienteFalso();
  await assert.rejects(() => flowDeploy(c, ENTRADA({ spec: undefined })), /exatamente uma entrada/);
  await assert.rejects(() => flowDeploy(c, ENTRADA({ processo: '/tmp/x/workflow/diagrams/x.process' })), /exatamente uma entrada/);
  assert.equal(c.chamadas.length, 0);
});

test('flowDeploy: sucesso com spec publica o ECM30 e o SVG do gerarArtefatos', async () => {
  const c = clienteFalso();
  const r = await flowDeploy(c, ENTRADA({ novo: false }));
  assert.equal(r.publicado, true, JSON.stringify(r));
  assert.equal(r.processId, 'proc_teste');
  assert.equal(r.novo, false);
  assert.equal(r.conversor.tipo, 'proprio');
  assert.ok(codigos(r.avisos).includes('W_ECM30_NAO_OFICIAL'));
  assert.equal(quantas(c, 'deployProcess'), 1);
  const d = c.chamadas.find((x) => x.fn === 'deployProcess');
  const gerado = await gerarArtefatos(SPEC(), { versaoAlvo: '2.0', conversor: 'proprio', cache: CACHE_VAZIO });
  assert.equal(d.xml, gerado.ecm30.conteudo);
  assert.match(d.opcoes.svgXml, /^\s*(<\?xml[^>]*\?>\s*)?<svg/);
  assert.equal(d.opcoes.svgXml, gerado.svg.conteudo);
  assert.equal(d.opcoes.processId, 'proc_teste');
  assert.equal(d.opcoes.isNew, false);
  assert.equal(d.opcoes.confirm, true);
  assert.ok(!('semSvg' in r));
});

test('flowDeploy: sucesso com processo (projeto montado pelo gerarArtefatos) publica o mesmo ECM30 e SVG', async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'proj-deploy-'));
  try {
    const cache = CACHE_VAZIO;
    const g = await gerarArtefatos(SPEC(), { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    const c = clienteFalso();
    const r = await flowDeploy(c, ENTRADA({ spec: undefined, processo: g.process.caminho, cache }));
    assert.equal(r.publicado, true, JSON.stringify(r));
    assert.equal(r.processId, 'proc_teste');
    const d = c.chamadas.find((x) => x.fn === 'deployProcess');
    assert.equal(d.xml, g.ecm30.conteudo);
    assert.equal(d.opcoes.svgXml, g.svg.conteudo);
    assert.equal(d.opcoes.processId, 'proc_teste');
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test('flowDeploy: com processo, papel inexistente bloqueia', async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'proj-deploy-'));
  try {
    const cache = CACHE_VAZIO;
    const g = await gerarArtefatos(SPEC(), { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    const c = clienteFalso({ papeis: ['outro'] });
    const r = await flowDeploy(c, ENTRADA({ spec: undefined, processo: g.process.caminho, cache }));
    assert.equal(r.publicado, false);
    assert.equal(quantas(c, 'deployProcess'), 0);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test('flowRegenerate: devolve caminhos e alterado; segunda vez sem mudança', async () => {
  const projeto = mkdtempSync(join(tmpdir(), 'proj-regen-'));
  try {
    const cache = CACHE_VAZIO;
    const g = await gerarArtefatos(SPEC(), { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache });
    const r = await flowRegenerate(clienteFalso(), { processo: g.process.caminho, versaoAlvo: '2.0', conversor: 'proprio', cache });
    assert.equal(r.ok, true);
    assert.equal(r.ecm30.caminho, g.ecm30.caminho);
    assert.equal(r.ecm30.alterado, false);
    assert.equal(r.svg.alterado, false);
    assert.equal(r.ecm30.conteudo, undefined);
    const com = await flowRegenerate(clienteFalso(), { processo: g.process.caminho, versaoAlvo: '2.0', conversor: 'proprio', cache, incluirConteudo: true });
    assert.equal(com.ecm30.conteudo, g.ecm30.conteudo);
  } finally {
    rmSync(projeto, { recursive: true, force: true });
  }
});

test('flowDeploy: erro do SOAP sobe', async () => {
  const c = clienteFalso({ falhas: { deploy: new Error('SOAP caiu') } });
  await assert.rejects(() => flowDeploy(c, ENTRADA()), /SOAP caiu/);
});

/* Deploy com processo que tem elemento fora da v1 (conversor oficial falso devolve um ECM30 com um timer) */
async function cenarioForaDaV1() {
  const raiz = mkdtempSync(join(tmpdir(), 'fora-v1-'));
  const cache = join(raiz, 'cache');
  const fonte = join(raiz, 'fonte');
  const projeto = join(raiz, 'projeto');
  mkdirSync(projeto, { recursive: true });
  const t = tabelaFalsa();
  const tabela = { '1.8.2.0': t['9.9.9.9'], '2.0.0.2': t['8.8.8.8'] };
  pastaPlugins(fonte);
  await instalarConversor({ de: fonte, cache, tabela });
  const g = await gerarArtefatos(SPEC(), { versaoAlvo: '2.0', projeto, conversor: 'proprio', cache: CACHE_VAZIO });
  // o fim (bpmnType 60) vira espera/timer (32): fora da v1
  const ecm30 = g.ecm30.conteudo.replace('<bpmnType>60</bpmnType>', '<bpmnType>32</bpmnType>');
  assert.notEqual(ecm30, g.ecm30.conteudo);
  const executar = async (arquivo, args) => {
    if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "21"' };
    writeFileSync(args[args.indexOf('Ecm30Bridge') + 2], ecm30);
    return { stdout: '', stderr: '' };
  };
  return { raiz, cache, tabela, executar, processo: g.process.caminho };
}

test('flowDeploy com processo fora da v1 e papel inexistente → publicado:false, sem deployProcess', async () => {
  const x = await cenarioForaDaV1();
  try {
    const c = clienteFalso({ papeis: ['outro'] });
    const r = await flowDeploy(c, ENTRADA({ spec: undefined, processo: x.processo, conversor: 'oficial', cache: x.cache }), { _tabela: x.tabela, executar: x.executar, java: '/falso/bin/java' });
    assert.equal(r.publicado, false, JSON.stringify(r));
    assert.match(r.motivo, /não conferido/);
    assert.ok(codigos(r.erros).includes('E_PAPEL_INEXISTENTE'));
    assert.equal(quantas(c, 'deployProcess'), 0);
  } finally {
    rmSync(x.raiz, { recursive: true, force: true });
  }
});

test('flowDeploy com processo fora da v1 e papel existente → publica; os achados do validarSpec viram aviso', async () => {
  const x = await cenarioForaDaV1();
  try {
    const c = clienteFalso();
    const r = await flowDeploy(c, ENTRADA({ spec: undefined, processo: x.processo, conversor: 'oficial', cache: x.cache }), { _tabela: x.tabela, executar: x.executar, java: '/falso/bin/java' });
    assert.equal(r.publicado, true, JSON.stringify(r));
    assert.equal(quantas(c, 'deployProcess'), 1);
    assert.ok(r.avisos.length > 0);
  } finally {
    rmSync(x.raiz, { recursive: true, force: true });
  }
});

test('java, _tabela e executar em args são ignorados (só valem em internos)', async () => {
  const x = await cenarioForaDaV1();
  try {
    const chamadas = [];
    const executarDeArgs = async () => {
      chamadas.push('args');
      return { stdout: '', stderr: '' };
    };
    const c = clienteFalso();
    // tabela falsa só em args: a embutida vale, e o cache falso não confere com ela
    await assert.rejects(
      () => flowDeploy(c, ENTRADA({ spec: undefined, processo: x.processo, conversor: 'oficial', cache: x.cache, _tabela: x.tabela, executar: executarDeArgs, java: '/arbitrario/java' })),
      (e) => typeof e.codigo === 'string' && /^E_/.test(e.codigo)
    );
    assert.deepEqual(chamadas, [], 'o executar de args não pode ser chamado');
    assert.equal(quantas(c, 'deployProcess'), 0);
    // mesma coisa em flowRegenerate
    await assert.rejects(() => flowRegenerate(c, { processo: x.processo, versaoAlvo: '2.0', conversor: 'oficial', cache: x.cache, _tabela: x.tabela, executar: executarDeArgs, java: '/arbitrario/java' }));
    assert.deepEqual(chamadas, []);
    // e com internos corretos o mesmo cenário funciona
    const ok = await flowRegenerate(c, { processo: x.processo, versaoAlvo: '2.0', conversor: 'oficial', cache: x.cache }, { _tabela: x.tabela, executar: x.executar, java: '/falso/bin/java' });
    assert.equal(ok.conversor.tipo, 'oficial');
  } finally {
    rmSync(x.raiz, { recursive: true, force: true });
  }
});
