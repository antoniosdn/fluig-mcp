/**
 * Leitor do arquivo `.process` (BPMN do Fluig Studio / Fluiggers) para a spec v1 (passo 5.2, base do plano B).
 *
 *   const { spec, origem, ignorados, avisos } = lerProcess(textoDoProcess);
 *
 * Espelha `lerXmlProcesso` (ler.js): mesmo formato de retorno e os mesmos códigos W_LEITOR_* / I_*
 * quando o caso existe nos dois formatos. Usa o parser e o leitor de condições do vendor Fluiggers 3.0.1.
 * Scripts não são lidos aqui (vêm à parte). Síncrona; lança só quando o texto não é um .process legível.
 *
 * Captura de erro de serviço automatizado com uma única saída e nenhuma entrada, para uma atividade conhecida:
 * é descartada e o serviço ganha `tratamentoErro: "s<destino>"`; `origem.capturas[sPai]` guarda o sequence da
 * captura e `origem.tratamentos[sPai]` os dígitos finais do id do fluxo captura → tratamento. Esse fluxo não
 * entra em `ligacoes` nem em `origem.linkSequences`.
 */
import { TIPOS, OPERADORES, EXECUCAO } from './spec.js';
import { carregarFluiggers } from './fluiggers.js';

const TIPO_POR_BPMN = {};
for (const [chave, def] of Object.entries(TIPOS)) TIPO_POR_BPMN[def.bpmnType] = chave;
const OP_POR_NUMERO = {};
for (const [chave, num] of Object.entries(OPERADORES)) OP_POR_NUMERO[num] = chave;
const EXECUCAO_POR_NUMERO = {};
for (const [chave, num] of Object.entries(EXECUCAO)) EXECUCAO_POR_NUMERO[num] = chave;

const aparar = (v) => (typeof v === 'string' ? v.trim() : '');
const inteiro = (v) => (/^-?\d+$/.test(aparar(v)) ? parseInt(aparar(v), 10) : NaN);

/** Atributos de elemento que não contam como "campo não guardado" (controle ou já consumidos). */
const CONSUMIDOS_ATIVIDADE = [
  'id',
  'name',
  'incoming',
  'outgoing',
  'type',
  'extendedFields',
  'managerMechanism',
  'managerAssignmentControllerString',
  'executionType',
  'parentTask',
  'sequenceAttached',
  'linkId',
  'condition',
];
const CONSUMIDOS_LIGACAO = ['id', 'name', 'sourceRef', 'targetRef', 'permiteRetorno', 'defaultLink', 'fluxoAutomatico', 'extendedFields'];
const CONSUMIDOS_PROCESSO = ['id', 'name', 'cardIndex', 'version', 'formSource', 'serverId', 'extendedFields'];

function camposNaoPadrao(atributos, consumidos) {
  const nomes = [];
  for (const [k, v] of Object.entries(atributos || {})) {
    if (consumidos.includes(k)) continue;
    const t = aparar(String(v));
    if (t === '' || t === '0' || t === 'false' || t === '0.0' || t === '<list/>') continue;
    nomes.push(k);
  }
  return nomes;
}

/** Dígitos finais do id (`task5` → 5), ou null. */
function sequenciaDoId(id) {
  const m = /(\d+)$/.exec(String(id || ''));
  return m ? parseInt(m[1], 10) : null;
}

/**
 * @param {string} texto conteúdo do .process
 * @returns {{spec: object, origem: object, ignorados: Array, avisos: Array}}
 */
export function lerProcess(texto) {
  const F = carregarFluiggers();
  const p = F.parseProcess(texto);
  if (!p || p.supported === false) {
    throw new Error('Arquivo não é um .process suportado pelo leitor (formato do Fluig Studio / Fluiggers 3.0.1).');
  }
  const proc = p.process;
  if (!proc || !proc.id) throw new Error('O .process não tem o elemento BpmnProcess com id.');

  const ignorados = [];
  const avisos = [];
  const ign = (codigo, mensagem, ref) => ignorados.push({ codigo, mensagem, ref });
  const avi = (codigo, mensagem, ref) => avisos.push({ codigo, mensagem, ref });

  const pa = proc.attributes || {};
  const spec = { processId: proc.id };
  if (aparar(pa.name) !== '') spec.descricao = pa.name;
  const formId = inteiro(pa.cardIndex);
  if (Number.isInteger(formId) && formId > 0) spec.formId = formId;
  const camposProc = camposNaoPadrao(pa, CONSUMIDOS_PROCESSO);
  if (camposProc.length > 0) {
    ign('I_PROCESSO_CAMPOS', `Campos do processo que a spec v1 não guarda: ${camposProc.join(', ')}.`, 'BpmnProcess');
  }

  const versaoNum = inteiro(pa.version);
  const origem = {
    processId: proc.id,
    versao: Number.isInteger(versaoNum) ? versaoNum : null,
    sequencias: {},
    capturas: {},
    tratamentos: {},
    linkSequences: [],
  };

  // Elementos: raias, processo e o resto (atividades).
  const nosAtividade = [];
  const outros = new Map();
  let raias = 0;
  for (const e of p.elements) {
    if (e.tag === 'BpmnProcess') continue;
    if (e.tag === 'BpmnSwimLane') {
      raias++;
      continue;
    }
    if (e.attributes && e.attributes.type !== undefined) nosAtividade.push(e);
    else outros.set(e.tag, (outros.get(e.tag) || 0) + 1);
  }

  const seqPorId = new Map();
  for (const e of nosAtividade) {
    const seq = sequenciaDoId(e.id);
    if (seq === null) throw new Error(`elemento ${e.id} sem sequence no id (o id precisa terminar em número, como task5).`);
    seqPorId.set(e.id, seq);
  }
  const estadoPorSeq = new Map();
  for (const e of nosAtividade) {
    const seq = seqPorId.get(e.id);
    if (!estadoPorSeq.has(seq)) estadoPorSeq.set(seq, e);
  }
  const bpmnDe = (e) => inteiro(e.attributes.type);

  const seqsComLigacao = new Set();
  for (const f of p.flows) {
    seqsComLigacao.add(sequenciaDoId(f.attributes.sourceRef));
    seqsComLigacao.add(sequenciaDoId(f.attributes.targetRef));
  }
  const ehServicoAutomatizado = (e) => !!e && bpmnDe(e) === 82 && inteiro(e.attributes.executionType) === 1;
  const capturasPorPai = new Set();
  for (const e of estadoPorSeq.values()) {
    if (bpmnDe(e) === 43) capturasPorPai.add(sequenciaDoId(e.attributes.parentTask));
  }

  // Captura de erro com tratamento: uma saída, nenhuma entrada, destino é atividade conhecida (não captura).
  const marcaPorCaptura = new Map(); // seq da captura -> marcas da ligação que impedem a absorção
  const tratamentoPorPai = new Map(); // seq do serviço -> { capSeq, destSeq, fluxo }
  const fluxosDeTratamento = new Set(); // objetos de p.flows absorvidos
  for (const e of estadoPorSeq.values()) {
    if (bpmnDe(e) !== 43) continue;
    const capSeq = seqPorId.get(e.id);
    const paiSeq = sequenciaDoId(e.attributes.parentTask);
    if (!ehServicoAutomatizado(estadoPorSeq.get(paiSeq)) || tratamentoPorPai.has(paiSeq)) continue;
    const saidas = p.flows.filter((f) => sequenciaDoId(f.attributes.sourceRef) === capSeq);
    const entradas = p.flows.filter((f) => sequenciaDoId(f.attributes.targetRef) === capSeq);
    if (saidas.length !== 1 || entradas.length !== 0) continue;
    const destSeq = sequenciaDoId(saidas[0].attributes.targetRef);
    const dest = estadoPorSeq.get(destSeq);
    if (!dest || bpmnDe(dest) === 43) continue;
    const fa = saidas[0].attributes;
    const marcas = ['permiteRetorno', 'fluxoAutomatico', 'defaultLink'].filter((c) => aparar(fa[c]).toLowerCase() === 'true');
    const extras = camposNaoPadrao(fa, CONSUMIDOS_LIGACAO);
    if (marcas.length > 0 || extras.length > 0) {
      marcaPorCaptura.set(capSeq, [...marcas, ...extras].join(', '));
      continue;
    }
    tratamentoPorPai.set(paiSeq, { capSeq, destSeq, fluxo: saidas[0] });
    fluxosDeTratamento.add(saidas[0]);
  }
  const capturasAbsorvidas = new Set([...tratamentoPorPai.values()].map((t) => t.capSeq));

  /* ------------------------------ atividades ------------------------------ */
  const atividades = [];
  const tipoPorSeq = new Map();
  const idPorSeq = new Map(); // seq -> id do elemento (para casar targetTask)
  const vistos = new Set();
  for (const no of nosAtividade) {
    const a = no.attributes;
    const seq = seqPorId.get(no.id);
    const id = `s${seq}`;
    if (vistos.has(seq)) {
      avi('W_LEITOR_SEQUENCE_DUPLICADA', `Sequence ${seq} repetido; a segunda ocorrência foi descartada.`, id);
      continue;
    }
    vistos.add(seq);
    const bpmn = bpmnDe(no);

    let tipo;
    if (bpmn === 43) {
      const paiSeq = sequenciaDoId(a.parentTask);
      const pai = estadoPorSeq.get(paiSeq);
      const paiOk = ehServicoAutomatizado(pai);
      const temLigacao = seqsComLigacao.has(seq);
      if (capturasAbsorvidas.has(seq)) {
        const t = tratamentoPorPai.get(paiSeq);
        ign(
          'I_CAPTURA_ERRO_REGERADA',
          `Captura de erro ${id} do serviço s${paiSeq} descartada: o gerador a recria a partir de tratamentoErro (s${t.destSeq}).`,
          id
        );
        origem.capturas[`s${paiSeq}`] = seq;
        const linkSeq = sequenciaDoId(t.fluxo.id);
        if (linkSeq !== null) origem.tratamentos[`s${paiSeq}`] = linkSeq;
        continue;
      }
      if (!temLigacao && paiOk) {
        ign(
          'I_CAPTURA_ERRO_REGERADA',
          `Captura de erro ${id} do serviço s${paiSeq} descartada: o gerador recria a captura de erro do serviço automatizado.`,
          id
        );
        avi(
          'W_LEITOR_CAPTURA_SEM_TRATAMENTO',
          `O serviço automatizado s${paiSeq} não tem tratamento do erro (a captura não tem saída); indique tratamentoErro antes de gerar de novo.`,
          `s${paiSeq}`
        );
        origem.capturas[`s${paiSeq}`] = seq;
        continue;
      }
      tipo = 'captura_erro';
      if (temLigacao) {
        avi(
          'W_LEITOR_FLUXO_ERRO',
          `A captura de erro ${id} tem ligações fora do formato da v1 (uma única saída para a atividade de tratamento)${
            marcaPorCaptura.has(seq) ? `; a ligação tem: ${marcaPorCaptura.get(seq)}` : ''
          }.`,
          id
        );
      }
      if (!paiOk) {
        avi(
          'W_LEITOR_CAPTURA_ERRO_PAI',
          `A captura de erro ${id} não está ligada a um serviço automatizado (executionType 1); o Studio só permite captura nesse caso.`,
          id
        );
      }
    } else if (TIPO_POR_BPMN[bpmn] !== undefined) {
      tipo = TIPO_POR_BPMN[bpmn];
    } else if (bpmn === 32) {
      tipo = 'espera';
    } else if (bpmn === 100 || bpmn === 101) {
      tipo = 'subprocesso';
    } else {
      const rotulo = Number.isInteger(bpmn) ? String(bpmn) : aparar(a.type) || 'vazio';
      tipo = `bpmn_${rotulo}`;
      avi('W_LEITOR_TIPO_DESCONHECIDO', `Tipo de atividade desconhecido (bpmnType ${rotulo}) em ${id}.`, id);
    }

    let nome = aparar(a.name);
    if (nome === '') {
      nome = `Atividade ${seq}`;
      avi('W_LEITOR_NOME_VAZIO', `A atividade ${id} não tem nome; ficou "${nome}".`, id);
    }
    const ativ = { id, tipo, nome };

    // responsável
    const mecanismo = aparar(a.managerMechanism);
    if (tipo === 'humana') {
      if (mecanismo === 'Papel' || mecanismo === 'Pool Papel') {
        let papel = '';
        try {
          papel = aparar(F.gateway.parseAssignmentController(a.managerAssignmentControllerString || '').roleId);
        } catch (_) {
          papel = '';
        }
        if (papel === '') {
          avi(
            'W_LEITOR_ATRIBUICAO_INVALIDA',
            `A atribuição "${mecanismo}" de ${id} não tem papel (Role) legível; a atividade ficou sem responsável.`,
            id
          );
        } else {
          ativ.responsavel = { tipo: mecanismo === 'Papel' ? 'papel' : 'pool_papel', valor: papel };
        }
      } else if (mecanismo !== '') {
        avi(
          'W_LEITOR_ATRIBUICAO_FORA_V1',
          `A atribuição "${mecanismo}" de ${id} não cabe na v1 (configuração: ${aparar(a.managerAssignmentControllerString) || 'vazia'}); a atividade ficou sem responsável.`,
          id
        );
      }
    } else if (mecanismo !== '') {
      ign(
        'I_ATRIBUICAO_NAO_HUMANA',
        `A atividade ${id} (${tipo}) tem atribuição "${mecanismo}"; a v1 só guarda responsável em atividade humana.`,
        id
      );
    }

    // execução
    const execTexto = aparar(a.executionType);
    const exec = inteiro(a.executionType);
    if (tipo === 'servico') {
      if (EXECUCAO_POR_NUMERO[exec] !== undefined) ativ.execucao = EXECUCAO_POR_NUMERO[exec];
      else {
        avi('W_LEITOR_EXECUCAO', `O serviço ${id} tem executionType "${execTexto}" (esperado 1 ou 2); ficou sem execução.`, id);
      }
      if (exec === 1 && !capturasPorPai.has(seq)) {
        avi(
          'W_LEITOR_SERVICO_SEM_CAPTURA',
          `O serviço automatizado ${id} não tem captura de erro; o Studio considera erro e o gerador vai criar uma.`,
          id
        );
      }
    } else if (execTexto !== '' && execTexto !== '0') {
      ign('I_EXECUCAO_FORA_SERVICO', `A atividade ${id} (${tipo}) tem executionType ${execTexto}; só vale para serviço.`, id);
    }

    if (no.shape && Number.isFinite(Number(no.shape.x)) && Number.isFinite(Number(no.shape.y))) {
      ativ.posicao = { x: Number(no.shape.x), y: Number(no.shape.y) };
    }

    const extras = camposNaoPadrao(a, CONSUMIDOS_ATIVIDADE);
    if (extras.length > 0) ign('I_ATIVIDADE_CAMPOS', `Campos de ${id} que a spec v1 não guarda: ${extras.join(', ')}.`, id);

    const ordenada = { id: ativ.id, tipo: ativ.tipo, nome: ativ.nome };
    if (ativ.responsavel) ordenada.responsavel = ativ.responsavel;
    if (ativ.execucao) ordenada.execucao = ativ.execucao;
    if (tratamentoPorPai.has(seq) && tipo === 'servico') ordenada.tratamentoErro = `s${tratamentoPorPai.get(seq).destSeq}`;
    if (ativ.posicao) ordenada.posicao = ativ.posicao;
    atividades.push(ordenada);
    tipoPorSeq.set(seq, tipo);
    idPorSeq.set(seq, no.id);
    origem.sequencias[id] = seq;
  }
  spec.atividades = atividades;

  /* ------------------------------ ligações e condições ------------------------------ */
  // Condições de cada gateway, lidas do atributo `condition`.
  const condicoesPorGateway = new Map(); // seq -> [{ c, usada }]
  for (const no of nosAtividade) {
    if (bpmnDe(no) !== 120 || !aparar(no.attributes.condition)) continue;
    const seq = seqPorId.get(no.id);
    let lidas;
    try {
      lidas = F.gateway.parseGatewayConditions(no.attributes.condition);
    } catch (_) {
      lidas = { supported: false, conditions: [] };
    }
    if (!lidas || lidas.supported === false) {
      avi('W_LEITOR_CONDICAO_ILEGIVEL', `As condições do gateway s${seq} não puderam ser lidas; as saídas ficaram sem condição.`, `s${seq}`);
      continue;
    }
    condicoesPorGateway.set(
      seq,
      lidas.conditions.map((c) => ({ c, usada: false }))
    );
  }

  const construirCondicao = (c, rot, ref) => {
    const cond = {};
    if (inteiro(c.conditionType) === 1) {
      if (c.rulesSupported === false) {
        avi('W_LEITOR_CONDICAO_ILEGIVEL', `As regras da condição da ligação ${rot} não puderam ser lidas (${c.rulesIssue || 'sem detalhe'}).`, ref);
      }
      const regras = (c.rules || [])
        .slice()
        .sort((x, y) => (x.ruleOrder || 0) - (y.ruleOrder || 0))
        .map((r) => {
          const campo = aparar(r.field);
          const numOp = inteiro(String(r.operator));
          let op;
          if (OP_POR_NUMERO[numOp] !== undefined) op = OP_POR_NUMERO[numOp];
          else {
            op = `operador_${Number.isInteger(numOp) ? numOp : aparar(String(r.operator)) || 'vazio'}`;
            avi('W_LEITOR_OPERADOR', `Operador ${aparar(String(r.operator))} desconhecido na condição da ligação ${rot}.`, ref);
          }
          const regra = { campo, op };
          const valor = r.value === undefined || r.value === null ? '' : String(r.value);
          if (valor !== '') regra.valor = valor;
          const vt = aparar(String(r.valueType === undefined ? '' : r.valueType));
          if (vt === '0') regra.valorTipo = 'campo';
          else if (vt !== '' && vt !== '1') {
            avi('W_LEITOR_VALOR_TIPO', `valueType "${vt}" desconhecido na condição da ligação ${rot}; tratado como valor fixo.`, ref);
          }
          return regra;
        });
      if (regras.length === 0) {
        avi('W_LEITOR_CONDICAO_SEM_REGRAS', `A condição da ligação ${rot} é por regras mas não tem nenhuma regra.`, ref);
      }
      cond.regras = regras;
    } else {
      if (aparar(c.conditionType) !== '' && inteiro(c.conditionType) !== 0) {
        avi('W_LEITOR_CONDICAO_TIPO', `conditionType "${aparar(c.conditionType)}" desconhecido na condição da ligação ${rot}; lida como JavaScript.`, ref);
      }
      cond.js = c.expression || '';
    }
    if (aparar(c.mechanism) !== '' || aparar(c.mechanismConfiguration || '') !== '') {
      ign('I_CONDICAO_ATRIBUICAO', `A condição da ligação ${rot} tem atribuição, que a v1 não guarda.`, ref);
    }
    return cond;
  };

  const ligacoes = [];
  const alvosUsados = new Set();
  for (const f of p.flows) {
    if (fluxosDeTratamento.has(f)) continue;
    const fa = f.attributes;
    const de = sequenciaDoId(fa.sourceRef);
    const para = sequenciaDoId(fa.targetRef);
    const rot = `s${de === null ? '?' : de}→s${para === null ? '?' : para}`;
    const ref = `ligacao ${rot}`;
    if (aparar(fa.fluxoAutomatico).toLowerCase() === 'true') {
      const gemea = p.flows.some(
        (o) =>
          o !== f &&
          aparar(o.attributes.fluxoAutomatico).toLowerCase() !== 'true' &&
          sequenciaDoId(o.attributes.sourceRef) === de &&
          sequenciaDoId(o.attributes.targetRef) === para
      );
      if (gemea) {
        avi(
          'W_LEITOR_FLUXO_AUTOMATICO_DESCARTADO',
          `A ligação ${rot} é um fluxo automático por prazo, fora da v1, ao lado da ligação manual ${rot}; foi descartada e a manual ficou.`,
          ref
        );
        continue;
      }
    }
    const linkSeq = sequenciaDoId(f.id);
    const retorno = aparar(fa.permiteRetorno).toLowerCase() === 'true';

    let padrao = aparar(fa.defaultLink).toLowerCase() === 'true';
    const finalizar = (ordem, condicao) => {
      const saida = { de: `s${de}`, para: `s${para}` };
      if (ordem !== undefined) saida.ordem = ordem;
      if (condicao !== undefined) saida.condicao = condicao;
      if (retorno) saida.retorno = true;
      if (padrao) saida.padrao = true;
      ligacoes.push(saida);
      origem.linkSequences.push(linkSeq);
    };

    if (!tipoPorSeq.has(de) || !tipoPorSeq.has(para)) {
      avi('W_LEITOR_LIGACAO_ORFA', `A ligação ${rot} aponta para uma atividade que não existe.`, ref);
    }
    if (aparar(fa.fluxoAutomatico).toLowerCase() === 'true') {
      avi(
        'W_LEITOR_FLUXO_AUTOMATICO',
        `A ligação ${rot} é um fluxo automático por prazo; na spec vira ligação comum, o que muda o comportamento.`,
        ref
      );
    }
    const extras = camposNaoPadrao(fa, CONSUMIDOS_LIGACAO);
    if (extras.length > 0) ign('I_LIGACAO_CAMPOS', `Campos da ligação ${rot} que a spec v1 não guarda: ${extras.join(', ')}.`, ref);

    if (padrao && tipoPorSeq.get(de) !== 'gateway_exclusivo') {
      avi(
        'W_LEITOR_PADRAO_FORA_GATEWAY',
        `A ligação ${rot} está marcada como padrão (defaultLink) mas não sai de gateway exclusivo; a marca foi ignorada.`,
        ref
      );
      padrao = false;
    }

    if (tipoPorSeq.get(de) === 'gateway_exclusivo') {
      const chave = `${de}->${para}`;
      if (alvosUsados.has(chave)) {
        avi('W_LEITOR_LIGACAO_REPETIDA', `O gateway s${de} tem mais de uma ligação para s${para}; as condições ficaram na primeira.`, ref);
        finalizar(undefined, undefined);
        continue;
      }
      alvosUsados.add(chave);
      const alvoId = fa.targetRef;
      const doDestino = (condicoesPorGateway.get(de) || [])
        .filter((x) => x.c.targetTask === alvoId)
        .sort((x, y) => (x.c.order || 0) - (y.c.order || 0));
      if (doDestino.length === 0) {
        if (!padrao) avi('W_LEITOR_GATEWAY_SEM_CONDICAO', `A saída ${rot} do gateway não tem condição.`, ref);
        finalizar(undefined, undefined);
        continue;
      }
      for (const x of doDestino) {
        x.usada = true;
        const ordem = Number.isInteger(x.c.order) ? x.c.order : undefined;
        finalizar(ordem, construirCondicao(x.c, rot, ref));
      }
    } else {
      finalizar(undefined, undefined);
    }
  }
  spec.ligacoes = ligacoes;

  for (const [seq, lista] of condicoesPorGateway) {
    for (const x of lista) {
      if (x.usada) continue;
      avi(
        'W_LEITOR_CONDICAO_SEM_LIGACAO',
        `A condição ${x.c.order} do estado s${seq} para ${x.c.targetTask} não tem ligação de gateway exclusivo correspondente; foi descartada.`,
        `ligacao s${seq}→${x.c.targetTask}`
      );
    }
  }

  /* ------------------------------ o que a v1 não guarda ------------------------------ */
  if (raias > 0) ign('I_RAIAS', `${raias} ${raias === 1 ? 'raia (SwimLane) ignorada' : 'raias (SwimLane) ignoradas'}.`, 'BpmnSwimLane');
  for (const [tag, qtd] of outros) {
    ign('I_ELEMENTO', `${qtd} ${qtd === 1 ? 'elemento' : 'elementos'} ${tag} ${qtd === 1 ? 'ignorado' : 'ignorados'}.`, tag);
  }

  const ordenada = { processId: spec.processId };
  if (spec.descricao !== undefined) ordenada.descricao = spec.descricao;
  if (spec.formId !== undefined) ordenada.formId = spec.formId;
  ordenada.atividades = spec.atividades;
  ordenada.ligacoes = spec.ligacoes;
  return { spec: ordenada, origem, ignorados, avisos };
}
