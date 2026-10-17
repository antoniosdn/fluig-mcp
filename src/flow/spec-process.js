/**
 * Spec v1 → arquivo `.process` (BPMN do Fluig Studio / Fluiggers), passo 5.3.
 *
 *   const { texto, ids, fluxos, posicoes, origem, avisos } = specParaProcess(spec, { versaoAlvo });
 *
 * Monta o `.process` SÓ pelas funções do vendor Fluiggers 3.0.1 (`carregarFluiggers`); a única
 * transformação de texto é o escape ASCII final (contorno da 3.0.1). Síncrono, sem disco.
 * Pressupõe a spec já validada (`validarSpec` é de quem chama). Antes de devolver, passa por dois
 * portões: validação estrutural do vendor (P1) e auto-conferência `lerProcess` × spec (P2).
 */
import { TIPOS, OPERADORES, EXECUCAO } from './spec.js';
import { ErroFluxo } from './erro.js';
import { carregarFluiggers } from './fluiggers.js';
import { lerProcess } from './process.js';
import { colunasLayout } from './gerar.js';

/** tipo da spec → { kind, subtype } do vendor (chaves iguais às de TIPOS). */
export const NO_VENDOR = Object.freeze({
  inicio: Object.freeze({ kind: 'start', subtype: '10' }),
  humana: Object.freeze({ kind: 'task', subtype: '80' }),
  servico: Object.freeze({ kind: 'task', subtype: '82' }),
  gateway_exclusivo: Object.freeze({ kind: 'gateway', subtype: '120' }),
  gateway_paralelo_abertura: Object.freeze({ kind: 'gateway', subtype: '126' }),
  gateway_paralelo_juncao: Object.freeze({ kind: 'gateway', subtype: '127' }),
  fim: Object.freeze({ kind: 'end', subtype: '60' }),
  cancelamento: Object.freeze({ kind: 'end', subtype: '65' }),
  fim_terminativo: Object.freeze({ kind: 'end', subtype: '68' }),
});

const MECANISMO = { papel: 'Papel', pool_papel: 'Pool Papel' };

/** Deslocamento somado ao canto da célula (layout automático), para alinhar o centro com o de uma tarefa 106×56. */
const DESLOCAMENTO = {
  inicio: [35, 10],
  fim: [35, 10],
  cancelamento: [35, 10],
  fim_terminativo: [35, 10],
  gateway_exclusivo: [23, -2],
  gateway_paralelo_abertura: [23, -2],
  gateway_paralelo_juncao: [23, -2],
  humana: [0, 0],
  servico: [0, 0],
};

const digitosFinais = (id) => {
  const m = /(\d+)$/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : null;
};

/** Executa uma chamada do vendor; qualquer exceção vira E_PROCESS_VENDOR. */
function vendor(operacao, ref, fn) {
  try {
    return fn();
  } catch (e) {
    throw new ErroFluxo('E_PROCESS_VENDOR', `${operacao} de ${ref}: ${e && e.message ? e.message : e}`);
  }
}

function calcularPosicoes(spec, avisos) {
  const ativs = spec.atividades;
  const comPosicao = ativs.filter((a) => a.posicao !== undefined).length;
  if (comPosicao > 0 && comPosicao < ativs.length) {
    avisos.push({
      codigo: 'W_GERADOR_POSICAO_PARCIAL',
      mensagem: 'Só parte das atividades tem posicao; as outras foram posicionadas pelo gerador e podem cair em cima das informadas.',
      caminho: 'atividades',
    });
  }
  const grade = colunasLayout(spec);
  const pos = {};
  ativs.forEach((a, i) => {
    if (a.posicao !== undefined) {
      const { x, y } = a.posicao;
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        avisos.push({
          codigo: 'W_GERADOR_POSICAO_ARREDONDADA',
          mensagem: `A posição de ${a.id} (${x}, ${y}) não é inteira; foi arredondada.`,
          caminho: `atividades[${i}].posicao`,
        });
      }
      pos[a.id] = { x: Math.round(x), y: Math.round(y) };
    } else {
      const g = grade.get(a.id);
      const [dx, dy] = DESLOCAMENTO[a.tipo] || [0, 0];
      pos[a.id] = { x: 100 + 250 * g.coluna + dx, y: 100 + 150 * g.linha + dy };
    }
  });
  return pos;
}

/**
 * @param {object} spec spec v1 já validada
 * @param {{versaoAlvo?: '1.8.2'|'2.0'}} [opcoes]
 * @returns {{texto: string, ids: object, fluxos: string[], posicoes: object, origem: object, avisos: Array}}
 */
export function specParaProcess(spec, { versaoAlvo } = {}) {
  void versaoAlvo; // o .process é o mesmo para as duas versões; a versão pesa só na conversão para ECM30
  const F = carregarFluiggers();
  const ed = F.editor;
  const T = { templateText: F.templateCriacao };

  // contorno 3: o .process não guarda o nome da condição
  for (const l of spec.ligacoes) {
    if (l.condicao && l.condicao.nome !== undefined) {
      throw new ErroFluxo(
        'E_PROCESS_CONDICAO_NOME',
        `o .process não guarda o nome da condição (2.0); tire \`nome\` da ligação ${l.de}→${l.para}.`
      );
    }
  }

  const avisos = [];
  const posicoes = calcularPosicoes(spec, avisos);

  let texto = vendor('esqueleto', spec.processId, () =>
    F.buildProcessScaffold(F.templateCriacao, spec.processId, {
      description: spec.descricao !== undefined && spec.descricao !== '' ? spec.descricao : spec.processId,
    })
  ).text;
  const aplicar = (r) => {
    texto = r.text;
    return r;
  };

  if (spec.formId !== undefined && spec.formId !== null) {
    vendor('formulário', spec.processId, () =>
      aplicar(ed.patchProcessForm(texto, spec.processId, { source: 'server', cardIndex: String(spec.formId), descriptorFields: [] }, { localForms: [] }))
    );
  }

  const ids = {};
  const capturas = {};
  for (const a of spec.atividades) {
    const def = NO_VENDOR[a.tipo];
    if (!def) throw new ErroFluxo('E_PROCESS_VENDOR', `criação de ${a.id}: tipo "${a.tipo}" sem equivalente no vendor.`);
    const p = posicoes[a.id];
    const elementId = vendor('criação', a.id, () => aplicar(ed.createIsolatedNode(texto, { kind: def.kind, subtype: def.subtype, x: p.x, y: p.y, ...T })).elementId);
    ids[a.id] = elementId;

    const mudancas = { name: a.nome };
    if (a.tipo === 'servico') mudancas.executionType = String(EXECUCAO[a.execucao]);
    vendor('nome/execução', a.id, () => aplicar(ed.patchProcess(texto, elementId, mudancas)));

    if (a.responsavel) {
      // contorno 1 (defeito da 3.0.1): em atividade nova a primeira chamada grava só um dos dois atributos
      for (let k = 0; k < 2; k++) {
        vendor('atribuição', a.id, () =>
          aplicar(
            ed.patchTaskAssignment(texto, elementId, {
              mechanism: MECANISMO[a.responsavel.tipo],
              mechanismConfiguration: { roleId: a.responsavel.valor },
            })
          )
        );
      }
    }

    if (a.tipo === 'servico' && a.execucao === 'automatizada') {
      const r = vendor('captura de erro', a.id, () => aplicar(ed.createAttachedErrorEvent(texto, { taskId: elementId, x: p.x + 40, y: p.y + 55, ...T })));
      capturas[a.id] = r.elementId;
    }
  }

  // ligações: um fluxo por par de→para; OU (par repetido) reaproveita o fluxo
  const porPar = new Map();
  const fluxos = spec.ligacoes.map((l) => {
    const par = `${l.de}>${l.para}`;
    if (porPar.has(par)) return porPar.get(par);
    const flowId = vendor('ligação', `${l.de}→${l.para}`, () =>
      aplicar(ed.createSequenceFlow(texto, { sourceId: ids[l.de], targetId: ids[l.para], bendpoints: [], ...T })).flowId
    );
    porPar.set(par, flowId);
    if (l.retorno) {
      vendor('retorno', `${l.de}→${l.para}`, () => aplicar(ed.patchProcess(texto, flowId, { permiteRetorno: 'true' })));
    }
    return flowId;
  });

  // condições e saída padrão dos gateways exclusivos (depois de todas as ligações)
  for (const a of spec.atividades) {
    if (a.tipo !== 'gateway_exclusivo') continue;
    const saidas = spec.ligacoes.map((l, i) => ({ l, f: fluxos[i] })).filter((x) => x.l.de === a.id);
    const conditions = saidas
      .filter((x) => x.l.condicao)
      .map(({ l }) => {
        if (l.condicao.regras) {
          return {
            order: l.ordem,
            targetId: ids[l.para],
            conditionType: '1',
            expression: '',
            mechanism: '',
            mechanismConfiguration: null,
            rules: l.condicao.regras.map((r) => ({
              field: r.campo,
              operator: String(OPERADORES[r.op]),
              valueType: r.valorTipo === 'campo' ? '0' : '1',
              value: r.valor === undefined ? '' : String(r.valor),
            })),
          };
        }
        return {
          order: l.ordem,
          targetId: ids[l.para],
          conditionType: '0',
          expression: l.condicao.js,
          rules: [],
          mechanism: '',
          mechanismConfiguration: null,
        };
      });
    const padrao = saidas.find((x) => x.l.padrao);
    if (conditions.length === 0 && !padrao) continue;
    vendor('condições', a.id, () => aplicar(ed.patchGatewayBranches(texto, ids[a.id], { conditions, defaultFlowId: padrao ? padrao.f : '' })));
  }

  // contorno 2: o .process declara ASCII; tudo que não for ASCII vira referência numérica
  texto = texto.replace(/[^\x00-\x7f]/gu, (c) => `&#x${c.codePointAt(0).toString(16)};`);
  if (!/^[\x00-\x7f]*$/.test(texto)) {
    throw new ErroFluxo('E_PROCESS_ASCII', 'O .process gerado ainda tem caractere não ASCII depois do escape.');
  }

  // P1: validação estrutural do vendor
  const validacao = F.validateProcess(F.parseProcess(texto));
  const errosVendor = validacao.errors || [];
  if (errosVendor.length > 0) {
    throw new ErroFluxo(
      'E_PROCESS_POS',
      `O .process gerado não passou na validação do vendor:\n- ${errosVendor.map((e) => `${e.code}: ${e.message || e.title || ''}`.trim()).join('\n- ')}`
    );
  }
  for (const w of validacao.warnings || []) {
    avisos.push({ codigo: 'W_PROCESS_POS_AVISO', mensagem: `${w.code}: ${w.message || w.title || ''}`.trim() });
  }

  // origem no formato de gerarXmlProcesso (conferirOrigem)
  const sequencias = {};
  for (const a of spec.atividades) sequencias[a.id] = digitosFinais(ids[a.id]);
  const origemCapturas = {};
  for (const [id, elementId] of Object.entries(capturas)) origemCapturas[id] = digitosFinais(elementId);
  const origem = {
    processId: spec.processId,
    versao: 1,
    sequencias,
    capturas: origemCapturas,
    linkSequences: fluxos.map(digitosFinais),
  };

  // P2: auto-conferência sem Java
  const lida = lerProcess(texto);
  if (lida.avisos.length > 0) {
    throw new ErroFluxo(
      'E_PROCESS_DIVERGENTE',
      `A releitura do .process gerado tem avisos:\n- ${lida.avisos.map((a) => `${a.codigo}: ${a.mensagem}`).join('\n- ')}`
    );
  }
  const difs = compararSpecProcess(spec, lida.spec, { ids, posicoes });
  if (difs.length > 0) {
    throw new ErroFluxo(
      'E_PROCESS_DIVERGENTE',
      `O .process gerado difere da spec:\n- ${difs.map((d) => `${d.campo}: esperado ${JSON.stringify(d.esperado)}, obtido ${JSON.stringify(d.obtido)}`).join('\n- ')}`
    );
  }

  return { texto, ids, fluxos, posicoes, origem, avisos };
}

/* ------------------------------------------------------------------ */
/* Comparação spec × spec lida                                         */
/* ------------------------------------------------------------------ */

const str = (v) => (v === undefined || v === null ? '' : String(v));

function normCondicao(c) {
  if (!c) return null;
  if (c.regras) {
    return {
      regras: c.regras.map((r) => ({
        campo: r.campo,
        op: r.op,
        valor: str(r.valor),
        valorTipo: r.valorTipo === 'campo' ? 'campo' : 'fixo',
      })),
    };
  }
  return { js: str(c.js) };
}

/**
 * Compara a spec original com a spec lida do `.process` (ou do ECM30 convertido).
 * `lida` = o campo `spec` de `lerProcess`/`lerXmlProcesso`; `ids` = id da spec → elementId do vendor.
 * Os ids da spec lida são `s<seq>`, com `seq` os dígitos finais do elementId.
 * @returns {Array<{campo: string, esperado: any, obtido: any}>} [] = igual
 */
export function compararSpecProcess(spec, lida, { ids, posicoes }) {
  const difs = [];
  const dif = (campo, esperado, obtido) => difs.push({ campo, esperado, obtido });
  const sid = (id) => `s${digitosFinais(ids[id])}`;

  if (spec.processId !== lida.processId) dif('processId', spec.processId, lida.processId);
  const descEsperada = spec.descricao !== undefined && spec.descricao !== '' ? spec.descricao : spec.processId;
  const descObtida = lida.descricao !== undefined ? lida.descricao : lida.processId;
  if (descEsperada !== descObtida) dif('descricao', descEsperada, descObtida);
  if ((spec.formId ?? null) !== (lida.formId ?? null)) dif('formId', spec.formId ?? null, lida.formId ?? null);

  if (spec.atividades.length !== lida.atividades.length) dif('atividades.length', spec.atividades.length, lida.atividades.length);
  const lidaPorId = new Map(lida.atividades.map((a) => [a.id, a]));
  for (const a of spec.atividades) {
    const b = lidaPorId.get(sid(a.id));
    if (!b) {
      dif(`atividades.${a.id}`, 'presente', 'ausente');
      continue;
    }
    if (a.tipo !== b.tipo) dif(`atividades.${a.id}.tipo`, a.tipo, b.tipo);
    if (a.nome !== b.nome) dif(`atividades.${a.id}.nome`, a.nome, b.nome);
    const ra = a.responsavel ? `${a.responsavel.tipo}:${a.responsavel.valor}` : null;
    const rb = b.responsavel ? `${b.responsavel.tipo}:${b.responsavel.valor}` : null;
    if (ra !== rb) dif(`atividades.${a.id}.responsavel`, ra, rb);
    if ((a.execucao ?? null) !== (b.execucao ?? null)) dif(`atividades.${a.id}.execucao`, a.execucao ?? null, b.execucao ?? null);
    const pe = posicoes && posicoes[a.id] ? posicoes[a.id] : a.posicao;
    const po = b.posicao;
    if (pe && (!po || pe.x !== po.x || pe.y !== po.y)) dif(`atividades.${a.id}.posicao`, pe, po ?? null);
  }

  const chave = (l, mapa) =>
    JSON.stringify({
      de: mapa(l.de),
      para: mapa(l.para),
      ordem: l.ordem ?? null,
      condicao: normCondicao(l.condicao),
      retorno: !!l.retorno,
      padrao: !!l.padrao,
    });
  const esperadas = spec.ligacoes.map((l) => chave(l, sid)).sort();
  const obtidas = lida.ligacoes.map((l) => chave(l, (x) => x)).sort();
  if (esperadas.length !== obtidas.length) dif('ligacoes.length', esperadas.length, obtidas.length);
  const contagem = new Map();
  for (const k of esperadas) contagem.set(k, (contagem.get(k) || 0) + 1);
  for (const k of obtidas) contagem.set(k, (contagem.get(k) || 0) - 1);
  for (const [k, n] of contagem) {
    if (n > 0) dif('ligacoes', JSON.parse(k), 'ausente');
    else if (n < 0) dif('ligacoes', 'ausente', JSON.parse(k));
  }
  return difs;
}

// Confere em tempo de carga que NO_VENDOR cobre exatamente os tipos de TIPOS.
if (Object.keys(NO_VENDOR).sort().join() !== Object.keys(TIPOS).sort().join()) {
  throw new Error('NO_VENDOR e TIPOS (spec.js) divergem.');
}
