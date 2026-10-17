/**
 * Lógica das ferramentas MCP do gerador de fluxo (fluig_flow_validate, _generate, _read, _deploy).
 *
 * Fica fora do server.js porque importar o server.js sobe o servidor stdio; aqui o `client`
 * entra por parâmetro e os testes usam um cliente falso.
 *
 * Só usa chamadas que o client já tem: restGet, searchDataset, exportProcessXml, deployProcess.
 * `fluig_flow_generate` e `fluig_flow_regenerate` só escrevem em disco local, com caminho explícito.
 */
import { validarSpec, conferirNoServidor } from './validar.js';
import { gerarXmlProcesso } from './gerar.js';
import { lerXmlProcesso } from './ler.js';
import { gerarArtefatos, AVISOS_DO_PLANO_B_REDUNDANTES } from './artefatos.js';
import { regenerar } from './regenerar.js';

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

/**
 * Ganchos de teste (Java e tabela de conversor falsos). Vêm só do 3º parâmetro das funções, que o server.js
 * não preenche; nunca de `args`, que a MCP repassa sem filtro.
 */
function ganchos(internos) {
  const i = internos || {};
  return { executar: i.executar, java: i.java, _tabela: i._tabela, _dirPonte: i._dirPonte };
}

const CONVERSORES_ARG = ['auto', 'oficial', 'proprio'];

function conferirConversor(conversor) {
  if (conversor === undefined || conversor === null) return 'auto';
  if (!CONVERSORES_ARG.includes(conversor)) throw new Error(`conversor "${conversor}" inválido; use auto, oficial ou proprio.`);
  return conversor;
}

/** Recorta o resultado de um artefato para a saída da ferramenta. */
function artefatoSaida(a, incluirConteudo) {
  const o = { caminho: a.caminho, bytes: a.bytes, alterado: a.alterado };
  if ('backup' in a) o.backup = a.backup;
  if (incluirConteudo) o.conteudo = a.conteudo;
  return o;
}

/**
 * Gera `.process` + ECM30 + SVG a partir da spec. Só grava em disco com `projeto` (caminho absoluto);
 * nunca escreve no servidor. `modeloProcessId` e `origem` não se aplicam (o ECM30 sai do `.process`).
 */
export async function flowGenerate(client, args, internos = {}) {
  const spec = lerSpec(args.spec);
  const conversor = conferirConversor(args.conversor);
  const avisos = [];
  if (args.modeloProcessId !== undefined && args.modeloProcessId !== null && args.modeloProcessId !== '') {
    avisos.push({ codigo: 'W_MODELO_IGNORADO', mensagem: 'modeloProcessId é ignorado: o ECM30 sai do .process, com categoria, volume e período do esqueleto.', caminho: 'modeloProcessId' });
  }
  if (args.origem !== undefined && args.origem !== null) {
    avisos.push({ codigo: 'W_ORIGEM_IGNORADA', mensagem: 'origem é ignorada: os números saem do .process gerado.', caminho: 'origem' });
  }
  const r = await gerarArtefatos(spec, {
    versaoAlvo: args.versaoAlvo,
    projeto: args.projeto,
    sobrescrever: args.sobrescrever === true,
    conversor,
    lookups: criarLookups(client),
    cache: args.cache,
    ...ganchos(internos),
  });
  avisos.push(...(r.avisos || []));
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
  if (!r.ok) {
    saida.erros = r.erros;
    saida.avisos = avisos;
    return saida;
  }
  const incluir = args.incluirConteudo !== undefined ? args.incluirConteudo === true : !args.projeto;
  saida.conversor = r.conversor;
  saida.ids = r.ids;
  saida.process = artefatoSaida(r.process, incluir);
  saida.ecm30 = artefatoSaida(r.ecm30, incluir);
  saida.svg = artefatoSaida(r.svg, incluir);
  saida.avisos = avisos;
  saida.xml = r.ecm30.conteudo;
  return saida;
}

/** Regenera ECM30 e SVG de um `.process` existente (depois de editá-lo no VS Code). Não toca o servidor. */
export async function flowRegenerate(client, args, internos = {}) {
  const conversor = conferirConversor(args.conversor);
  const r = await regenerar(args.processo, { versao: args.versaoAlvo, conversor, cache: args.cache, ...ganchos(internos) });
  const incluir = args.incluirConteudo === true;
  return {
    ok: true,
    processo: r.processo,
    versaoAlvo: args.versaoAlvo,
    conversor: r.conversor,
    ecm30: artefatoSaida(r.ecm30, incluir),
    svg: artefatoSaida(r.svg, incluir),
    avisos: r.avisos,
  };
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

const BLOQUEIAM = ['W_LOOKUP_FALHOU', 'W_SEM_LOOKUP', 'W_SEM_FORMULARIO'];
const ERROS_BLOQUEIAM = ['E_PAPEL_INEXISTENTE', 'E_CAMPO_INEXISTENTE'];

/** processId do ProcessDefinition (a descrição também aparece em ProcessDefinitionVersionPK/processId). */
function processIdDoEcm30(xml) {
  const m = /<processDefinitionPK>[\s\S]*?<processId>([^<]+)<\/processId>/.exec(xml);
  return m ? m[1] : null;
}

/** Publica uma versão do processo. As travas (prod, confirm, novo, spec/processo) não tocam o cliente. */
export async function flowDeploy(client, args, internos = {}) {
  if (args.env === 'prod' || client.isProd) {
    throw new Error('fluig_flow_deploy não publica em produção nesta versão. Use env="teste".');
  }
  if (args.confirm !== true) {
    throw new Error('fluig_flow_deploy exige confirm=true (publica versão de processo). Rode fluig_flow_validate antes.');
  }
  if (typeof args.novo !== 'boolean') {
    throw new Error('Informe novo=true (processo novo) ou novo=false (nova versão de processo existente).');
  }
  const temSpec = args.spec !== undefined && args.spec !== null;
  const temProcesso = args.processo !== undefined && args.processo !== null && args.processo !== '';
  if (temSpec === temProcesso) {
    throw new Error('Informe exatamente uma entrada: spec (gera o .process num temporário) ou processo (caminho de <projeto>/workflow/diagrams/<x>.process).');
  }
  const conversor = conferirConversor(args.conversor);
  const spec = temSpec ? lerSpec(args.spec) : null;

  let sv;
  try {
    sv = await versaoServidor(client);
  } catch (e) {
    throw new Error(`Versão do servidor não conferida; publicação recusada: ${msg(e)}`);
  }
  if (compararVersoes(args.versaoAlvo, sv) > 0) {
    throw new Error(`versaoAlvo ${args.versaoAlvo} é maior que a versão do servidor (${sv}); publicação recusada.`);
  }

  let ecm30;
  let svg;
  let processId;
  let info;
  let avisos;
  if (spec) {
    const r = await gerarArtefatos(spec, { versaoAlvo: args.versaoAlvo, conversor, lookups: criarLookups(client), cache: args.cache, ...ganchos(internos) });
    if (!r.ok) return { publicado: false, motivo: 'spec com erro', erros: r.erros, avisos: r.avisos };
    avisos = r.avisos || [];
    if (avisos.some((a) => BLOQUEIAM.includes(a.codigo))) {
      return { publicado: false, motivo: 'papel ou campo não conferido no servidor', avisos };
    }
    ecm30 = r.ecm30.conteudo;
    svg = r.svg.conteudo;
    processId = spec.processId;
    info = r.conversor;
  } else {
    const r = await regenerar(args.processo, { versao: args.versaoAlvo, conversor, cache: args.cache, ...ganchos(internos) });
    avisos = r.avisos.filter((a) => !AVISOS_DO_PLANO_B_REDUNDANTES.includes(a.codigo));
    ecm30 = r.ecm30.conteudo;
    svg = r.svg.conteudo;
    info = r.conversor;
    processId = processIdDoEcm30(ecm30);
    if (!processId) throw new Error('Não foi possível ler o processId do ECM30 gerado a partir do .process.');
    // confere papéis e campos no servidor com a spec lida do ECM30 (o que está fora da v1 vira aviso)
    const lida = lerXmlProcesso(ecm30);
    for (const a of lida.avisos) avisos.push({ codigo: a.codigo, mensagem: a.mensagem, caminho: a.ref });
    const conf = await conferirNoServidor(lida.spec, criarLookups(client));
    const bloqueiam = [...conf.erros, ...conf.avisos].filter((x) => ERROS_BLOQUEIAM.includes(x.codigo) || BLOQUEIAM.includes(x.codigo));
    // só informativo: tudo que o validarSpec acusa na spec lida vira aviso e não bloqueia
    const v = await validarSpec(lida.spec, { versaoAlvo: args.versaoAlvo, lookups: {} });
    for (const x of [...v.erros, ...v.avisos]) {
      if (x.codigo === 'W_SEM_LOOKUP' || x.codigo === 'W_SEM_FORMULARIO') continue; // da conferência no servidor
      avisos.push(x);
    }
    if (bloqueiam.length > 0) {
      return { publicado: false, motivo: 'papel ou campo não conferido no servidor', erros: conf.erros, avisos: [...avisos, ...conf.avisos] };
    }
  }

  const d = await client.deployProcess(ecm30, {
    processId,
    isNew: args.novo,
    overWrite: true,
    confirm: true,
    svgXml: svg,
  });
  return {
    publicado: true,
    processId,
    novo: args.novo,
    versaoAlvo: args.versaoAlvo,
    versaoServidor: sv,
    conversor: info,
    imported: d && d.imported,
    released: d && d.released,
    avisos,
  };
}
