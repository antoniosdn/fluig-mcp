import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compararVersoes,
  versaoServidor,
  criarLookups,
  flowValidate,
  flowGenerate,
  flowRead,
  flowDeploy,
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
test('flowGenerate: devolve XML e não escreve nada', async () => {
  const c = clienteFalso();
  const r = await flowGenerate(c, { spec: SPEC(), versaoAlvo: '2.0' });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.ok(r.xml.startsWith('<list>'));
  assert.equal(quantas(c, 'deployProcess'), 0);
  assert.equal(quantas(c, 'exportProcessXml'), 0);
});

test('flowGenerate: modeloProcessId chama exportProcessXml uma vez', async () => {
  const c = clienteFalso({ xmlExport: fixture('medicao_contrato') });
  const r = await flowGenerate(c, { spec: SPEC(), versaoAlvo: '2.0', modeloProcessId: 'medicao_contrato' });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  assert.equal(quantas(c, 'exportProcessXml'), 1);
  assert.equal(c.chamadas.find((x) => x.fn === 'exportProcessXml').processId, 'medicao_contrato');
});

test('flowGenerate: alvo maior que o servidor é só aviso', async () => {
  const r = await flowGenerate(clienteFalso({ versao: '1.8.2' }), { spec: SPEC(), versaoAlvo: '2.0' });
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
const ENTRADA = (extra = {}) => ({ env: 'teste', spec: SPEC(), versaoAlvo: '2.0', novo: true, confirm: true, ...extra });

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

test('flowDeploy: sucesso publica o mesmo XML do flowGenerate, sem svgXml', async () => {
  const c = clienteFalso();
  const gerado = await flowGenerate(clienteFalso(), { spec: SPEC(), versaoAlvo: '2.0' });
  const r = await flowDeploy(c, ENTRADA({ novo: false }));
  assert.equal(r.publicado, true);
  assert.equal(r.processId, 'proc_teste');
  assert.equal(r.novo, false);
  assert.equal(quantas(c, 'deployProcess'), 1);
  const d = c.chamadas.find((x) => x.fn === 'deployProcess');
  assert.equal(d.xml, gerado.xml);
  assert.equal(d.opcoes.processId, 'proc_teste');
  assert.equal(d.opcoes.isNew, false);
  assert.equal(d.opcoes.confirm, true);
  assert.ok(!('svgXml' in d.opcoes));
  assert.ok(r.semSvg);
});

test('flowDeploy: erro do SOAP sobe', async () => {
  const c = clienteFalso({ falhas: { deploy: new Error('SOAP caiu') } });
  await assert.rejects(() => flowDeploy(c, ENTRADA()), /SOAP caiu/);
});
