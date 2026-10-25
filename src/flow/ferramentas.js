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
import { importarEcm30 } from './importar.js';
import { readFile } from 'node:fs/promises';
import { lerDefinicao, aplicarDefinicao, aplicarSlots } from './definicao.js';
import { carregarFluiggers } from './fluiggers.js';

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
  else if (r && typeof r === 'object' && typeof r._raw === 'string' && r._blocked !== true && (r._status === undefined || r._status === 200)) v = r._raw;
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
  // spec é só para processo novo: um processo que já existe no servidor sairia renumerado
  try {
    const existente = spec && spec.processId ? await client.exportProcessXml(spec.processId) : null;
    if (typeof existente === 'string' && existente.includes('<ProcessDefinition>')) {
      avisos.push({
        codigo: 'W_PROCESSO_EXISTENTE',
        mensagem: `O processo ${spec.processId} já existe no servidor. A spec é só para processo novo: o .process gerado tem as atividades renumeradas e o fluig_flow_deploy recusa spec com novo=false. Para nova versão, use fluig_flow_import.`,
        caminho: 'processId',
      });
    }
  } catch {
    /* processo inexistente ou servidor indisponível: nada a avisar */
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
  saida.scripts = r.scripts;
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

/**
 * Importa um processo do servidor como o Studio faz (ids = números do servidor). Lê o ECM30 e grava só em
 * disco local, com `projeto`; sem ele, devolve o conteúdo. Ganchos de teste só por `internos`.
 */
export async function flowImport(client, args, internos = {}) {
  const { processId, version } = args;
  if (!processId) throw new Error('Informe processId.');
  const xml = await client.exportProcessXml(processId, version);
  const i = internos || {};
  const r = await importarEcm30(xml, {
    processId,
    versaoAlvo: args.versaoAlvo,
    projeto: args.projeto,
    sobrescrever: args.sobrescrever === true,
    servidor: args.env || 'fluig-mcp',
    cache: args.cache,
    executar: i.executar,
    java: i.java,
    javaImportador: i.javaImportador,
    plataforma: i.plataforma,
    _tabela: i._tabela,
    _tabelaImportador: i._tabelaImportador,
    _dirPonte: i._dirPonte,
    _dirPonteImportador: i._dirPonteImportador,
    _hashesPonteImportador: i._hashesPonteImportador,
  });
  const incluir = args.incluirConteudo === true || !args.projeto;
  const semConteudo = (s) => (incluir ? s : Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'conteudo')));
  const arquivo = (a) => {
    const o = { caminho: a.caminho, bytes: a.bytes };
    if ('alterado' in a) o.alterado = a.alterado;
    if (a.backup) o.backup = a.backup;
    if (incluir) o.conteudo = a.conteudo;
    return o;
  };
  return {
    ok: true,
    processId,
    version: version !== undefined && version !== null ? version : 'corrente',
    versaoAlvo: args.versaoAlvo,
    versaoStudio: r.versaoStudio,
    ids: r.ids,
    formId: r.formId,
    process: arquivo(r.process),
    scripts: r.scripts.map(semConteudo),
    literais: r.literais.map(semConteudo),
    ecm30: arquivo(r.ecm30),
    svg: arquivo(r.svg),
    conversor: r.conversor,
    java: r.java,
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

/** Processo existente com categoria no servidor: o ECM30 gerado tem que mantê-la. Devolve a recusa ou null. */
function recusaCategoria(noServidor, noEcm30, { conversor, avisos, dica }) {
  if (noServidor === '' || noEcm30 === noServidor) return null;
  const mensagem = `Publicar mudaria a categoria de "${noServidor}" para "${noEcm30}"; processo existente mantém a categoria. ${dica}`;
  return {
    publicado: false,
    motivo: 'a publicação trocaria a categoria do processo',
    categoriaServidor: noServidor,
    categoriaGerada: noEcm30,
    conversor,
    erros: [{ codigo: 'E_CATEGORIA_TROCADA', mensagem }],
    avisos,
  };
}

/** Monta o `def` de aplicarDefinicao: descrição, volume e expediente vazios não são enviados (ficam como o ECM30 trouxe). */
function definicaoParaAplicar(def) {
  const saida = { ...def };
  if (def.descricao === '') delete saida.descricao;
  if (!saida.volume) delete saida.volume;
  if (!saida.expediente) delete saida.expediente;
  return saida;
}

/** Definição geral gravada no <bpmn2:BpmnProcess> do .process (name, category, volume, expedient, instruction). */
async function definicaoDoProcess(caminho) {
  const p = carregarFluiggers().parseProcess(await readFile(caminho, 'utf8'));
  const a = (p && p.process && p.process.attributes) || {};
  const t = (v) => (typeof v === 'string' ? v : '');
  return { descricao: t(a.name), categoria: t(a.category), volume: t(a.volume), expediente: t(a.expedient), instrucao: t(a.instruction) };
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
  if (temSpec && args.novo === false) {
    // a spec monta o .process do zero e renumera as atividades: não serve para versão nova de processo existente
    throw new Error(
      'spec é só para processo novo (novo=true): gerar a versão nova de um processo existente a partir da spec renumera as atividades e quebra scripts e solicitações em andamento. Use fluig_flow_import, edite o .process e publique com processo e novo=false.'
    );
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
  let xmlServidor = null; // versão corrente no servidor, só para novo=false
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
    // a definição do processo é comum a todas as versões: processo existente com categoria no servidor a mantém
    if (!args.novo) {
      let doServidor;
      try {
        xmlServidor = await client.exportProcessXml(processId);
        doServidor = lerDefinicao(xmlServidor);
      } catch (e) {
        return { publicado: false, motivo: 'categoria do processo no servidor não conferida', erro: msg(e) };
      }
      // o .process é a fonte de categoria, volume, expediente, instrução e descrição; categoria 2.0 e ícone vêm do servidor
      const doProcess = await definicaoDoProcess(r.processo);
      ecm30 = aplicarDefinicao(ecm30, definicaoParaAplicar({ ...doProcess, processCategoryId: doServidor.processCategoryId, icon: doServidor.icon }), {
        versaoAlvo: args.versaoAlvo,
      });
      const trocada = recusaCategoria(doServidor.categoria, lerDefinicao(ecm30).categoria, {
        conversor: info,
        avisos,
        dica: `Ajuste a categoria no .process (VS Code) para "${doServidor.categoria}" e regenere.`,
      });
      if (trocada) return trocada;
    }
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

  // o conversor numera os campos descritores na própria ordem: a versão nova mantém os slots do servidor
  if (xmlServidor) {
    const s = aplicarSlots(ecm30, xmlServidor);
    if (s.aplicado) {
      ecm30 = s.xml;
      avisos.push({ codigo: 'W_SLOTS_DO_SERVIDOR', mensagem: 'O slotId dos campos descritores foi reaplicado da versão do servidor (o conversor tinha trocado a ordem).', caminho: 'processo' });
    } else if (s.motivo === 'os campos descritores foram reordenados') {
      avisos.push({ codigo: 'W_SLOTS_REORDENADOS', mensagem: 'Os campos descritores estão em outra ordem que a do servidor: vale a numeração nova (as colunas de consulta mudam de lugar).', caminho: 'processo' });
    }
  }

  let d;
  try {
    d = await client.deployProcess(ecm30, {
      processId,
      isNew: args.novo,
      overWrite: true,
      confirm: true,
      svgXml: svg,
    });
  } catch (e) {
    const texto = msg(e);
    if (!texto.startsWith('releaseProcess retornou ok=false')) throw e;
    const retornoServidor = texto.replace(/^releaseProcess retornou ok=false:?\s*/, '');
    const errosServidor = [];
    const errosPorTipo = {};
    for (const m of retornoServidor.matchAll(/(\w+Error)=\[([^\]]*)\]/g)) {
      for (const item of m[2].split(', ')) {
        if (item.trim() === '') continue;
        errosServidor.push(item.trim());
        (errosPorTipo[m[1]] = errosPorTipo[m[1]] || []).push(item.trim());
      }
    }
    return {
      publicado: false,
      motivo: 'liberação recusada pelo servidor',
      versaoEmEdicao: true,
      processId,
      novo: args.novo,
      versaoAlvo: args.versaoAlvo,
      versaoServidor: sv,
      conversor: info,
      errosServidor,
      errosPorTipo,
      retornoServidor,
      avisos: [
        ...avisos,
        {
          codigo: 'W_VERSAO_EM_EDICAO',
          mensagem: 'A versão foi importada mas não liberada; corrija e publique de novo (novo=false) ou libere/descarte no editor.',
          caminho: 'processo',
        },
      ],
    };
  }
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
