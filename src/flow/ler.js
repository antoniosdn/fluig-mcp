/**
 * Leitor do XML ECM30 de um processo Fluig para a spec v1 do gerador de fluxo.
 *
 *   const { spec, origem, ignorados, avisos } = lerXmlProcesso(xmlTexto);
 *
 * - spec: spec v1 (formato de spec.js), sem campos extras.
 * - origem: o que só serve para ida e volta (fora da spec):
 *     { processId, versao, sequencias: { [idAtividade]: number }, linkSequences: number[] }
 * - ignorados: informação do XML que a v1 não guarda (perda esperada).
 * - avisos: inconsistência no XML, ou perda que muda o comportamento do processo.
 *   Item = { codigo, mensagem, ref }.
 *
 * Função síncrona e pura. Só lança quando o texto não é um XML ECM30 legível
 * (erro do parser, raiz que não é <list>, sem ProcessDefinition/processId/ProcessState).
 */
import { TIPOS, OPERADORES, EXECUCAO } from './spec.js';
import { parseXml, filho, textoDe } from './xml.js';

const ELEMENTOS_CONHECIDOS = [
  'ProcessDefinition',
  'ProcessDefinitionVersion',
  'ProcessState',
  'ProcessLink',
  'ConditionProcessState',
  'ConditionProcessAutomaticRules',
];

/** Campos que nunca entram na lista de "valor não padrão" (3.7). */
const CAMPOS_CONTROLE = [
  'companyId',
  'processId',
  'version',
  'openInstances',
  'destinationStates',
  'processStates',
  'stateType',
  'bpmnType',
  'automatic',
  'positionX',
  'positionY',
  'parentSequence',
  'initialState',
];

const CONSUMIDOS_PROCESSO = ['processDescription', 'formId', 'formIdV2', 'processDiagram'];
const CONSUMIDOS_ATIVIDADE = [
  'stateName',
  'stateDescription',
  'engineAllocationId',
  'engineAllocationConfiguration',
  'executionType',
];
const CONSUMIDOS_LIGACAO = ['initialStateSequence', 'finalStateSequence', 'returnPermited', 'automaticLink'];

// bpmnType -> chave de TIPOS
const TIPO_POR_BPMN = {};
for (const [chave, def] of Object.entries(TIPOS)) TIPO_POR_BPMN[def.bpmnType] = chave;

// operator -> chave de OPERADORES
const OP_POR_NUMERO = {};
for (const [chave, num] of Object.entries(OPERADORES)) OP_POR_NUMERO[num] = chave;

const EXECUCAO_POR_NUMERO = {};
for (const [chave, num] of Object.entries(EXECUCAO)) EXECUCAO_POR_NUMERO[num] = chave;

const aparar = (v) => (typeof v === 'string' ? v.trim() : '');
const vazio = (v) => aparar(v) === '';

/** Inteiro de um texto, ou NaN. */
function inteiro(v) {
  const t = aparar(v);
  return /^-?\d+$/.test(t) ? parseInt(t, 10) : NaN;
}

/** Nomes (sem repetição, na ordem do documento) dos campos com valor não padrão. */
function camposNaoPadrao(no, consumidos) {
  const nomes = [];
  for (const f of no.filhos) {
    if (nomes.includes(f.nome)) continue;
    if (f.nome.endsWith('PK')) continue;
    if (CAMPOS_CONTROLE.includes(f.nome) || consumidos.includes(f.nome)) continue;
    const t = aparar(f.texto);
    if (t === '' || t === '0' || t === 'false') continue;
    nomes.push(f.nome);
  }
  return nomes;
}

/**
 * Lê o XML ECM30 e devolve a spec v1 com o que não coube nela.
 * @param {string} xml
 * @returns {{spec: object, origem: object, ignorados: Array, avisos: Array}}
 */
export function lerXmlProcesso(xml) {
  const raiz = parseXml(xml);
  if (raiz.nome !== 'list') {
    throw new Error(`XML não é um ECM30 de processo: a raiz deve ser <list> (veio <${raiz.nome}>).`);
  }

  // 3.1 — elementos de interesse, na ordem do documento
  const elementos = [];
  for (const c of raiz.filhos) {
    if (c.nome === 'list') elementos.push(...c.filhos);
    else elementos.push(c);
  }
  const porNome = (nome) => elementos.filter((e) => e.nome === nome);

  const defProcesso = porNome('ProcessDefinition')[0];
  if (!defProcesso) throw new Error('XML não é um ECM30 de processo: falta o elemento ProcessDefinition.');
  const processId = aparar(textoDe(filho(defProcesso, 'processDefinitionPK'), 'processId'));
  if (processId === '') {
    throw new Error('XML não é um ECM30 de processo: falta ProcessDefinition/processDefinitionPK/processId.');
  }
  const nosEstado = porNome('ProcessState');
  if (nosEstado.length === 0) throw new Error('XML não é um ECM30 de processo: não há nenhum ProcessState.');

  const ignorados = [];
  const avisos = [];
  const ign = (codigo, mensagem, ref) => ignorados.push({ codigo, mensagem, ref });
  const avi = (codigo, mensagem, ref) => avisos.push({ codigo, mensagem, ref });

  const versaoProcesso = porNome('ProcessDefinitionVersion')[0];

  /* ---------------------------------------------------------------- */
  /* 3.2 Processo                                                      */
  /* ---------------------------------------------------------------- */
  const spec = { processId };
  const descricao = textoDe(defProcesso, 'processDescription');
  if (!vazio(descricao)) spec.descricao = descricao;

  const formId = inteiro(textoDe(versaoProcesso, 'formId'));
  if (Number.isInteger(formId) && formId > 0) spec.formId = formId;
  const formIdV2 = inteiro(textoDe(versaoProcesso, 'formIdV2'));
  if (Number.isInteger(formIdV2) && formIdV2 > 0) {
    avi(
      'W_LEITOR_FORMID_V2',
      `O processo usa formulário do Form Builder (formIdV2 ${formIdV2}); a v1 não confere os campos dele.`,
      'ProcessDefinitionVersion'
    );
  }

  const camposProcesso = [];
  for (const no of [defProcesso, versaoProcesso]) {
    if (!no) continue;
    for (const nome of camposNaoPadrao(no, CONSUMIDOS_PROCESSO)) {
      if (!camposProcesso.includes(nome)) camposProcesso.push(nome);
    }
  }
  if (camposProcesso.length > 0) {
    ign('I_PROCESSO_CAMPOS', `Campos do processo que a spec v1 não guarda: ${camposProcesso.join(', ')}.`, 'ProcessDefinition');
  }
  if (versaoProcesso && !vazio(textoDe(versaoProcesso, 'processDiagram'))) {
    ign('I_DIAGRAMA', 'O desenho do processo (processDiagram) não é guardado na spec v1.', 'ProcessDefinitionVersion');
  }

  const versaoNum = inteiro(textoDe(filho(versaoProcesso, 'processDefinitionVersionPK'), 'version'));
  const origem = {
    processId,
    versao: Number.isInteger(versaoNum) ? versaoNum : null,
    sequencias: {},
    linkSequences: [],
  };

  /* ---------------------------------------------------------------- */
  /* Levantamento prévio: estados (sem duplicados) e ligações          */
  /* ---------------------------------------------------------------- */
  const lerEstado = (no) => {
    const pk = filho(no, 'processStatePK');
    return {
      no,
      seq: inteiro(textoDe(pk, 'sequence')),
      bpmn: inteiro(textoDe(no, 'bpmnType')),
      bpmnTexto: aparar(textoDe(no, 'bpmnType')),
      exec: inteiro(textoDe(no, 'executionType')),
      pai: inteiro(textoDe(no, 'parentSequence')),
    };
  };
  const estadoPorSeq = new Map();
  for (const no of nosEstado) {
    const e = lerEstado(no);
    if (Number.isInteger(e.seq) && !estadoPorSeq.has(e.seq)) estadoPorSeq.set(e.seq, e);
  }

  const nosLigacao = porNome('ProcessLink');
  const seqsComLigacao = new Set();
  for (const l of nosLigacao) {
    seqsComLigacao.add(inteiro(textoDe(l, 'initialStateSequence')));
    seqsComLigacao.add(inteiro(textoDe(l, 'finalStateSequence')));
  }

  const ehServicoAutomatizado = (e) => !!e && e.bpmn === 82 && e.exec === 1;
  const capturasPorPai = new Set();
  for (const e of estadoPorSeq.values()) {
    if (e.bpmn === 43 && Number.isInteger(e.pai)) capturasPorPai.add(e.pai);
  }

  /* ---------------------------------------------------------------- */
  /* 3.3 / 3.4 Atividades                                              */
  /* ---------------------------------------------------------------- */
  const atividades = [];
  const tipoPorSeq = new Map(); // seq -> tipo da spec (só atividades mantidas)
  const vistos = new Set();

  for (const no of nosEstado) {
    const e = lerEstado(no);
    if (!Number.isInteger(e.seq)) {
      avi(
        'W_LEITOR_SEQUENCE_INVALIDA',
        `Atividade "${aparar(textoDe(no, 'stateName'))}" sem sequence numérico em processStatePK; foi descartada.`,
        'ProcessState'
      );
      continue;
    }
    const id = `s${e.seq}`;
    if (vistos.has(e.seq)) {
      avi('W_LEITOR_SEQUENCE_DUPLICADA', `Sequence ${e.seq} repetido; a segunda ocorrência foi descartada.`, id);
      continue;
    }
    vistos.add(e.seq);

    // tipo
    let tipo;
    let descartada = false;
    if (e.bpmn === 43) {
      const pai = estadoPorSeq.get(e.pai);
      const paiOk = ehServicoAutomatizado(pai);
      const temLigacao = seqsComLigacao.has(e.seq);
      if (!temLigacao && paiOk) {
        ign(
          'I_CAPTURA_ERRO_REGERADA',
          `Captura de erro ${id} do serviço s${pai.seq} descartada: o gerador recria a captura de erro do serviço automatizado.`,
          id
        );
        descartada = true;
      } else {
        tipo = 'captura_erro';
        if (temLigacao) {
          avi(
            'W_LEITOR_FLUXO_ERRO',
            `A captura de erro ${id} tem fluxo de tratamento; a v1 não modela o fluxo de erro.`,
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
      }
    } else if (TIPO_POR_BPMN[e.bpmn] !== undefined) {
      tipo = TIPO_POR_BPMN[e.bpmn];
    } else if (e.bpmn === 32) {
      tipo = 'espera';
    } else if (e.bpmn === 100 || e.bpmn === 101) {
      tipo = 'subprocesso';
    } else {
      const rotulo = Number.isInteger(e.bpmn) ? String(e.bpmn) : e.bpmnTexto || 'vazio';
      tipo = `bpmn_${rotulo}`;
      avi('W_LEITOR_TIPO_DESCONHECIDO', `Tipo de atividade desconhecido (bpmnType ${rotulo}) em ${id}.`, id);
    }
    if (descartada) continue;

    // nome
    let nome = aparar(textoDe(no, 'stateName'));
    if (nome === '') nome = aparar(textoDe(no, 'stateDescription'));
    if (nome === '') {
      nome = `Atividade ${e.seq}`;
      avi('W_LEITOR_NOME_VAZIO', `A atividade ${id} não tem nome; ficou "${nome}".`, id);
    }

    const ativ = { id, tipo, nome };

    // responsável
    const mecanismo = aparar(textoDe(no, 'engineAllocationId'));
    const configuracao = textoDe(no, 'engineAllocationConfiguration') || '';
    if (tipo === 'humana') {
      if (mecanismo === 'Papel' || mecanismo === 'Pool Papel') {
        let papel = '';
        try {
          const cfg = parseXml(configuracao);
          papel = aparar(textoDe(cfg, 'Role'));
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
          `A atribuição "${mecanismo}" de ${id} não cabe na v1 (configuração: ${aparar(configuracao) || 'vazia'}); a atividade ficou sem responsável.`,
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
    const execTexto = aparar(textoDe(no, 'executionType'));
    if (tipo === 'servico') {
      if (EXECUCAO_POR_NUMERO[e.exec] !== undefined) {
        ativ.execucao = EXECUCAO_POR_NUMERO[e.exec];
      } else {
        avi(
          'W_LEITOR_EXECUCAO',
          `O serviço ${id} tem executionType "${execTexto}" (esperado 1 ou 2); ficou sem execução.`,
          id
        );
      }
      if (e.exec === 1 && !capturasPorPai.has(e.seq)) {
        avi(
          'W_LEITOR_SERVICO_SEM_CAPTURA',
          `O serviço automatizado ${id} não tem captura de erro; o Studio considera erro e o gerador vai criar uma.`,
          id
        );
      }
    } else if (execTexto !== '' && execTexto !== '0') {
      ign(
        'I_EXECUCAO_FORA_SERVICO',
        `A atividade ${id} (${tipo}) tem executionType ${execTexto}; só vale para serviço.`,
        id
      );
    }

    // posição
    const px = aparar(textoDe(no, 'positionX'));
    const py = aparar(textoDe(no, 'positionY'));
    if (px !== '' && py !== '' && Number.isFinite(Number(px)) && Number.isFinite(Number(py))) {
      ativ.posicao = { x: Number(px), y: Number(py) };
    }

    const outros = camposNaoPadrao(no, CONSUMIDOS_ATIVIDADE);
    if (outros.length > 0) {
      ign('I_ATIVIDADE_CAMPOS', `Campos de ${id} que a spec v1 não guarda: ${outros.join(', ')}.`, id);
    }

    // ordem das chaves: id, tipo, nome, responsavel, execucao, posicao
    const ordenada = { id: ativ.id, tipo: ativ.tipo, nome: ativ.nome };
    if (ativ.responsavel) ordenada.responsavel = ativ.responsavel;
    if (ativ.execucao) ordenada.execucao = ativ.execucao;
    if (ativ.posicao) ordenada.posicao = ativ.posicao;
    atividades.push(ordenada);
    tipoPorSeq.set(e.seq, tipo);
    origem.sequencias[id] = e.seq;
  }
  spec.atividades = atividades;

  /* ---------------------------------------------------------------- */
  /* 3.5 Ligações e condições                                          */
  /* ---------------------------------------------------------------- */
  const condicoes = porNome('ConditionProcessState').map((no) => {
    const pk = filho(no, 'conditionProcessStatePK');
    return {
      no,
      seq: inteiro(textoDe(pk, 'sequence')),
      ordem: inteiro(textoDe(pk, 'expressionOrder')),
      destino: inteiro(textoDe(no, 'destinationSequenceId')),
      tipo: vazio(textoDe(no, 'conditionType')) ? 0 : inteiro(textoDe(no, 'conditionType')),
      usada: false,
    };
  });
  const regrasXml = porNome('ConditionProcessAutomaticRules').map((no) => ({
    no,
    seq: inteiro(textoDe(no, 'sequence')),
    ordem: inteiro(textoDe(no, 'expressionOrder')),
    regra: inteiro(textoDe(no, 'ruleOrder')),
  }));

  const construirCondicao = (c, refLigacao) => {
    const rotLigacao = refLigacao.replace(/^ligacao /, '');
    const cond = {};
    if (c.tipo === 1) {
      const regras = regrasXml
        .filter((r) => r.seq === c.seq && r.ordem === c.ordem)
        .sort((a, b) => (a.regra || 0) - (b.regra || 0))
        .map((r) => {
          const campo = aparar(textoDe(r.no, 'field'));
          const numOp = inteiro(textoDe(r.no, 'operator'));
          let op;
          if (OP_POR_NUMERO[numOp] !== undefined) {
            op = OP_POR_NUMERO[numOp];
          } else {
            op = `operador_${Number.isInteger(numOp) ? numOp : aparar(textoDe(r.no, 'operator')) || 'vazio'}`;
            avi('W_LEITOR_OPERADOR', `Operador ${aparar(textoDe(r.no, 'operator'))} desconhecido na condição da ligação ${rotLigacao}.`, refLigacao);
          }
          const regra = { campo, op };
          const valor = textoDe(r.no, 'value') || '';
          if (valor !== '') regra.valor = valor;
          const vt = aparar(textoDe(r.no, 'valueType'));
          if (vt === '0') {
            regra.valorTipo = 'campo';
          } else if (vt !== '' && vt !== '1') {
            avi('W_LEITOR_VALOR_TIPO', `valueType "${vt}" desconhecido na condição da ligação ${rotLigacao}; tratado como valor fixo.`, refLigacao);
          }
          return regra;
        });
      if (regras.length === 0) {
        avi('W_LEITOR_CONDICAO_SEM_REGRAS', `A condição da ligação ${rotLigacao} é por regras mas não tem nenhuma regra.`, refLigacao);
      }
      cond.regras = regras;
    } else {
      if (c.tipo !== 0) {
        avi(
          'W_LEITOR_CONDICAO_TIPO',
          `conditionType "${aparar(textoDe(c.no, 'conditionType'))}" desconhecido na condição da ligação ${rotLigacao}; lida como JavaScript.`,
          refLigacao
        );
      }
      cond.js = textoDe(c.no, 'condition') || '';
    }
    const nomeCond = aparar(textoDe(c.no, 'conditionName'));
    if (nomeCond !== '') cond.nome = nomeCond;
    if (!vazio(textoDe(c.no, 'engineAllocationId')) || !vazio(textoDe(c.no, 'engineAllocationConfiguration'))) {
      ign('I_CONDICAO_ATRIBUICAO', `A condição da ligação ${rotLigacao} tem atribuição, que a v1 não guarda.`, refLigacao);
    }
    return cond;
  };

  const ligacoes = [];
  const alvosUsados = new Set(); // "de->para" de gateways já atendidos
  for (const nl of nosLigacao) {
    const de = inteiro(textoDe(nl, 'initialStateSequence'));
    const para = inteiro(textoDe(nl, 'finalStateSequence'));
    const rot = `s${Number.isNaN(de) ? '?' : de}→s${Number.isNaN(para) ? '?' : para}`;
    const ref = `ligacao ${rot}`;
    const linkSeq = inteiro(textoDe(filho(nl, 'processLinkPK'), 'linkSequence'));
    const linkSeqValor = Number.isInteger(linkSeq) ? linkSeq : null;
    const retorno = aparar(textoDe(nl, 'returnPermited')).toLowerCase() === 'true';

    const base = () => {
      const l = { de: `s${de}`, para: `s${para}` };
      return l;
    };
    const finalizar = (l, ordem, condicao) => {
      const saida = { de: l.de, para: l.para };
      if (ordem !== undefined) saida.ordem = ordem;
      if (condicao !== undefined) saida.condicao = condicao;
      if (retorno) saida.retorno = true;
      ligacoes.push(saida);
      origem.linkSequences.push(linkSeqValor);
    };

    if (!tipoPorSeq.has(de) || !tipoPorSeq.has(para)) {
      avi('W_LEITOR_LIGACAO_ORFA', `A ligação ${rot} aponta para uma atividade que não existe.`, ref);
    }
    if (aparar(textoDe(nl, 'automaticLink')).toLowerCase() === 'true') {
      avi(
        'W_LEITOR_FLUXO_AUTOMATICO',
        `A ligação ${rot} é um fluxo automático por prazo; na spec vira ligação comum, o que muda o comportamento.`,
        ref
      );
    }
    const extras = camposNaoPadrao(nl, CONSUMIDOS_LIGACAO);
    if (extras.length > 0) {
      ign('I_LIGACAO_CAMPOS', `Campos da ligação ${rot} que a spec v1 não guarda: ${extras.join(', ')}.`, ref);
    }

    const l = base();
    if (tipoPorSeq.get(de) === 'gateway_exclusivo') {
      const chave = `${de}->${para}`;
      if (alvosUsados.has(chave)) {
        avi(
          'W_LEITOR_LIGACAO_REPETIDA',
          `O gateway s${de} tem mais de uma ligação para s${para}; as condições ficaram na primeira.`,
          ref
        );
        finalizar(l, undefined, undefined);
        continue;
      }
      alvosUsados.add(chave);
      const doDestino = condicoes
        .filter((c) => c.seq === de && c.destino === para)
        .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
      if (doDestino.length === 0) {
        avi('W_LEITOR_GATEWAY_SEM_CONDICAO', `A saída ${rot} do gateway não tem condição.`, ref);
        finalizar(l, undefined, undefined);
        continue;
      }
      doDestino.forEach((c) => {
        c.usada = true;
        const ordem = Number.isInteger(c.ordem) ? c.ordem : undefined;
        finalizar(l, ordem, construirCondicao(c, ref));
      });
    } else {
      finalizar(l, undefined, undefined);
    }
  }
  spec.ligacoes = ligacoes;

  // sobras
  for (const c of condicoes) {
    if (c.usada) continue;
    const ref = `ligacao s${c.seq}→s${c.destino}`;
    avi(
      'W_LEITOR_CONDICAO_SEM_LIGACAO',
      `A condição ${c.ordem} do estado s${c.seq} para s${c.destino} não tem ligação de gateway exclusivo correspondente; foi descartada.`,
      ref
    );
  }
  const chavesTipo1 = new Set(condicoes.filter((c) => c.tipo === 1).map((c) => `${c.seq}:${c.ordem}`));
  for (const r of regrasXml) {
    if (!chavesTipo1.has(`${r.seq}:${r.ordem}`)) {
      avi(
        'W_LEITOR_REGRA_ORFA',
        `Regra automática do estado s${r.seq} (ordem ${r.ordem}) sem condição por regras correspondente; foi descartada.`,
        `s${r.seq}`
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /* 3.6 Elementos inteiros que a v1 não guarda                        */
  /* ---------------------------------------------------------------- */
  const nomesRestantes = [];
  for (const e of elementos) {
    if (ELEMENTOS_CONHECIDOS.includes(e.nome)) continue;
    if (!nomesRestantes.includes(e.nome)) nomesRestantes.push(e.nome);
  }
  for (const nome of nomesRestantes) {
    const lista = porNome(nome);
    const qtd = lista.length;
    if (nome === 'SwimLane') {
      ign('I_RAIAS', `${qtd} ${qtd === 1 ? 'raia (SwimLane) ignorada' : 'raias (SwimLane) ignoradas'}.`, nome);
    } else if (nome === 'ProcessLinkBend' || nome === 'ProcessLinkAssoc' || nome === 'ProcessComponGraf') {
      ign('I_DESENHO', `${qtd} ${qtd === 1 ? 'elemento' : 'elementos'} de desenho (${nome}) ${qtd === 1 ? 'ignorado' : 'ignorados'}.`, nome);
    } else if (nome === 'WorkflowProcessEvent') {
      const ids = lista.map((n) => aparar(textoDe(filho(n, 'workflowProcessEventPK'), 'eventId')) || '?');
      ign('I_SCRIPTS', `${qtd} ${qtd === 1 ? 'script de evento ignorado' : 'scripts de evento ignorados'}: ${ids.join(', ')}.`, nome);
    } else if (nome === 'ProcessStateService') {
      for (const n of lista) {
        const seq = inteiro(textoDe(n, 'sequence'));
        const id = Number.isInteger(seq) ? `s${seq}` : nome;
        const campos = ['attempts', 'frequency', 'frequencyType', 'serviceName', 'sucessFullMessage']
          .filter((k) => !vazio(textoDe(n, k)))
          .map((k) => `${k}=${aparar(textoDe(n, k))}`);
        ign('I_SERVICO_CONFIG', `Configuração do serviço ${id} não guardada na spec v1: ${campos.join(', ') || 'sem valores'}.`, id);
      }
    } else {
      ign('I_ELEMENTO', `${qtd} ${qtd === 1 ? 'elemento' : 'elementos'} ${nome} ${qtd === 1 ? 'ignorado' : 'ignorados'}.`, nome);
    }
  }

  // ordem das chaves da raiz: processId, descricao, formId, atividades, ligacoes
  const ordenada = { processId: spec.processId };
  if (spec.descricao !== undefined) ordenada.descricao = spec.descricao;
  if (spec.formId !== undefined) ordenada.formId = spec.formId;
  ordenada.atividades = spec.atividades;
  ordenada.ligacoes = spec.ligacoes;

  return { spec: ordenada, origem, ignorados, avisos };
}
