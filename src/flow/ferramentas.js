/**
 * Lógica das ferramentas MCP do gerador de fluxo (fluig_flow_validate, _generate, _read, _deploy).
 *
 * Fica fora do server.js porque importar o server.js sobe o servidor stdio; aqui o `client`
 * entra por parâmetro e os testes usam um cliente falso.
 *
 * Só usa chamadas que o client já tem: restGet, searchDataset, exportProcessXml, deployProcess.
 */
import { validarSpec } from './validar.js';
import { gerarXmlProcesso } from './gerar.js';
import { lerXmlProcesso } from './ler.js';

const msg = (e) => (e && e.message ? e.message : String(e));

/**
 * Compara duas versões "x.y.z". Completa com zeros ("2.0" == "2.0.0").
 * @returns {-1|0|1}
 */
export function compararVersoes(a, b) {
  const partes = (v) =>
    String(v)
      .trim()
      .split('.')
      .map((p) => {
        if (!/^\d+$/.test(p)) throw new Error(`versão inválida: "${v}"`);
        return parseInt(p, 10);
      });
  const pa = partes(a);
  const pb = partes(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Lê a versão do Fluig. Lança Error se a resposta não for legível. */
export async function versaoServidor(client) {
  const r = await client.restGet('/ecm/api/rest/ecm/studioWorkflowRest/version');
  let v = r;
  if (r && typeof r === 'object' && typeof r.content === 'string') v = r.content;
  if (typeof v !== 'string' || !/^\d+(\.\d+)*$/.test(v.trim())) {
    const bruto = typeof v === 'string' ? v : JSON.stringify(r);
    throw new Error(`versão do servidor ilegível: ${String(bruto).slice(0, 120)}`);
  }
  return v.trim();
}

/** Lookups do validador, só leitura. */
export function criarLookups(client) {
  let papeis = null; // promessa guardada: a lista é buscada uma vez
  const buscarPapeis = async () => {
    const r = await client.searchDataset('workflowRole', { fields: ['workflowRolePK.roleId'] });
    const colunas = r.columns || [];
    const idx = colunas.indexOf('workflowRolePK.roleId');
    const set = new Set();
    for (const linha of r.values || []) {
      let v;
      if (Array.isArray(linha)) v = idx >= 0 ? linha[idx] : linha[0];
      else if (linha && typeof linha === 'object') v = linha['workflowRolePK.roleId'] !== undefined ? linha['workflowRolePK.roleId'] : linha.roleId;
      if (v !== undefined && v !== null) set.add(String(v));
    }
    return set;
  };
  return {
    async papelExiste(papel) {
      if (!papeis) papeis = buscarPapeis();
      try {
        return (await papeis).has(papel);
      } catch (e) {
        papeis = null; // não guarda falha
        throw e;
      }
    },
    async camposFormulario(formId) {
      const r = await client.restGet(`/ecm/api/rest/ecm/processform/listFields/${formId}/1`);
      if (r && r._raw !== undefined) throw new Error('listFields devolveu resposta não-JSON');
      const campos = r && r.content && Array.isArray(r.content.processFormFields)
        ? r.content.processFormFields
        : r && Array.isArray(r.processFormFields)
          ? r.processFormFields
          : null;
      if (!campos) throw new Error('listFields não devolveu a lista de campos');
      return campos;
    },
  };
}

/** A spec pode chegar como objeto ou como texto JSON. */
function lerSpec(spec) {
  if (typeof spec !== 'string') return spec;
  try {
    return JSON.parse(spec);
  } catch (e) {
    throw new Error(`spec não é JSON válido: ${msg(e)}`);
  }
}

async function lerModelo(client, modeloProcessId) {
  if (modeloProcessId === undefined || modeloProcessId === null || modeloProcessId === '') return undefined;
  try {
    return await client.exportProcessXml(modeloProcessId);
  } catch (e) {
    throw new Error(`Não foi possível ler o processo-modelo ${modeloProcessId}: ${msg(e)}`);
  }
}

/** Versão do servidor sem lançar: { versao } ou { falha }. */
async function tentarVersao(client) {
  try {
    return { versao: await versaoServidor(client) };
  } catch (e) {
    return { falha: msg(e) };
  }
}

function maiorQueServidor(versaoAlvo, versao) {
  try {
    return compararVersoes(versaoAlvo, versao) > 0;
  } catch (e) {
    return false;
  }
}

/** Valida a spec sem gerar nem gravar nada. */
export async function flowValidate(client, args) {
  const spec = lerSpec(args.spec);
  const { versaoAlvo } = args;
  const r = await validarSpec(spec, { versaoAlvo, lookups: criarLookups(client) });
  const erros = [...r.erros];
  const avisos = [...r.avisos];
  const sv = await tentarVersao(client);
  if (sv.falha) {
    avisos.push({ codigo: 'W_VERSAO_SERVIDOR', mensagem: `Versão do servidor não conferida: ${sv.falha}`, caminho: 'versaoAlvo' });
  } else if (maiorQueServidor(versaoAlvo, sv.versao)) {
    erros.push({
      codigo: 'E_VERSAO_SERVIDOR',
      mensagem: `versaoAlvo ${versaoAlvo} é maior que a versão do servidor (${sv.versao}); o servidor não aceitaria recursos 2.0.`,
      caminho: 'versaoAlvo',
    });
  }
  return { ok: erros.length === 0, versaoAlvo, versaoServidor: sv.versao || null, erros, avisos };
}

/** Gera o XML (e a versão do servidor como aviso). Compartilhado com o deploy. */
async function gerar(client, args, spec) {
  const modelo = await lerModelo(client, args.modeloProcessId);
  const r = await gerarXmlProcesso(spec, {
    versaoAlvo: args.versaoAlvo,
    lookups: criarLookups(client),
    modelo,
    origem: args.origem,
  });
  return r;
}

/** Gera o XML ECM30 a partir da spec. Não grava nada. */
export async function flowGenerate(client, args) {
  const spec = lerSpec(args.spec);
  const r = await gerar(client, args, spec);
  const avisos = [...(r.avisos || [])];
  const sv = await tentarVersao(client);
  if (sv.falha) {
    avisos.push({ codigo: 'W_VERSAO_SERVIDOR', mensagem: `Versão do servidor não conferida: ${sv.falha}`, caminho: 'versaoAlvo' });
  } else if (maiorQueServidor(args.versaoAlvo, sv.versao)) {
    avisos.push({
      codigo: 'W_VERSAO_SERVIDOR',
      mensagem: `versaoAlvo ${args.versaoAlvo} é maior que a versão do servidor (${sv.versao}); publicar nesse servidor seria recusado.`,
      caminho: 'versaoAlvo',
    });
  }
  const saida = { ok: r.ok, versaoAlvo: args.versaoAlvo, versaoServidor: sv.versao || null };
  if (r.erros) saida.erros = r.erros;
  saida.avisos = avisos;
  if (r.xml !== undefined) saida.xml = r.xml;
  if (r.sequencias !== undefined) saida.sequencias = r.sequencias;
  return saida;
}

/** Exporta um processo e devolve a spec v1 equivalente. */
export async function flowRead(client, args) {
  const { processId, version } = args;
  const xml = await client.exportProcessXml(processId, version);
  const r = lerXmlProcesso(xml);
  return {
    processId,
    version: version !== undefined && version !== null ? version : 'corrente',
    spec: r.spec,
    origem: r.origem,
    ignorados: r.ignorados,
    avisos: r.avisos,
  };
}

/** Publica uma versão do processo. As três primeiras travas não tocam o cliente. */
export async function flowDeploy(client, args) {
  if (args.env === 'prod' || client.isProd) {
    throw new Error('fluig_flow_deploy não publica em produção nesta versão. Use env="teste".');
  }
  if (args.confirm !== true) {
    throw new Error('fluig_flow_deploy exige confirm=true (publica versão de processo). Rode fluig_flow_validate antes.');
  }
  if (typeof args.novo !== 'boolean') {
    throw new Error('Informe novo=true (processo novo) ou novo=false (nova versão de processo existente).');
  }
  const spec = lerSpec(args.spec);

  let sv;
  try {
    sv = await versaoServidor(client);
  } catch (e) {
    throw new Error(`Versão do servidor não conferida; publicação recusada: ${msg(e)}`);
  }
  if (compararVersoes(args.versaoAlvo, sv) > 0) {
    throw new Error(`versaoAlvo ${args.versaoAlvo} é maior que a versão do servidor (${sv}); publicação recusada.`);
  }

  const r = await gerar(client, args, spec);
  if (!r.ok) return { publicado: false, motivo: 'spec com erro', erros: r.erros, avisos: r.avisos };
  const avisos = r.avisos || [];
  if (avisos.some((a) => a.codigo === 'W_LOOKUP_FALHOU' || a.codigo === 'W_SEM_LOOKUP' || a.codigo === 'W_SEM_FORMULARIO')) {
    return { publicado: false, motivo: 'papel ou campo não conferido no servidor', avisos };
  }

  const d = await client.deployProcess(r.xml, {
    processId: spec.processId,
    isNew: args.novo,
    overWrite: true,
    confirm: true,
  });
  return {
    publicado: true,
    processId: spec.processId,
    novo: args.novo,
    versaoAlvo: args.versaoAlvo,
    versaoServidor: sv,
    imported: d && d.imported,
    released: d && d.released,
    avisos,
    semSvg: 'Publicado sem SVG: o processo roda, mas a tela de acompanhamento fica sem desenho (passo 0, §5 de fluxo-tipos.md).',
  };
}
