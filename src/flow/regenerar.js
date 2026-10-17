/**
 * Regenera o ECM30 e o SVG de um .process, como a extensão Fluiggers faz ao salvar (passo 5.2):
 *   <projeto>/workflow/diagrams/<nome>.process  →  <projeto>/workflow/.resources/<nome>.ecm30.xml
 *                                                  <projeto>/workflow/.resources/<nome>.processimage.svg
 * ECM30 = conversor oficial do Studio (via Ecm30Bridge, Java) ou, sem ele, o plano B (gerador próprio).
 * O .process nunca é escrito.
 */
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { ErroFluxo } from './erro.js';
import { VERSOES_ALVO } from './spec.js';
import { carregarFluiggers, conferirPonte } from './fluiggers.js';
import { CONVERSORES, conferirConversor, dirCache, studioParaVersao } from './conversor.js';
import { argumentosJava, executarPadrao, OPCOES_EXECUCAO, resolverJava, versaoJava } from './java.js';
import { lerProcess } from './process.js';
import { gerarXmlProcesso } from './gerar.js';

export { ErroFluxo };

const RE_SVG = /^\s*(?:<\?xml[^>]*\?>\s*)?<svg(?:\s|>)/;
const DICA_INSTALAR = 'Rode: fluig-mcp instalar-conversor --de <pasta plugins do Studio | zip>  (ou --baixar 1.8.2.0)';
const LINHA_IGNORADA = 'FILE_NOT_FOUND_IN_CLASSLOADER';

const ehIgual = (a, b) => a.length === b.length && a.equals(b);

function validarCaminho(caminho) {
  const abs = resolve(caminho);
  const dirDiagramas = dirname(abs);
  const ok =
    /\.process$/i.test(abs) &&
    basename(dirDiagramas).toLowerCase() === 'diagrams' &&
    basename(dirname(dirDiagramas)).toLowerCase() === 'workflow';
  if (!ok) {
    throw new ErroFluxo('E_CAMINHO', `O .process precisa estar em <projeto>/workflow/diagrams/ e ter extensão .process (recebido: ${caminho}).`);
  }
  return abs;
}

/** Cada atividade manual (type 85) precisa de exatamente 1 fluxo de saída. */
function conferirPreCondicao(parsed) {
  const ruins = [];
  for (const e of parsed.elements) {
    if (e.tag === 'BpmnTask' && String(e.attributes.type) === '85') {
      const n = String(e.attributes.outgoing || '').split(/\s+/).filter(Boolean).length;
      if (n !== 1) ruins.push(`${e.id} (${n} fluxos de saida)`);
    }
  }
  if (ruins.length) {
    throw new ErroFluxo(
      'E_PRECONDICAO',
      `O conversor do Fluig Studio exige exatamente um fluxo de saida em cada atividade manual. Corrija: ${ruins.join(', ')}`
    );
  }
}

function avisosDoStderr(stderr) {
  const avisos = [];
  for (const linha of String(stderr || '').split(/\r?\n/)) {
    const t = linha.trim();
    if (!t.startsWith('WARN ')) continue;
    if (t.includes(LINHA_IGNORADA)) continue;
    avisos.push({ codigo: 'W_CONVERSOR', mensagem: t.slice(5) });
  }
  return avisos;
}

async function lerEventos(dirScripts, nomeBase) {
  let nomes;
  try {
    nomes = await readdir(dirScripts);
  } catch {
    return [];
  }
  const prefixo = `${nomeBase}.`;
  const eventos = [];
  for (const n of nomes.sort()) {
    if (!n.startsWith(prefixo) || !n.endsWith('.js')) continue;
    const id = n.slice(prefixo.length, -3);
    eventos.push({ id, codigo: await readFile(join(dirScripts, n), 'utf8') });
  }
  return eventos;
}

async function planoB({ texto, versao, dirWorkflow, nomeBase }) {
  const leitura = lerProcess(texto);
  const recusas = leitura.avisos.map((a) => `${a.codigo}: ${a.mensagem}`);
  if (recusas.length) {
    throw new ErroFluxo(
      'E_PLANO_B_RECUSADO',
      `O gerador próprio recusa este processo porque a leitura perderia comportamento:\n- ${recusas.join('\n- ')}\nInstale o conversor oficial (${DICA_INSTALAR.replace('Rode: ', '')}) e use --oficial.`
    );
  }
  const eventos = await lerEventos(join(dirWorkflow, 'scripts'), nomeBase);
  const r = await gerarXmlProcesso(leitura.spec, { versaoAlvo: versao, origem: leitura.origem, eventos });
  if (!r.ok) {
    throw new ErroFluxo(
      'E_PLANO_B_RECUSADO',
      `O gerador próprio recusa este processo:\n- ${r.erros.map((e) => `${e.codigo}: ${e.mensagem}`).join('\n- ')}\nInstale o conversor oficial e use --oficial.`
    );
  }
  const avisos = [
    { codigo: 'W_ECM30_NAO_OFICIAL', mensagem: 'ECM30 gerado pelo plano B (gerador próprio), não pelo conversor oficial do Studio; confira antes de publicar.' },
  ];
  const perdas = new Map();
  for (const i of leitura.ignorados) {
    if (i.codigo === 'I_CAPTURA_ERRO_REGERADA') continue;
    perdas.set(i.codigo, (perdas.get(i.codigo) || 0) + 1);
  }
  for (const [codigo, n] of perdas) {
    avisos.push({ codigo: 'W_PLANO_B_PERDA', mensagem: `${codigo}: ${n} ${n === 1 ? 'ocorrência' : 'ocorrências'} — informação do .process que não vai para o ECM30 do plano B.` });
  }
  for (const a of r.avisos) avisos.push({ codigo: a.codigo, mensagem: a.mensagem });
  try {
    const lit = await readdir(join(dirWorkflow, 'literals'));
    if (lit.some((n) => n.startsWith(`${nomeBase}_`))) {
      avisos.push({ codigo: 'W_PLANO_B_LITERAIS', mensagem: 'Os literais (workflow/literals) do processo não entram no ECM30 do plano B.' });
    }
  } catch {
    /* sem pasta de literais */
  }
  return { xml: r.xml, avisos };
}

async function oficial({ abs, parsed, versao, studio, tabela, opcoes, nomeBase }) {
  conferirPreCondicao(parsed);
  let classesPonte;
  try {
    classesPonte = conferirPonte(opcoes._dirPonte ? { dir: opcoes._dirPonte } : {});
  } catch (e) {
    throw new ErroFluxo('E_PONTE', e.message);
  }
  const { classpath, xstream } = await conferirConversor(studio.dir, studio.versaoStudio, { tabela });
  const executar = opcoes.executar || executarPadrao;
  const caminhoJava = resolverJava({ java: opcoes.java });
  const major = await versaoJava(caminhoJava, { executar });
  const tmp = await mkdtemp(join(tmpdir(), 'fluig-ecm30-'));
  try {
    const saida = join(tmp, `${nomeBase}.ecm30.xml`);
    const args = argumentosJava({ major, classpath: [classesPonte, ...classpath, xstream], entrada: abs, saida, versao });
    let r;
    try {
      r = await executar(caminhoJava, args, OPCOES_EXECUCAO);
    } catch (e) {
      throw new ErroFluxo(
        'E_CONVERSOR_FALHOU',
        `O conversor do Studio falhou: ${e && e.message}\n${(e && e.stderr) || ''}\n${(e && e.stdout) || ''}`.trimEnd() +
          '\nConfira o Java (8 ou superior) e o .process; rode de novo com --proprio para usar o gerador próprio.'
      );
    }
    let buf;
    try {
      buf = await readFile(saida);
    } catch {
      throw new ErroFluxo('E_ECM30_INVALIDO', 'O conversor terminou sem gravar o ECM30. Confira o .process e o Java.');
    }
    const texto = buf.toString('utf8');
    if (!/^\s*<list/.test(texto) || !texto.includes('<ProcessDefinition>') || !texto.includes('<ProcessDefinitionVersion>')) {
      throw new ErroFluxo('E_ECM30_INVALIDO', 'A saída do conversor não parece um ECM30 de processo (esperado <list> com ProcessDefinition e ProcessDefinitionVersion). Confira o .process.');
    }
    return { buf, java: { caminho: caminhoJava, major }, avisos: avisosDoStderr(r && r.stderr) };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function gravarAtomico(destino, buf) {
  const tmp = `${destino}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    await writeFile(tmp, buf);
    await rename(tmp, destino);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

async function lerSeExiste(caminho) {
  try {
    return await readFile(caminho);
  } catch {
    return null;
  }
}

/**
 * @param {string} caminhoProcess caminho do .process
 * @param {{versao?: '1.8.2'|'2.0', conversor?: 'auto'|'oficial'|'proprio', cache?: string, java?: string,
 *          gravar?: boolean, executar?: Function, agora?: Function}} opcoes
 */
export async function regenerar(caminhoProcess, opcoes = {}) {
  const { versao = '1.8.2', conversor = 'auto', cache, gravar = true, agora = () => new Date() } = opcoes;
  const tabela = opcoes._tabela || CONVERSORES;

  const abs = validarCaminho(caminhoProcess);
  if (!VERSOES_ALVO.includes(versao)) {
    throw new ErroFluxo('E_VERSAO', `Versão "${versao}" inválida; use 1.8.2 ou 2.0.`);
  }
  if (!['auto', 'oficial', 'proprio'].includes(conversor)) {
    throw new ErroFluxo('E_VERSAO', `Conversor "${conversor}" inválido; use auto, oficial ou proprio.`);
  }
  try {
    if (!(await stat(abs)).isFile()) throw new Error();
  } catch {
    throw new ErroFluxo('E_CAMINHO', `Arquivo não encontrado: ${abs}.`);
  }

  const nomeBase = basename(abs).replace(/\.process$/i, '');
  const dirWorkflow = dirname(dirname(abs));
  const dirRecursos = join(dirWorkflow, '.resources');
  const texto = await readFile(abs, 'utf8');

  const F = carregarFluiggers();
  const parsed = F.parseProcess(texto);
  if (!parsed || parsed.supported === false) {
    throw new ErroFluxo('E_PROCESS_INVALIDO', `${abs} não é um .process suportado (formato do Fluig Studio / Fluiggers 3.0.1).`);
  }
  const avisos = [];
  const validacao = F.validateProcess(parsed);
  for (const e of validacao.errors || []) {
    avisos.push({ codigo: 'W_PROCESS_POS', mensagem: `${e.code}: ${e.message || e.title || ''}`.trim() });
  }

  const base = cache ? resolve(cache) : dirCache();
  const studio = conversor === 'proprio' ? null : studioParaVersao(versao, { cache: base });
  if (conversor === 'oficial' && !studio) {
    throw new ErroFluxo(
      'E_CONVERSOR_AUSENTE',
      `Conversor do Studio ${versao === '2.0' ? '2.0.0.2' : '1.8.2.0'} não instalado. ${DICA_INSTALAR}`
    );
  }

  let ecm30Buf;
  let infoConversor;
  if (studio) {
    if (studio.aviso) avisos.push(studio.aviso);
    const r = await oficial({ abs, parsed, versao, studio, tabela, opcoes, nomeBase });
    ecm30Buf = r.buf;
    infoConversor = { tipo: 'oficial', versaoStudio: studio.versaoStudio, java: r.java };
    avisos.push(...r.avisos);
  } else {
    const r = await planoB({ texto, versao, dirWorkflow, nomeBase });
    ecm30Buf = Buffer.from(r.xml, 'utf8');
    infoConversor = { tipo: 'proprio' };
    avisos.push(...r.avisos);
  }

  const svgTexto = F.renderProcessImageSvg(texto);
  if (typeof svgTexto !== 'string' || !RE_SVG.test(svgTexto)) {
    throw new ErroFluxo('E_SVG_INVALIDO', 'O renderizador do vendor não devolveu um SVG válido. Confira o .process.');
  }
  const svgBuf = Buffer.from(svgTexto, 'utf8');

  const caminhoEcm = join(dirRecursos, `${nomeBase}.ecm30.xml`);
  const caminhoSvg = join(dirRecursos, `${nomeBase}.processimage.svg`);
  const ecm30 = { caminho: caminhoEcm, conteudo: ecm30Buf.toString('utf8'), bytes: ecm30Buf.length, alterado: false, backup: null };
  const svg = { caminho: caminhoSvg, conteudo: svgTexto, bytes: svgBuf.length, alterado: false };

  if (gravar) {
    await mkdir(dirRecursos, { recursive: true });
    const atualEcm = await lerSeExiste(caminhoEcm);
    if (!atualEcm || !ehIgual(atualEcm, ecm30Buf)) {
      if (atualEcm) {
        const dirBackups = join(dirRecursos, '.backups');
        await mkdir(dirBackups, { recursive: true });
        const carimbo = agora().toISOString().replace(/[:.]/g, '-');
        const destinoBackup = join(dirBackups, `${nomeBase}.ecm30.xml.${carimbo}.bak`);
        await copyFile(caminhoEcm, destinoBackup);
        ecm30.backup = destinoBackup;
      }
      await gravarAtomico(caminhoEcm, ecm30Buf);
      ecm30.alterado = true;
    }
    const atualSvg = await lerSeExiste(caminhoSvg);
    if (!atualSvg || !ehIgual(atualSvg, svgBuf)) {
      await gravarAtomico(caminhoSvg, svgBuf);
      svg.alterado = true;
    }
  }

  return { processo: abs, conversor: infoConversor, ecm30, svg, avisos };
}
