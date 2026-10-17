/**
 * Gera os três artefatos de um processo a partir da spec v1 (passo 5.3):
 *   <projeto>/workflow/diagrams/<processId>.process
 *   <projeto>/workflow/.resources/<processId>.ecm30.xml
 *   <projeto>/workflow/.resources/<processId>.processimage.svg
 * O `.process` sai do vendor Fluiggers (`specParaProcess`); ECM30 e SVG, de `regenerar` (conversor
 * oficial do Studio ou plano B com aviso). Sem `projeto`, tudo roda numa pasta temporária que é
 * apagada no fim e só o conteúdo volta.
 */
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { ErroFluxo } from './erro.js';
import { validarSpec } from './validar.js';
import { VERSOES_ALVO } from './spec.js';
import { specParaProcess } from './spec-process.js';
import { gravarAtomico, regenerar } from './regenerar.js';

export { ErroFluxo };

const RE_PROCESS_ID = /^[A-Za-z0-9_.-]+$/;

/**
 * Avisos que o plano B (gerador próprio, dentro de `regenerar`) emite sem saber o contexto: não há lookups
 * (a conferência de papéis e campos já foi feita por quem chama) e o SVG é gravado junto.
 */
export const AVISOS_DO_PLANO_B_REDUNDANTES = ['W_SEM_LOOKUP', 'W_SEM_FORMULARIO', 'W_GERADOR_SEM_DESENHO'];

async function lerSeExiste(caminho) {
  try {
    return await readFile(caminho);
  } catch {
    return null;
  }
}

/**
 * @param {object} spec spec v1
 * @param {{versaoAlvo: '1.8.2'|'2.0', projeto?: string, sobrescrever?: boolean,
 *          conversor?: 'auto'|'oficial'|'proprio', lookups?: object, cache?: string, java?: string,
 *          executar?: Function, agora?: Function}} opcoes
 * @returns {Promise<{ok: boolean, erros?: Array, avisos: Array, ids?: object, process?: object, ecm30?: object, svg?: object, conversor?: object}>}
 */
export async function gerarArtefatos(spec, opcoes = {}) {
  const { versaoAlvo, projeto, sobrescrever = false, conversor = 'auto', lookups, cache, java, executar, agora = () => new Date() } = opcoes;
  if (!VERSOES_ALVO.includes(versaoAlvo)) {
    throw new ErroFluxo('E_VERSAO', `versaoAlvo "${versaoAlvo}" inválida; use 1.8.2 ou 2.0.`);
  }

  // P0: validação da spec; com erro, nada é criado
  const v = await validarSpec(spec, { versaoAlvo, lookups });
  if (v.erros.length > 0) return { ok: false, erros: v.erros, avisos: v.avisos };
  const avisos = [...v.avisos];

  if (!RE_PROCESS_ID.test(spec.processId) || spec.processId.includes('..')) {
    throw new ErroFluxo('E_PROCESS_ID', `processId "${spec.processId}" não serve como nome de arquivo; use letras, dígitos, _, - e ponto.`);
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

  // monta o .process antes de tocar o disco (P1 e P2 dentro de specParaProcess)
  const sp = specParaProcess(spec, { versaoAlvo });
  avisos.push(...sp.avisos);
  const processBuf = Buffer.from(sp.texto, 'utf8');

  const temporario = raiz === null;
  const base = temporario ? await mkdtemp(join(tmpdir(), 'fluig-flow-')) : raiz;
  try {
    const dirDiagramas = join(base, 'workflow', 'diagrams');
    const dirRecursos = join(base, 'workflow', '.resources');
    const caminhoProcess = join(dirDiagramas, `${spec.processId}.process`);
    const carimbo = agora();

    const atual = await lerSeExiste(caminhoProcess);
    const igual = atual !== null && atual.equals(processBuf);
    if (atual !== null && !igual && !sobrescrever) {
      throw new ErroFluxo(
        'E_PROCESS_EXISTE',
        `${caminhoProcess} já existe e é diferente do gerado. Nada foi gravado. Use sobrescrever=true (o atual vai para workflow/.resources/.backups) ou edite o .process no VS Code e use fluig_flow_regenerate.`
      );
    }

    const proc = { caminho: temporario ? null : caminhoProcess, conteudo: sp.texto, bytes: processBuf.length, alterado: false, backup: null };
    await mkdir(dirDiagramas, { recursive: true });
    if (!igual) {
      if (atual !== null) {
        const dirBackups = join(dirRecursos, '.backups');
        await mkdir(dirBackups, { recursive: true });
        const destino = join(dirBackups, `${spec.processId}.process.${carimbo.toISOString().replace(/[:.]/g, '-')}.bak`);
        await copyFile(caminhoProcess, destino);
        proc.backup = destino;
      }
      await gravarAtomico(caminhoProcess, processBuf);
      proc.alterado = true;
    }

    let r;
    try {
      r = await regenerar(caminhoProcess, {
        versao: versaoAlvo,
        conversor,
        cache,
        java,
        executar,
        agora: () => carimbo,
        _tabela: opcoes._tabela,
        _dirPonte: opcoes._dirPonte,
      });
    } catch (e) {
      if (!temporario && e instanceof ErroFluxo) {
        throw new ErroFluxo(
          e.codigo,
          `${e.message}\nO .process ficou gravado em ${caminhoProcess}; depois de corrigir, rode: fluig-mcp regenerar "${caminhoProcess}" ${versaoAlvo}`
        );
      }
      throw e;
    }
    avisos.push(...r.avisos.filter((a) => !AVISOS_DO_PLANO_B_REDUNDANTES.includes(a.codigo)));

    return {
      ok: true,
      avisos,
      ids: sp.ids,
      process: proc,
      ecm30: { caminho: temporario ? null : r.ecm30.caminho, conteudo: r.ecm30.conteudo, bytes: r.ecm30.bytes, alterado: r.ecm30.alterado, backup: r.ecm30.backup },
      svg: { caminho: temporario ? null : r.svg.caminho, conteudo: r.svg.conteudo, bytes: r.svg.bytes, alterado: r.svg.alterado },
      conversor: r.conversor,
    };
  } finally {
    if (temporario) await rm(base, { recursive: true, force: true });
  }
}
