/**
 * Busca resumida no log do servidor Fluig.
 *
 * O Fluig não expõe o server.log pela API. Esta busca usa a widget de leitura de log instalada
 * no servidor (padrão: `ascendra_log_viewer`, rota `/api/logs/ler`) e devolve o resultado já
 * reduzido: linhas longas cortadas, ocorrências repetidas agrupadas e total limitado. Sem isso,
 * uma busca comum ("ecm.workflow", "ERROR") devolve centenas de milhares de caracteres e estoura
 * o contexto de quem chamou.
 *
 * A lógica é pura (sem rede) para ser testada sem servidor: o handler da tool só busca as linhas
 * e entrega para `resumirLog`.
 */

export const LOG_API_PADRAO = '/ascendra_log_viewer/api/logs';

/** Limites — altos o bastante para investigar, baixos o bastante para não estourar o contexto. */
export const LIMITES = {
  janelaPadrao: 5000, janelaMax: 20000,
  ocorrenciasPadrao: 20, ocorrenciasMax: 100,
  charsLinhaPadrao: 300, charsLinhaMax: 2000,
  contextoMax: 10,
  charsTotalMax: 30000,
};

const limitar = (v, padrao, max, min = 0) => {
  const n = Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.trunc(Number(v)) : padrao;
  return Math.min(Math.max(n, min), max);
};

/** Corta a linha mantendo o começo (data, nível e classe ficam sempre visíveis). */
export function cortar(linha, max) {
  const s = String(linha ?? '');
  return s.length <= max ? s : s.slice(0, max) + ` …[+${s.length - max} caracteres]`;
}

/**
 * Assinatura para agrupar linhas "iguais": sem data/hora, UUIDs, hexadecimais longos e números.
 * Duas linhas de stack ou de job que só mudam o id caem no mesmo grupo.
 */
export function assinatura(linha) {
  return String(linha ?? '')
    .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}[,.]\d+\s*/, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

const DATA = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})/;
const ehStack = (l) => /^\s*(at |\.\.\. \d+ more|Caused by:)/.test(l);

/** Normaliza os parâmetros da tool (exportado para o teste). */
export function normalizarParametros(p = {}) {
  return {
    arquivo: String(p.arquivo || 'server.log'),
    filtro: String(p.filtro ?? ''),
    janela: limitar(p.janela, LIMITES.janelaPadrao, LIMITES.janelaMax, 1),
    max: limitar(p.max, LIMITES.ocorrenciasPadrao, LIMITES.ocorrenciasMax, 1),
    charsLinha: limitar(p.charsLinha, LIMITES.charsLinhaPadrao, LIMITES.charsLinhaMax, 40),
    contexto: limitar(p.contexto, 0, LIMITES.contextoMax),
    agrupar: p.agrupar !== false,
    semStack: p.semStack === true,
    diferenciarCaixa: p.diferenciarCaixa === true,
  };
}

/**
 * Monta o caminho da API da widget.
 * - sem contexto: a widget filtra o arquivo inteiro e devolve as últimas `janela` ocorrências;
 * - com contexto: busca as últimas `janela` linhas SEM filtro e o filtro é aplicado aqui, para
 *   poder devolver as linhas vizinhas (a widget só devolve as que casam).
 */
export function caminhoApi(base, p) {
  const q = new URLSearchParams({ arquivo: p.arquivo, linhas: String(p.janela) });
  if (!p.contexto && p.filtro) { q.set('filtro', p.filtro); q.set('ignorarCaixa', String(!p.diferenciarCaixa)); }
  return `${base.replace(/\/$/, '')}/ler?${q}`;
}

/**
 * Reduz a resposta da widget ({ linhas, ocorrencias, ... }) a um resumo de tamanho controlado.
 */
export function resumirLog(resposta, params) {
  const p = normalizarParametros(params);
  const linhas = Array.isArray(resposta?.linhas) ? resposta.linhas.map(String) : [];
  const alvo = p.diferenciarCaixa ? p.filtro : p.filtro.toLowerCase();
  const casa = (l) => !alvo || (p.diferenciarCaixa ? l : l.toLowerCase()).includes(alvo);

  const base = {
    arquivo: p.arquivo,
    filtro: p.filtro || null,
    modo: p.contexto ? `últimas ${p.janela} linhas do arquivo, filtradas aqui, com ${p.contexto} de contexto`
      : (p.filtro ? 'arquivo inteiro filtrado pela widget' : `últimas ${p.janela} linhas`),
  };
  if (!p.contexto && Number.isFinite(resposta?.ocorrencias)) base.ocorrenciasNoArquivo = resposta.ocorrencias;

  let resultado;
  if (p.contexto) {
    // Índices das ocorrências, das mais recentes para as mais antigas, até `max`.
    const idx = [];
    for (let i = linhas.length - 1; i >= 0 && idx.length < p.max; i--) {
      if (casa(linhas[i]) && !(p.semStack && ehStack(linhas[i]))) idx.push(i);
    }
    idx.reverse();
    base.ocorrenciasNaJanela = linhas.filter(casa).length;
    // Blocos com contexto; blocos que se sobrepõem são unidos.
    const blocos = [];
    for (const i of idx) {
      const ini = Math.max(0, i - p.contexto);
      const fim = Math.min(linhas.length - 1, i + p.contexto);
      const ult = blocos[blocos.length - 1];
      if (ult && ini <= ult.fim + 1) { ult.fim = Math.max(ult.fim, fim); ult.alvos.push(i); } else blocos.push({ ini, fim, alvos: [i] });
    }
    resultado = blocos.map((b) => linhas.slice(b.ini, b.fim + 1)
      .map((l, k) => (b.alvos.includes(b.ini + k) ? '» ' : '  ') + cortar(l, p.charsLinha)));
    base.blocos = resultado;
  } else {
    let sel = linhas.filter((l) => casa(l) && !(p.semStack && ehStack(l)));
    if (p.agrupar) {
      const grupos = new Map();
      for (const l of sel) {
        const k = assinatura(l);
        const g = grupos.get(k);
        const d = l.match(DATA)?.[1] || null;
        if (g) { g.qtd++; if (d) g.ultima = d; } else grupos.set(k, { qtd: 1, primeira: d, ultima: d, exemplo: l });
      }
      // Grupos mais recentes por último (ordem de primeira aparição), limitados aos `max` últimos.
      const lista = [...grupos.values()];
      base.gruposDistintos = lista.length;
      resultado = lista.slice(-p.max).map((g) => ({
        qtd: g.qtd,
        ...(g.primeira ? { primeira: g.primeira } : {}),
        ...(g.ultima && g.ultima !== g.primeira ? { ultima: g.ultima } : {}),
        linha: cortar(g.exemplo, p.charsLinha),
      }));
      base.grupos = resultado;
    } else {
      resultado = sel.slice(-p.max).map((l) => cortar(l, p.charsLinha));
      base.linhas = resultado;
    }
    base.linhasRecebidas = linhas.length;
    base.linhasQueCasam = sel.length;
  }

  // Trava final de tamanho: corta itens do começo (os mais antigos) até caber.
  const chave = base.blocos ? 'blocos' : (base.grupos ? 'grupos' : 'linhas');
  let omitidos = 0;
  while (JSON.stringify(base).length > LIMITES.charsTotalMax && base[chave].length > 1) {
    base[chave].shift(); omitidos++;
  }
  if (omitidos) base.omitidosPorTamanho = omitidos;
  return base;
}
