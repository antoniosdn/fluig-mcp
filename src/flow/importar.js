/**
 * Importa um processo do servidor como o Fluig Studio faz (plano-importador-studio.md, Fase 1):
 *   XML ECM30  →  <projeto>/workflow/diagrams/<processId>.process   (ids = números do servidor)
 *                 <projeto>/workflow/scripts/*.js, workflow/literals/*
 *                 <projeto>/workflow/.resources/<processId>.ecm30.xml e .processimage.svg (regenerar)
 *
 * O .process sai do importador do próprio Studio (ImportFromEcm3ToBpmn2FileReader), pela ponte Java
 * de src/flow/ponte-importador; a extensão Fluiggers renumera as atividades, o Studio não. Antes de
 * gravar no projeto passa por dois portões: validação do vendor e conferência de que todo número de
 * atividade e de ligação do ECM30 aparece num id do .process.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ErroFluxo } from './erro.js';
import { VERSOES_ALVO } from './spec.js';
import { carregarFluiggers } from './fluiggers.js';
import { CONVERSORES, IMPORTADORES, conferirConversor, conferirImportador, dirCache, importadorParaVersao } from './conversor.js';
import { OPCOES_EXECUCAO, argumentosImportador, conferirJavaImportador, executarPadrao, resolverJavaImportador } from './java.js';
import { gravarAtomico, gravarRecursos, regenerar } from './regenerar.js';

export { ErroFluxo };

export const DIR_PONTE_IMPORTADOR = join(dirname(fileURLToPath(import.meta.url)), 'ponte-importador');
// gerado por `node scripts/compilar-ponte-importador.mjs` (javac 1.8.0_492)
export const HASHES_PONTE_IMPORTADOR = Object.freeze({
  'ImportadorBridge.java': 'e1558e7b74f1dd9162e1aa6a0a0588d0815041bbec2a27c0db38ffd5a45315a1',
  'classes/ImportadorBridge$1.class': '2e9023becafe5cecd37c0d019514be26d14433c6afc542bc18d7a0a350166f84',
  'classes/ImportadorBridge$2.class': 'b3803dd63a663d39d0560adf0d83fcb4422e28b94c6aee480b4273a3b4e35cc9',
  'classes/ImportadorBridge.class': '430f0160d9167e2396b1773a98fafb937d4a968fa6767bbd99f69b423d463741',
  'classes/com/fluig/bpm/utils/ProjectUtils.class': 'c4eeeae61026f7b564a9343da4cf63f96127fc0f03fca88726d5b8adae524d81',
  'classes/com/totvs/tds/ecm/designer/eclipse/preferences/BpmnPreferencesUtil.class': '34b19444a0d451af1f6587eff54b0d553118d44c3d928f7a619087ee84c4f8d7',
  'com/fluig/bpm/utils/ProjectUtils.java': '139e2050a4ae2daf53264303bfe0271d92a72e46c0e6590eaa5c708cb61b6e4c',
  'com/totvs/tds/ecm/designer/eclipse/preferences/BpmnPreferencesUtil.java': '5960c0a949bb7cf5a0d32a7e2efe63104c2932036ce2e2b8f89d7ac1e3b2cadf',
});

// o Fluig aceita espaço no processId ("Emissao cracha") e o Studio grava "Emissao cracha.process":
// aqui só se recusa o que é perigoso num nome de arquivo
const RE_PROCESS_ID_RUIM = /[/\\:*?"<>|\u0000-\u001f]|^\s|\s$|^\.+$/;
const DICA_INSTALAR = 'fluig-mcp instalar-conversor --baixar 1.8.2.0 (instala o conversor e o importador)  ou  --de <pasta plugins | zip> de um Studio';

/** Confere o SHA-256 das fontes e classes da ponte e devolve o caminho de `classes/`. */
export function conferirPonteImportador({ dir = DIR_PONTE_IMPORTADOR, hashes = HASHES_PONTE_IMPORTADOR } = {}) {
  const nomes = Object.keys(hashes);
  if (!nomes.some((n) => n.startsWith('classes/'))) {
    throw new ErroFluxo('E_PONTE', 'Ponte do importador sem classes compiladas na tabela de hashes. Rode: node scripts/compilar-ponte-importador.mjs');
  }
  for (const nome of nomes) {
    let bytes;
    try {
      bytes = readFileSync(join(dir, ...nome.split('/')));
    } catch {
      bytes = null;
    }
    const obtido = bytes ? createHash('sha256').update(bytes).digest('hex') : 'ausente';
    if (obtido !== hashes[nome]) {
      throw new ErroFluxo(
        'E_PONTE',
        `Ponte do importador: ${nome} não confere (SHA-256 esperado ${hashes[nome]}, obtido ${obtido}). Restaure o arquivo do Git ou recompile com node scripts/compilar-ponte-importador.mjs.`
      );
    }
  }
  return join(dir, 'classes');
}

/** processId do <ProcessDefinition>. */
export function processIdDoXml(xml) {
  const m = /<processDefinitionPK>[\s\S]*?<processId>([^<]+)<\/processId>/.exec(xml);
  return m ? m[1].trim() : null;
}

/** Números das atividades (ProcessState) e das ligações (ProcessLink) do ECM30. */
export function numerosDoXml(xml) {
  const estados = [...xml.matchAll(/<processStatePK>[\s\S]*?<sequence>(\d+)<\/sequence>[\s\S]*?<\/processStatePK>/g)].map((m) => Number(m[1]));
  const ligacoes = [...xml.matchAll(/<processLinkPK>[\s\S]*?<linkSequence>(\d+)<\/linkSequence>[\s\S]*?<\/processLinkPK>/g)].map((m) => Number(m[1]));
  return { estados: [...new Set(estados)].sort((a, b) => a - b), ligacoes: [...new Set(ligacoes)].sort((a, b) => a - b) };
}

/** bpmnType dos eventos intermediários de link: o par "envia" → "recebe" não vira fluxo desenhado no .process. */
const LINK_ENVIA = '36';
const LINK_RECEBE = '42';

/** Ligações do ECM30 entre um evento de link "envia" e um "recebe" (o Studio guarda o par no evento, não num fluxo). */
export function ligacoesDeLink(xml) {
  const tipo = new Map();
  for (const m of xml.matchAll(/<ProcessState>([\s\S]*?)<\/ProcessState>/g)) {
    const seq = /<processStatePK>[\s\S]*?<sequence>(\d+)<\/sequence>/.exec(m[1]);
    const t = /<bpmnType>(\d+)<\/bpmnType>/.exec(m[1]);
    if (seq && t) tipo.set(seq[1], t[1]);
  }
  const saida = new Set();
  for (const m of xml.matchAll(/<ProcessLink>([\s\S]*?)<\/ProcessLink>/g)) {
    const l = /<linkSequence>(\d+)<\/linkSequence>/.exec(m[1]);
    const de = /<initialStateSequence>(\d+)<\/initialStateSequence>/.exec(m[1]);
    const para = /<finalStateSequence>(\d+)<\/finalStateSequence>/.exec(m[1]);
    if (l && de && para && tipo.get(de[1]) === LINK_ENVIA && tipo.get(para[1]) === LINK_RECEBE) saida.add(Number(l[1]));
  }
  return saida;
}

/**
 * Portão final: o ECM30 que o conversor oficial gera do .process importado tem exatamente os números de
 * atividades e de ligações do servidor.
 */
export function conferirNumerosRegenerados(xmlServidor, xmlRegenerado) {
  const a = numerosDoXml(xmlServidor);
  const b = numerosDoXml(xmlRegenerado);
  const dif = (x, y) => x.filter((n) => !y.includes(n));
  const partes = [
    ['atividades só no servidor', dif(a.estados, b.estados)],
    ['atividades só no regenerado', dif(b.estados, a.estados)],
    ['ligações só no servidor', dif(a.ligacoes, b.ligacoes)],
    ['ligações só no regenerado', dif(b.ligacoes, a.ligacoes)],
  ].filter(([, l]) => l.length);
  if (partes.length) {
    throw new ErroFluxo(
      'E_IMPORTADOR_IDS',
      `O ECM30 gerado do .process importado não tem os mesmos números do servidor (${partes.map(([r, l]) => `${r}: ${l.join(', ')}`).join('; ')}). Nada foi gravado no projeto.`
    );
  }
}

/** Tags do .process que viram ProcessState no ECM30, e as que nunca viram (numeração própria). */
const TAGS_ATIVIDADE = new Set(['BpmnStartEvent', 'BpmnTask', 'BpmnEndEvent', 'BpmnGateway', 'BpmnIntermediateEvent', 'BpmnSubProcess']);
const TAGS_SEM_ATIVIDADE = new Set(['BpmnProcess', 'BpmnSwimLane', 'BpmnPool']);

const digitos = (id) => {
  const m = /(\d+)$/.exec(String(id || ''));
  return m ? Number(m[1]) : null;
};

/**
 * Portões do .process importado: o vendor lê e valida sem erro, e cada número do ECM30 vira um id
 * (menos as ligações entre eventos de link, que não têm fluxo; essas valem null e são conferidas pelo
 * portão final, conferirNumerosRegenerados). Devolve { atividades: {número: id}, ligacoes: {número: id|null} }.
 */
export function conferirImportado(texto, xml) {
  const F = carregarFluiggers();
  const parsed = F.parseProcess(texto);
  if (!parsed || parsed.supported === false) {
    throw new ErroFluxo('E_IMPORTADOR_PROCESS_INVALIDO', 'O .process importado não é um .process suportado pela Fluiggers 3.0.1.');
  }
  const erros = F.validateProcess(parsed).errors || [];
  if (erros.length) {
    throw new ErroFluxo(
      'E_IMPORTADOR_PROCESS_INVALIDO',
      `O .process importado não passou na validação da Fluiggers:\n- ${erros.map((e) => `${e.code}: ${e.message || e.title || ''}`.trim()).join('\n- ')}`
    );
  }
  const { estados, ligacoes } = numerosDoXml(xml);
  const porNumero = (lista) => {
    const m = new Map();
    for (const e of lista) {
      const n = digitos(e.id);
      if (n !== null && !m.has(n)) m.set(n, e.id);
    }
    return m;
  };
  // raias e pools têm numeração própria (bpmnswimlane3 não é a atividade 3): primeiro os tipos que viram
  // atividade no Fluig, depois os demais elementos (documento, anotação, grupo)
  const elementosDoTipo = (tags) => porNumero((parsed.elements || []).filter((e) => tags(e.tag)));
  const atividadesDiretas = elementosDoTipo((t) => TAGS_ATIVIDADE.has(t));
  const outros = elementosDoTipo((t) => !TAGS_ATIVIDADE.has(t) && !TAGS_SEM_ATIVIDADE.has(t));
  const elementos = new Map([...outros, ...atividadesDiretas]);
  const fluxos = porNumero(parsed.flows || []);
  const deLink = ligacoesDeLink(xml);
  const faltaAtividade = estados.filter((n) => !elementos.has(n));
  const faltaLigacao = ligacoes.filter((n) => !fluxos.has(n) && !deLink.has(n));
  if (faltaAtividade.length || faltaLigacao.length) {
    throw new ErroFluxo(
      'E_IMPORTADOR_IDS',
      `O .process importado não manteve os números do servidor. ${faltaAtividade.length ? `Atividades sem id com o número: ${faltaAtividade.join(', ')}. ` : ''}${faltaLigacao.length ? `Ligações sem id com o número: ${faltaLigacao.join(', ')}.` : ''}`.trim()
    );
  }
  return {
    atividades: Object.fromEntries(estados.map((n) => [n, elementos.get(n)])),
    ligacoes: Object.fromEntries(ligacoes.map((n) => [n, fluxos.has(n) ? fluxos.get(n) : null])),
  };
}

async function lerSeExiste(caminho) {
  try {
    return await readFile(caminho);
  } catch {
    return null;
  }
}

async function listarArquivos(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((d) => d.isFile()).map((d) => d.name).sort();
  } catch {
    return [];
  }
}

/** Última linha não vazia do stdout da ponte, como JSON. Processo sem atividades → E_IMPORTADOR_VAZIO. */
function lerResultadoPonte(stdout, processId) {
  const linhas = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let r = null;
  try {
    r = JSON.parse(linhas[linhas.length - 1]);
  } catch {
    r = null;
  }
  if (r && r.ok === true) return r;
  if (r && r.ok === false && r.codigo === 'vazio') {
    throw new ErroFluxo('E_IMPORTADOR_VAZIO', `O processo ${processId} não tem nenhuma atividade no servidor; não há o que importar.`);
  }
  throw new ErroFluxo('E_IMPORTADOR_FALHOU', `A ponte do importador não devolveu o resultado esperado. Saída: ${String(stdout || '').slice(-500)}`);
}

const carimboDe = (d) => d.toISOString().replace(/[:.]/g, '-');

/**
 * Copia scripts ou literais da importação para o projeto. Novo: cria. Igual: nada. Diferente: mantém
 * o local e avisa; com `sobrescrever`, faz backup em .resources/.backups e troca. `conteudo` é sempre a
 * versão do servidor.
 */
async function copiarPasta({ origem, destino, dirBackups, sobrescrever, carimbo, rotulo, avisos }) {
  const saida = [];
  for (const nome of await listarArquivos(origem)) {
    const buf = await readFile(join(origem, nome));
    const alvo = join(destino, nome);
    const atual = await lerSeExiste(alvo);
    if (atual === null) {
      await mkdir(destino, { recursive: true });
      await gravarAtomico(alvo, buf);
      saida.push({ arquivo: alvo, acao: 'criado', conteudo: buf.toString('utf8') });
    } else if (atual.equals(buf)) {
      saida.push({ arquivo: alvo, acao: 'igual', conteudo: buf.toString('utf8') });
    } else if (sobrescrever) {
      await mkdir(dirBackups, { recursive: true });
      const backup = join(dirBackups, `${nome}.${carimbo}.bak`);
      await copyFile(alvo, backup);
      await gravarAtomico(alvo, buf);
      saida.push({ arquivo: alvo, acao: 'substituido', backup, conteudo: buf.toString('utf8') });
    } else {
      saida.push({ arquivo: alvo, acao: 'mantido', conteudo: buf.toString('utf8') });
      avisos.push({
        codigo: 'W_SCRIPT_LOCAL_DIFERENTE',
        mensagem: `${rotulo} ${nome}: a versão local difere da do servidor e foi mantida (use sobrescrever=true para trocar, com backup).`,
        caminho: alvo,
      });
    }
  }
  return saida;
}

/**
 * @param {string} xml ECM30 do processo (fluig_flow_read / exportProcessXml)
 * @param {{versaoAlvo?: '1.8.2'|'2.0', processId?: string, projeto?: string, sobrescrever?: boolean,
 *          servidor?: string, cache?: string, javaImportador?: string, java?: string,
 *          executar?: Function, agora?: Function, plataforma?: string}} opcoes
 */
export async function importarEcm30(xml, opcoes = {}) {
  const { versaoAlvo = '1.8.2', projeto, sobrescrever = false, servidor = 'fluig-mcp', cache, javaImportador, java, agora = () => new Date() } = opcoes;
  const executar = opcoes.executar || executarPadrao;
  const plataforma = opcoes.plataforma || process.platform;
  if (!VERSOES_ALVO.includes(versaoAlvo)) throw new ErroFluxo('E_VERSAO', `versaoAlvo "${versaoAlvo}" inválida; use 1.8.2 ou 2.0.`);
  if (typeof xml !== 'string' || !/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*<list/.test(xml) || !xml.includes('<ProcessDefinition>')) {
    throw new ErroFluxo('E_ECM30_INVALIDO', 'A entrada não parece um ECM30 de processo (esperado <list> com ProcessDefinition).');
  }
  const doXml = processIdDoXml(xml);
  const processId = opcoes.processId || doXml;
  if (!processId || RE_PROCESS_ID_RUIM.test(processId) || processId.includes('..')) {
    throw new ErroFluxo('E_PROCESS_ID', `processId "${processId}" não serve como nome de arquivo (tem / \\ : * ? " < > |, caractere de controle, .. ou espaço nas pontas).`);
  }
  if (doXml && doXml !== processId) {
    throw new ErroFluxo('E_PROCESS_ID', `O ECM30 é do processo "${doXml}", não de "${processId}".`);
  }

  let raiz = null;
  if (projeto !== undefined && projeto !== null && projeto !== '') {
    if (typeof projeto !== 'string' || !isAbsolute(projeto)) {
      throw new ErroFluxo('E_PROJETO', `projeto precisa ser um caminho absoluto (recebido: ${String(projeto)}).`);
    }
    raiz = resolve(projeto);
    let ehPasta = false;
    try {
      ehPasta = (await stat(raiz)).isDirectory();
    } catch {
      ehPasta = false;
    }
    if (!ehPasta) throw new ErroFluxo('E_PROJETO', `A pasta do projeto não existe: ${raiz}.`);
  }

  const base = cache ? resolve(cache) : dirCache();
  const sel = importadorParaVersao(versaoAlvo, { cache: base });
  if (!sel) {
    throw new ErroFluxo('E_IMPORTADOR_AUSENTE', `Importador do Studio ${versaoAlvo === '2.0' ? '2.0.0.2' : '1.8.2.0'} não instalado. Rode: ${DICA_INSTALAR}`);
  }
  const avisos = sel.aviso ? [sel.aviso] : [];
  const classesPonte = conferirPonteImportador(opcoes._dirPonteImportador ? { dir: opcoes._dirPonteImportador, hashes: opcoes._hashesPonteImportador } : {});
  const conv = await conferirConversor(sel.dirStudio, sel.versaoStudio, { tabela: opcoes._tabela || CONVERSORES });
  const imp = await conferirImportador(sel.dirImportador, sel.versaoStudio, { tabela: opcoes._tabelaImportador || IMPORTADORES, plataforma });
  const caminhoJava = await resolverJavaImportador({ javaImportador, plataforma, executar });
  const infoJava = await conferirJavaImportador(caminhoJava, { executar });

  const tmp = await mkdtemp(join(tmpdir(), 'fluig-importar-'));
  try {
    const entrada = join(tmp, `${processId}.ecm30.xml`);
    // o decoder do Studio exige que o texto comece em <list>: sem prólogo nem comentário antes
    await writeFile(entrada, xml.replace(/^\s*(<\?xml[^>]*\?>\s*)?(<!--[\s\S]*?-->\s*)*/, ''), 'utf8');
    const pasta = join(tmp, 'saida');
    await mkdir(pasta, { recursive: true });
    const args = argumentosImportador({
      major: infoJava.major,
      plataforma,
      classpath: [classesPonte, ...conv.classpath, ...imp.classpath, conv.xstream],
      entrada,
      pastaSaida: pasta,
      processId,
      servidor,
    });
    let r;
    try {
      r = await executar(caminhoJava, args, { ...OPCOES_EXECUCAO, cwd: tmp });
    } catch (e) {
      const stderr = String((e && e.stderr) || '');
      throw new ErroFluxo('E_IMPORTADOR_FALHOU', `O importador do Studio falhou: ${e && e.message}\n${stderr.slice(-2000)}`.trimEnd());
    }
    const resultado = lerResultadoPonte(r && r.stdout, processId);
    const dirSaidaWf = join(pasta, 'workflow');
    const caminhoTmp = join(dirSaidaWf, 'diagrams', `${processId}.process`);
    const processBuf = await lerSeExiste(caminhoTmp);
    if (!processBuf) throw new ErroFluxo('E_IMPORTADOR_FALHOU', 'O importador terminou sem gravar o .process.');
    const texto = processBuf.toString('utf8');
    const ids = conferirImportado(texto, xml);

    if (resultado.desconhecidos && resultado.desconhecidos.length) {
      avisos.push({
        codigo: 'W_IMPORTADOR_ITENS_DESCONHECIDOS',
        mensagem: `O Studio ${sel.versaoStudio} não reconhece ${resultado.desconhecidos.join(', ')}; esses itens não vão para o .process e se perdem se a versão for publicada a partir dele.`,
      });
    }
    if (resultado.subprocessos && resultado.subprocessos.length) {
      avisos.push({ codigo: 'W_IMPORTADOR_SUBPROCESSOS', mensagem: `Subprocessos referenciados (não importados junto): ${resultado.subprocessos.join(', ')}.` });
    }

    const carimbo = agora();
    const regen = (caminho) =>
      regenerar(caminho, {
        versao: versaoAlvo,
        conversor: 'oficial',
        cache: base,
        java,
        executar,
        agora: () => carimbo,
        _tabela: opcoes._tabela,
        _dirPonte: opcoes._dirPonte,
      });

    // portão final, ainda no temporário: o conversor oficial devolve os números do servidor
    const rg = await regen(caminhoTmp);
    conferirNumerosRegenerados(xml, rg.ecm30.conteudo);

    if (raiz === null) {
      return {
        ok: true,
        processId,
        versaoStudio: sel.versaoStudio,
        java: { caminho: caminhoJava, ...infoJava },
        formId: resultado.formId,
        ids,
        process: { caminho: null, conteudo: texto, bytes: processBuf.length, alterado: false, backup: null },
        scripts: (await listarArquivos(join(dirSaidaWf, 'scripts'))).map((nome) => ({ nome, conteudo: readFileSync(join(dirSaidaWf, 'scripts', nome), 'utf8') })),
        literais: (await listarArquivos(join(dirSaidaWf, 'literals'))).map((nome) => ({ nome, conteudo: readFileSync(join(dirSaidaWf, 'literals', nome), 'utf8') })),
        ecm30: { caminho: null, conteudo: rg.ecm30.conteudo, bytes: rg.ecm30.bytes },
        svg: { caminho: null, conteudo: rg.svg.conteudo, bytes: rg.svg.bytes },
        conversor: rg.conversor,
        avisos: [...avisos, ...rg.avisos],
      };
    }

    // grava no projeto: .process com a mesma política do gerarArtefatos
    const dirWf = join(raiz, 'workflow');
    const dirBackups = join(dirWf, '.resources', '.backups');
    const caminhoProcess = join(dirWf, 'diagrams', `${processId}.process`);
    const atual = await lerSeExiste(caminhoProcess);
    const igual = atual !== null && atual.equals(processBuf);
    if (atual !== null && !igual && !sobrescrever) {
      throw new ErroFluxo(
        'E_PROCESS_EXISTE',
        `${caminhoProcess} já existe e é diferente do importado. Nada foi gravado. Use sobrescrever=true (o atual vai para workflow/.resources/.backups).`
      );
    }
    const proc = { caminho: caminhoProcess, conteudo: texto, bytes: processBuf.length, alterado: false, backup: null };
    if (!igual) {
      await mkdir(dirname(caminhoProcess), { recursive: true });
      if (atual !== null) {
        await mkdir(dirBackups, { recursive: true });
        proc.backup = join(dirBackups, `${processId}.process.${carimboDe(carimbo)}.bak`);
        await copyFile(caminhoProcess, proc.backup);
      }
      await gravarAtomico(caminhoProcess, processBuf);
      proc.alterado = true;
    }
    const comuns = { dirBackups, sobrescrever, carimbo: carimboDe(carimbo), avisos };
    const scripts = await copiarPasta({ origem: join(dirSaidaWf, 'scripts'), destino: join(dirWf, 'scripts'), rotulo: 'Script', ...comuns });
    const literais = await copiarPasta({ origem: join(dirSaidaWf, 'literals'), destino: join(dirWf, 'literals'), rotulo: 'Literal', ...comuns });

    // o conversor embute os scripts da pasta do projeto: se todos ficaram iguais aos do servidor, o ECM30 e o
    // SVG já conferidos no temporário valem para o projeto; com algum local mantido, gera de novo no projeto
    let rgProjeto;
    try {
      if ([...scripts, ...literais].every((a) => a.acao !== 'mantido')) {
        const g = await gravarRecursos(join(dirWf, '.resources'), processId, Buffer.from(rg.ecm30.conteudo, 'utf8'), Buffer.from(rg.svg.conteudo, 'utf8'), { agora: () => carimbo });
        rgProjeto = { ...g, conversor: rg.conversor, avisos: rg.avisos };
      } else {
        rgProjeto = await regen(caminhoProcess);
      }
    } catch (e) {
      if (e instanceof ErroFluxo) {
        throw new ErroFluxo(e.codigo, `${e.message}\nO .process ficou gravado em ${caminhoProcess}; depois de corrigir, rode: fluig-mcp regenerar "${caminhoProcess}" ${versaoAlvo}`);
      }
      throw e;
    }
    return {
      ok: true,
      processId,
      versaoStudio: sel.versaoStudio,
      java: { caminho: caminhoJava, ...infoJava },
      formId: resultado.formId,
      ids,
      process: proc,
      scripts,
      literais,
      ecm30: { caminho: rgProjeto.ecm30.caminho, conteudo: rgProjeto.ecm30.conteudo, bytes: rgProjeto.ecm30.bytes, alterado: rgProjeto.ecm30.alterado, backup: rgProjeto.ecm30.backup },
      svg: { caminho: rgProjeto.svg.caminho, conteudo: rgProjeto.svg.conteudo, bytes: rgProjeto.svg.bytes, alterado: rgProjeto.svg.alterado },
      conversor: rgProjeto.conversor,
      avisos: [...avisos, ...rgProjeto.avisos],
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

