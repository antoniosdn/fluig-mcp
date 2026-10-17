/**
 * Validador da spec v1 do gerador de fluxo. Nunca altera a spec.
 *
 *   const r = await validarSpec(spec, { versaoAlvo: '2.0', lookups });
 *   // r = { ok, erros: Problema[], avisos: Problema[] }
 *   // Problema = { codigo, mensagem, caminho }
 */
import {
  TIPOS,
  TIPOS_FORA_V1,
  TIPOS_FIM,
  TIPOS_TRATAMENTO,
  OPERADORES,
  OPS_SEM_VALOR,
  OPS_COMPARACAO,
  VALOR_TIPOS,
  EXECUCAO,
  RESPONSAVEL_TIPOS,
  VERSOES_ALVO,
} from './spec.js';

const temChave = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const ehTexto = (v) => typeof v === 'string' && v.trim() !== '';
const juntar = (c, k) => (c ? `${c}.${k}` : k);
const ausente = (v) => v === undefined || v === null;
const ehGatewayExcl = (t) => t === 'gateway_exclusivo';

function novoContexto() {
  const erros = [];
  const avisos = [];
  return {
    erros,
    avisos,
    erro: (codigo, mensagem, caminho = '') => erros.push({ codigo, mensagem, caminho }),
    aviso: (codigo, mensagem, caminho = '') => avisos.push({ codigo, mensagem, caminho }),
  };
}

/** Texto obrigatório: E3 se ausente/vazio, E4 se não for string. Devolve o valor ou undefined. */
function exigirTexto(obj, chave, caminho, ctx) {
  const c = juntar(caminho, chave);
  const v = obj[chave];
  if (ausente(v)) {
    ctx.erro('E_CAMPO_OBRIGATORIO', `Campo obrigatório ausente ou vazio: ${c}.`, c);
    return undefined;
  }
  if (typeof v !== 'string') {
    ctx.erro('E_TIPO_CAMPO', `${c} deve ser texto (string).`, c);
    return undefined;
  }
  if (v.trim() === '') {
    ctx.erro('E_CAMPO_OBRIGATORIO', `Campo obrigatório ausente ou vazio: ${c}.`, c);
    return undefined;
  }
  return v;
}

function chavesDesconhecidas(obj, aceitas, caminho, ctx) {
  for (const k of Object.keys(obj)) {
    if (!aceitas.includes(k)) {
      const c = juntar(caminho, k);
      ctx.erro('E_CAMPO_DESCONHECIDO', `Campo desconhecido: ${c}. Campos aceitos: ${aceitas.join(', ')}.`, c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fase 1 — estrutura                                                  */
/* ------------------------------------------------------------------ */

function fase1(spec, versao, ctx) {
  chavesDesconhecidas(spec, ['processId', 'descricao', 'formId', 'atividades', 'ligacoes'], '', ctx);

  const pid = exigirTexto(spec, 'processId', '', ctx);
  if (pid !== undefined) {
    if (/\s/.test(pid)) {
      ctx.erro('E_PROCESSID', 'processId não pode ter espaço.', 'processId');
    } else if (!/^[A-Za-z0-9_]+$/.test(pid)) {
      ctx.aviso(
        'W_PROCESSID_CARACTERES',
        'processId com caracteres fora de letras sem acento, números e _: pode dar problema em URL e no fluigcli.',
        'processId'
      );
    }
  }
  if (spec.descricao !== undefined && typeof spec.descricao !== 'string') {
    ctx.erro('E_TIPO_CAMPO', 'descricao deve ser texto (string).', 'descricao');
  }
  if (spec.formId !== undefined && !(Number.isInteger(spec.formId) && spec.formId > 0)) {
    ctx.erro('E_TIPO_CAMPO', 'formId deve ser inteiro maior que 0.', 'formId');
  }

  let atividades = null;
  if (ausente(spec.atividades)) {
    ctx.erro('E_CAMPO_OBRIGATORIO', 'Campo obrigatório ausente ou vazio: atividades.', 'atividades');
  } else if (!Array.isArray(spec.atividades)) {
    ctx.erro('E_TIPO_CAMPO', 'atividades deve ser lista (array).', 'atividades');
  } else if (spec.atividades.length === 0) {
    ctx.erro('E_CAMPO_OBRIGATORIO', 'Campo obrigatório ausente ou vazio: atividades.', 'atividades');
  } else {
    atividades = spec.atividades;
  }

  let ligacoes = null;
  if (ausente(spec.ligacoes)) {
    ctx.erro('E_CAMPO_OBRIGATORIO', 'Campo obrigatório ausente ou vazio: ligacoes.', 'ligacoes');
  } else if (!Array.isArray(spec.ligacoes)) {
    ctx.erro('E_TIPO_CAMPO', 'ligacoes deve ser lista (array).', 'ligacoes');
  } else {
    ligacoes = spec.ligacoes;
  }

  // ids e tipos válidos das atividades
  const primeiroId = new Map(); // id -> índice da primeira ocorrência
  const tipoPorId = new Map(); // id -> tipo (string, qualquer)
  if (atividades) {
    atividades.forEach((a, i) => {
      const cam = `atividades[${i}]`;
      if (!ehObjeto(a)) {
        ctx.erro('E_TIPO_CAMPO', `${cam} deve ser objeto.`, cam);
        return;
      }
      fase1Atividade(a, i, cam, primeiroId, tipoPorId, ctx);
    });
    atividades.forEach((a, i) => {
      if (ehObjeto(a)) fase1Tratamento(a, `atividades[${i}]`, tipoPorId, ctx);
    });
  }

  if (ligacoes) {
    ligacoes.forEach((l, i) => {
      const cam = `ligacoes[${i}]`;
      if (!ehObjeto(l)) {
        ctx.erro('E_TIPO_CAMPO', `${cam} deve ser objeto.`, cam);
        return;
      }
      fase1Ligacao(l, cam, primeiroId, versao, ctx);
    });
  }
}

function fase1Atividade(a, i, cam, primeiroId, tipoPorId, ctx) {
  chavesDesconhecidas(a, ['id', 'tipo', 'nome', 'responsavel', 'execucao', 'tratamentoErro', 'posicao'], cam, ctx);

  const id = exigirTexto(a, 'id', cam, ctx);
  if (id !== undefined) {
    if (primeiroId.has(id)) {
      ctx.erro(
        'E_ID_DUPLICADO',
        `id "${id}" repetido (também em atividades[${primeiroId.get(id)}]).`,
        `${cam}.id`
      );
    } else {
      primeiroId.set(id, i);
    }
  }
  const nome = exigirTexto(a, 'nome', cam, ctx);
  void nome;

  const tipo = exigirTexto(a, 'tipo', cam, ctx);
  let tipoOk = false;
  if (tipo !== undefined) {
    if (temChave(TIPOS_FORA_V1, tipo)) {
      ctx.erro('E_TIPO_FORA_V1', `O tipo ${tipo} não é suportado na v1: ${TIPOS_FORA_V1[tipo]}.`, `${cam}.tipo`);
    } else if (!temChave(TIPOS, tipo)) {
      ctx.erro(
        'E_TIPO_ATIVIDADE',
        `Tipo de atividade desconhecido: ${tipo}. Aceitos: ${Object.keys(TIPOS).join(', ')}.`,
        `${cam}.tipo`
      );
    } else {
      tipoOk = true;
    }
    if (id !== undefined && !tipoPorId.has(id)) tipoPorId.set(id, tipo);
  } else if (id !== undefined && !tipoPorId.has(id)) {
    tipoPorId.set(id, undefined);
  }
  const rotulo = id !== undefined ? id : cam;

  // responsável
  if (a.responsavel !== undefined) {
    const cr = `${cam}.responsavel`;
    if (tipoOk && tipo !== 'humana') {
      ctx.erro('E_RESPONSAVEL_FORA_HUMANA', `Só atividade humana tem responsável (${rotulo} é ${tipo}).`, cr);
    } else if (!ehObjeto(a.responsavel)) {
      ctx.erro('E_TIPO_CAMPO', `${cr} deve ser objeto.`, cr);
    } else {
      chavesDesconhecidas(a.responsavel, ['tipo', 'valor'], cr, ctx);
      const rt = exigirTexto(a.responsavel, 'tipo', cr, ctx);
      if (rt !== undefined && !RESPONSAVEL_TIPOS.includes(rt)) {
        ctx.erro(
          'E_RESPONSAVEL_TIPO',
          `Responsável "${rt}" não suportado na v1: use papel ou pool_papel.`,
          `${cr}.tipo`
        );
      }
      exigirTexto(a.responsavel, 'valor', cr, ctx);
    }
  }

  // execução
  if (tipoOk && tipo === 'servico') {
    if (typeof a.execucao !== 'string' || !temChave(EXECUCAO, a.execucao)) {
      ctx.erro(
        'E_EXECUCAO',
        `Atividade de serviço ${rotulo} precisa de execucao "automatizada" ou "imediata".`,
        `${cam}.execucao`
      );
    }
  } else if (tipoOk && a.execucao !== undefined) {
    ctx.erro('E_EXECUCAO_FORA_SERVICO', `execucao só vale para atividade de serviço (${rotulo} é ${tipo}).`, `${cam}.execucao`);
  }

  // posição
  if (a.posicao !== undefined) {
    const cp = `${cam}.posicao`;
    if (!ehObjeto(a.posicao)) {
      ctx.erro('E_TIPO_CAMPO', `${cp} deve ser objeto.`, cp);
    } else {
      chavesDesconhecidas(a.posicao, ['x', 'y'], cp, ctx);
      for (const eixo of ['x', 'y']) {
        const v = a.posicao[eixo];
        if (ausente(v)) {
          ctx.erro('E_CAMPO_OBRIGATORIO', `Campo obrigatório ausente ou vazio: ${cp}.${eixo}.`, `${cp}.${eixo}`);
        } else if (typeof v !== 'number' || !Number.isFinite(v)) {
          ctx.erro('E_TIPO_CAMPO', `${cp}.${eixo} deve ser número.`, `${cp}.${eixo}`);
        }
      }
    }
  }
}

/** tratamentoErro: obrigatório em serviço automatizado, proibido fora dele; aponta para atividade humana. */
function fase1Tratamento(a, cam, tipoPorId, ctx) {
  const rotulo = ehTexto(a.id) ? a.id : cam;
  const automatizado = a.tipo === 'servico' && a.execucao === 'automatizada';
  const ct = `${cam}.tratamentoErro`;
  const tem = a.tratamentoErro !== undefined;

  if (tem && !ehTexto(a.tratamentoErro)) {
    ctx.erro('E_TIPO_CAMPO', `${ct} deve ser texto (string) com o id da atividade de tratamento.`, ct);
    return;
  }
  if (automatizado && !tem) {
    ctx.erro(
      'E_TRATAMENTO_AUSENTE',
      `Serviço automatizado ${rotulo} precisa de tratamentoErro: o id da atividade humana que trata o erro (o Studio exige a captura de erro, e o editor exige saída nela).`,
      cam
    );
    return;
  }
  if (!tem) return;
  if (!automatizado) {
    const o = a.tipo === 'servico' ? `serviço ${a.execucao}` : String(a.tipo);
    ctx.erro(
      'E_TRATAMENTO_FORA_AUTOMATIZADO',
      `tratamentoErro só vale para serviço automatizado (${rotulo} é ${o}); serviço imediato não tem captura de erro.`,
      ct
    );
    return;
  }
  if (!tipoPorId.has(a.tratamentoErro)) {
    ctx.erro('E_TRATAMENTO_ID', `tratamentoErro de ${rotulo} aponta para atividade inexistente: "${a.tratamentoErro}".`, ct);
    return;
  }
  const t = tipoPorId.get(a.tratamentoErro);
  if (!TIPOS_TRATAMENTO.includes(t) || a.tratamentoErro === a.id) {
    ctx.erro(
      'E_TRATAMENTO_TIPO',
      `A atividade de tratamento do erro de ${rotulo} deve ser humana (${a.tratamentoErro} é ${t === undefined ? 'sem tipo' : t}).`,
      ct
    );
  }
}

function fase1Ligacao(l, cam, ids, versao, ctx) {
  chavesDesconhecidas(l, ['de', 'para', 'ordem', 'condicao', 'retorno', 'padrao'], cam, ctx);

  const de = exigirTexto(l, 'de', cam, ctx);
  const para = exigirTexto(l, 'para', cam, ctx);
  for (const [chave, v] of [['de', de], ['para', para]]) {
    if (v !== undefined && !ids.has(v)) {
      ctx.erro('E_LIGACAO_ID', `Ligação aponta para atividade inexistente: "${v}".`, `${cam}.${chave}`);
    }
  }
  if (de !== undefined && de === para) {
    ctx.erro('E_LIGACAO_LACO', `Ligação de ${de} para ela mesma.`, cam);
  }

  if (l.ordem !== undefined && !(Number.isInteger(l.ordem) && l.ordem >= 1)) {
    ctx.erro('E_TIPO_CAMPO', `${cam}.ordem deve ser inteiro maior ou igual a 1.`, `${cam}.ordem`);
  }
  if (l.retorno !== undefined && typeof l.retorno !== 'boolean') {
    ctx.erro('E_TIPO_CAMPO', `${cam}.retorno deve ser verdadeiro ou falso (boolean).`, `${cam}.retorno`);
  }
  if (l.padrao !== undefined && typeof l.padrao !== 'boolean') {
    ctx.erro('E_TIPO_CAMPO', `${cam}.padrao deve ser verdadeiro ou falso (boolean).`, `${cam}.padrao`);
  }
  if (l.condicao !== undefined) {
    fase1Condicao(l.condicao, `${cam}.condicao`, versao, ctx);
  }
}

function fase1Condicao(c, cam, versao, ctx) {
  if (!ehObjeto(c)) {
    ctx.erro('E_TIPO_CAMPO', `${cam} deve ser objeto.`, cam);
    return;
  }
  chavesDesconhecidas(c, ['regras', 'js', 'nome'], cam, ctx);

  const temRegras = c.regras !== undefined;
  const temJs = c.js !== undefined;
  const msgForma = 'Condição deve ter exatamente uma forma: regras (não vazio) ou js (não vazio).';
  let tipoRuim = false;
  if (temRegras && !Array.isArray(c.regras)) {
    ctx.erro('E_TIPO_CAMPO', `${cam}.regras deve ser lista (array).`, `${cam}.regras`);
    tipoRuim = true;
  }
  if (temJs && typeof c.js !== 'string') {
    ctx.erro('E_TIPO_CAMPO', `${cam}.js deve ser texto (string).`, `${cam}.js`);
    tipoRuim = true;
  }
  if (!tipoRuim) {
    if (temRegras === temJs) {
      ctx.erro('E_CONDICAO_FORMA', msgForma, cam);
    } else if (temRegras && c.regras.length === 0) {
      ctx.erro('E_CONDICAO_FORMA', msgForma, cam);
    } else if (temJs && c.js.trim() === '') {
      ctx.erro('E_CONDICAO_FORMA', msgForma, cam);
    }
  }

  if (c.nome !== undefined) {
    if (typeof c.nome !== 'string') {
      ctx.erro('E_TIPO_CAMPO', `${cam}.nome deve ser texto (string).`, `${cam}.nome`);
    } else if (versao === '1.8.2') {
      ctx.erro(
        'E_VERSAO_RECURSO',
        'Nome de condição (conditionName) só existe a partir do Fluig 2.0; remova para versaoAlvo 1.8.2.',
        `${cam}.nome`
      );
    }
  }

  if (temJs && typeof c.js === 'string' && c.js.trim() !== '' && !temRegras) {
    ctx.aviso('W_CONDICAO_JS', 'Condição em JavaScript não é conferida (campos, sintaxe). Prefira regras.', cam);
  }

  if (Array.isArray(c.regras)) {
    c.regras.forEach((r, i) => fase1Regra(r, `${cam}.regras[${i}]`, ctx));
  }
}

function fase1Regra(r, cam, ctx) {
  if (!ehObjeto(r)) {
    ctx.erro('E_TIPO_CAMPO', `${cam} deve ser objeto.`, cam);
    return;
  }
  chavesDesconhecidas(r, ['campo', 'op', 'valor', 'valorTipo'], cam, ctx);

  const campo = exigirTexto(r, 'campo', cam, ctx);
  const op = exigirTexto(r, 'op', cam, ctx);
  void campo;
  let opOk = false;
  if (op !== undefined) {
    if (temChave(OPERADORES, op)) {
      opOk = true;
    } else {
      ctx.erro(
        'E_OPERADOR',
        `Operador desconhecido: ${op}. Aceitos: ${Object.keys(OPERADORES).join(', ')}.`,
        `${cam}.op`
      );
    }
  }

  const v = r.valor;
  let valorTipoOk = true;
  if (!ausente(v) && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v))) {
    ctx.erro('E_TIPO_CAMPO', `${cam}.valor deve ser texto ou número.`, `${cam}.valor`);
    valorTipoOk = false;
  }
  if (r.valorTipo !== undefined) {
    const msg = 'valorTipo deve ser "fixo" ou "campo"; com "campo", valor é o nome de um campo (string).';
    if (typeof r.valorTipo !== 'string' || !temChave(VALOR_TIPOS, r.valorTipo)) {
      ctx.erro('E_VALOR_TIPO', msg, `${cam}.valorTipo`);
    } else if (r.valorTipo === 'campo' && !ausente(v) && typeof v !== 'string') {
      ctx.erro('E_VALOR_TIPO', msg, `${cam}.valorTipo`);
    }
  }

  if (opOk && valorTipoOk) {
    const semValor = ausente(v) || v === '';
    if (OPS_SEM_VALOR.includes(op)) {
      if (!semValor) {
        ctx.erro('E_REGRA_VALOR_PROIBIDO', `O operador ${op} não usa valor; remova o campo valor.`, `${cam}.valor`);
      }
    } else if (semValor) {
      ctx.erro('E_REGRA_VALOR_AUSENTE', `O operador ${op} exige valor.`, `${cam}.valor`);
    }
  }
  if (opOk && OPS_COMPARACAO.includes(op)) {
    ctx.aviso(
      'W_OPERADOR_COMPARACAO',
      `Não está confirmado se o Fluig compara ${typeof r.campo === 'string' ? r.campo : '(campo)'} como texto ou número; teste o caminho no servidor.`,
      `${cam}.op`
    );
  }
}

/* ------------------------------------------------------------------ */
/* Fase 2 — grafo e semântica                                          */
/* ------------------------------------------------------------------ */

function fase2(spec, ctx) {
  const ativs = spec.atividades;
  const ligs = spec.ligacoes;
  const idx = new Map(); // id -> índice
  ativs.forEach((a, i) => idx.set(a.id, i));
  const tipo = (id) => ativs[idx.get(id)].tipo;
  const saidas = new Map();
  const entradas = new Map();
  ativs.forEach((a) => {
    saidas.set(a.id, []);
    entradas.set(a.id, []);
  });
  ligs.forEach((l, i) => {
    saidas.get(l.de).push(i);
    entradas.get(l.para).push(i);
  });

  // aresta de erro: serviço automatizado -> tratamento (conta só em alcançabilidade e caminho até um fim)
  const arestasErro = ativs.filter((a) => a.tipo === 'servico' && a.tratamentoErro !== undefined);
  const tratamentoDe = new Map(); // id do tratamento -> ids dos serviços que o usam
  arestasErro.forEach((a) => {
    if (!tratamentoDe.has(a.tratamentoErro)) tratamentoDe.set(a.tratamentoErro, []);
    tratamentoDe.get(a.tratamentoErro).push(a.id);
  });
  const complemento = (id) =>
    tratamentoDe.has(id) ? ` (é o tratamento do erro de ${tratamentoDe.get(id).join(', ')})` : '';

  const inicios = ativs.filter((a) => a.tipo === 'inicio');
  const fins = ativs.filter((a) => TIPOS_FIM.includes(a.tipo));
  if (inicios.length !== 1) {
    ctx.erro('E_INICIO_QTD', `O processo precisa de exatamente uma atividade inicio (encontradas: ${inicios.length}).`, 'atividades');
  }
  if (fins.length === 0) {
    ctx.erro('E_FIM_AUSENTE', 'O processo precisa de pelo menos um fim (fim, cancelamento ou fim_terminativo).', 'atividades');
  }

  ligs.forEach((l, i) => {
    if (tipo(l.para) === 'inicio') {
      ctx.erro('E_INICIO_ENTRADA', `Nenhuma ligação pode chegar ao início (${l.para}).`, `ligacoes[${i}]`);
    }
    if (TIPOS_FIM.includes(tipo(l.de))) {
      ctx.erro('E_FIM_SAIDA', `Atividade de fim ${l.de} não pode ter saída.`, `ligacoes[${i}]`);
    }
  });

  const semSaida = new Set();
  ativs.forEach((a, i) => {
    if (!TIPOS_FIM.includes(a.tipo) && saidas.get(a.id).length === 0) {
      semSaida.add(a.id);
      ctx.erro('E_SEM_SAIDA', `${a.id} não tem ligação de saída${complemento(a.id)}.`, `atividades[${i}]`);
    }
  });

  // alcançabilidade a partir do início
  const alcancados = new Set(inicios.map((a) => a.id));
  let fila = [...alcancados];
  while (fila.length) {
    const n = fila.pop();
    for (const li of saidas.get(n)) {
      const p = ligs[li].para;
      if (!alcancados.has(p)) {
        alcancados.add(p);
        fila.push(p);
      }
    }
    const a = ativs[idx.get(n)];
    if (a.tipo === 'servico' && a.tratamentoErro !== undefined && idx.has(a.tratamentoErro) && !alcancados.has(a.tratamentoErro)) {
      alcancados.add(a.tratamentoErro);
      fila.push(a.tratamentoErro);
    }
  }
  if (inicios.length > 0) {
    ativs.forEach((a, i) => {
      if (!alcancados.has(a.id)) {
        ctx.erro('E_INALCANCAVEL', `${a.id} não é alcançável a partir do início.`, `atividades[${i}]`);
      }
    });
  }

  // caminho até um fim (busca reversa)
  if (fins.length > 0) {
    const chegam = new Set(fins.map((a) => a.id));
    fila = [...chegam];
    while (fila.length) {
      const n = fila.pop();
      for (const li of entradas.get(n)) {
        const d = ligs[li].de;
        if (!chegam.has(d)) {
          chegam.add(d);
          fila.push(d);
        }
      }
      for (const sv of tratamentoDe.get(n) || []) {
        if (!chegam.has(sv)) {
          chegam.add(sv);
          fila.push(sv);
        }
      }
    }
    ativs.forEach((a, i) => {
      if (!chegam.has(a.id) && !semSaida.has(a.id)) {
        ctx.erro('E_SEM_CAMINHO_FIM', `De ${a.id} não há caminho até um fim (laço sem saída?)${complemento(a.id)}.`, `atividades[${i}]`);
      }
    });
  }

  // ligações duplicadas (fora de gateway exclusivo) e condição fora de gateway
  const vistos = new Set();
  ligs.forEach((l, i) => {
    const tOrig = tipo(l.de);
    if (!ehGatewayExcl(tOrig)) {
      const chave = `${l.de}\u0000${l.para}`;
      if (vistos.has(chave)) {
        ctx.erro('E_LIGACAO_DUPLICADA', `Ligação ${l.de} → ${l.para} repetida.`, `ligacoes[${i}]`);
      }
      vistos.add(chave);
      if (l.condicao !== undefined || l.ordem !== undefined) {
        ctx.erro(
          'E_CONDICAO_FORA_GATEWAY',
          `Só saída de gateway exclusivo tem condicao/ordem (${l.de} é ${tOrig}).`,
          `ligacoes[${i}]`
        );
      }
      if (l.padrao === true) {
        ctx.erro(
          'E_PADRAO_FORA_GATEWAY',
          `Só saída de gateway exclusivo pode ser a padrão (${l.de} é ${tOrig}).`,
          `ligacoes[${i}].padrao`
        );
      }
    }
  });

  ativs.forEach((a, i) => {
    const cam = `atividades[${i}]`;
    const sai = saidas.get(a.id);
    const ent = entradas.get(a.id);
    if (ehGatewayExcl(a.tipo)) {
      if (sai.length < 2) {
        ctx.erro('E_GATEWAY_SAIDAS', `Gateway exclusivo ${a.id} precisa de pelo menos 2 saídas (tem ${sai.length}).`, cam);
      }
      const ordens = new Set();
      const padroes = new Set(); // destinos marcados como padrão
      for (const li of sai) {
        const l = ligs[li];
        if (l.padrao === true) padroes.add(l.para);
        const padraoSemCondicao = l.padrao === true && l.condicao === undefined && l.ordem === undefined;
        if (!padraoSemCondicao && (l.condicao === undefined || l.ordem === undefined)) {
          ctx.erro('E_GATEWAY_SEM_CONDICAO', `Saída ${l.de} → ${l.para} do gateway exclusivo precisa de condicao e ordem.`, `ligacoes[${li}]`);
        }
        if (l.ordem !== undefined) {
          if (ordens.has(l.ordem)) {
            ctx.erro('E_GATEWAY_ORDEM_REPETIDA', `Ordem ${l.ordem} repetida nas saídas do gateway ${a.id}.`, `ligacoes[${li}].ordem`);
          }
          ordens.add(l.ordem);
        }
      }
      if (padroes.size > 1) {
        ctx.erro(
          'E_PADRAO_REPETIDO',
          `O gateway exclusivo ${a.id} tem mais de um destino marcado como padrão (${[...padroes].join(', ')}).`,
          cam
        );
      }
    }
    if (a.tipo === 'servico' && a.execucao === 'automatizada') {
      if (sai.length > 1) {
        ctx.erro('E_SERVICO_AUTO_SAIDAS', `Serviço automatizado ${a.id} deve ter uma única saída (regra do Studio).`, cam);
      }
      ctx.aviso(
        'W_SERVICO_AUTOMATIZADO',
        `Serviço automatizado ${a.id}: o gerador cria a captura de erro ligada a ${a.tratamentoErro}; o script do serviço é feito depois no editor.`,
        cam
      );
    }
    if (a.tipo === 'gateway_paralelo_abertura' && sai.length < 2) {
      ctx.erro('E_PARALELO_ABERTURA', `Abertura paralela ${a.id} precisa de pelo menos 2 saídas.`, cam);
    }
    if (a.tipo === 'gateway_paralelo_juncao' && (ent.length < 2 || sai.length > 1)) {
      ctx.erro('E_PARALELO_JUNCAO', `Junção paralela ${a.id} precisa de 2 ou mais entradas e 1 saída.`, cam);
    }
    if (a.tipo === 'humana' && a.responsavel === undefined) {
      ctx.aviso(
        'W_HUMANA_SEM_RESPONSAVEL',
        `Atividade ${a.id} sem responsável: o Fluig pedirá a escolha do executor ao movimentar.`,
        cam
      );
    }
  });

  paralelos(ativs, ligs, saidas, ctx);
}

/** E37/E38: correspondência abertura x junção paralela. */
function paralelos(ativs, ligs, saidas, ctx) {
  const porId = new Map(ativs.map((a, i) => [a.id, { a, i }]));
  const juncoesCorrespondentes = new Set();
  const totalAberturas = ativs.filter((x) => x.tipo === 'gateway_paralelo_abertura').length;

  for (const { a, i } of porId.values()) {
    if (a.tipo !== 'gateway_paralelo_abertura') continue;
    const candidatasTodas = new Set();
    let problema = null;

    for (const li of saidas.get(a.id)) {
      const visitados = new Set();
      const pilha = [[ligs[li].para, 0]];
      let chegouFim = false;
      let ramoRuim = null;
      while (pilha.length) {
        const [n, d] = pilha.pop();
        const chave = `${n}\u0000${d}`;
        if (visitados.has(chave)) continue;
        visitados.add(chave);
        const t = porId.get(n).a.tipo;
        let dProx = d;
        if (n === a.id) {
          if (!ramoRuim) ramoRuim = `o ramo volta para a abertura ${a.id} sem passar pela junção`;
          continue;
        }
        if (t === 'gateway_paralelo_abertura') {
          dProx = d + 1;
          if (dProx > totalAberturas) {
            if (!ramoRuim) ramoRuim = `o ramo tem aninhamento de aberturas acima do possível a partir de ${n}`;
            continue;
          }
        } else if (t === 'gateway_paralelo_juncao') {
          if (d === 0) {
            candidatasTodas.add(n);
            continue;
          }
          dProx = d - 1;
        } else if (t === 'fim') {
          chegouFim = true;
          continue;
        } else if (TIPOS_FIM.includes(t)) {
          continue; // cancelamento / fim_terminativo encerram a solicitação inteira
        }
        for (const lj of saidas.get(n)) pilha.push([ligs[lj].para, dProx]);
      }
      if (ramoRuim && !problema) problema = ramoRuim;
      if (chegouFim && !problema) {
        problema = `o ramo que começa em ${ligs[li].para} chega a um fim sem passar pela junção`;
      }
    }

    if (!problema && candidatasTodas.size === 0) {
      problema = 'nenhum ramo chega a uma junção';
    }
    if (!problema && candidatasTodas.size > 1) {
      problema = `os ramos chegam a junções diferentes: ${[...candidatasTodas].join(', ')}`;
    }
    if (problema) {
      ctx.erro('E_PARALELO_SEM_JUNCAO', `Os ramos da abertura ${a.id} não convergem para uma única junção (${problema}).`, `atividades[${i}]`);
    } else {
      juncoesCorrespondentes.add([...candidatasTodas][0]);
    }
  }

  for (const { a, i } of porId.values()) {
    if (a.tipo === 'gateway_paralelo_juncao' && !juncoesCorrespondentes.has(a.id)) {
      ctx.erro('E_JUNCAO_SEM_ABERTURA', `Junção ${a.id} não corresponde a nenhuma abertura paralela.`, `atividades[${i}]`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Fase 3 — lookups                                                    */
/* ------------------------------------------------------------------ */

const msgErro = (e) => (e && e.message ? e.message : String(e));

async function fase3(spec, lookups, ctx) {
  // papéis
  const papeis = new Map(); // papel -> [{id, caminho}]
  spec.atividades.forEach((a, i) => {
    if (a.tipo === 'humana' && a.responsavel && ehTexto(a.responsavel.valor)) {
      const v = a.responsavel.valor;
      if (!papeis.has(v)) papeis.set(v, []);
      papeis.get(v).push({ id: a.id, caminho: `atividades[${i}].responsavel.valor` });
    }
  });
  if (papeis.size > 0) {
    if (typeof lookups.papelExiste !== 'function') {
      ctx.aviso('W_SEM_LOOKUP', 'Papéis não conferidos no servidor (lookup papelExiste não informado).', '');
    } else {
      for (const [papel, usos] of papeis) {
        try {
          const existe = await lookups.papelExiste(papel);
          if (!existe) {
            for (const u of usos) {
              ctx.erro('E_PAPEL_INEXISTENTE', `Papel "${papel}" não existe no servidor (atividade ${u.id}).`, u.caminho);
            }
          }
        } catch (e) {
          ctx.aviso('W_LOOKUP_FALHOU', `Não foi possível conferir o papel "${papel}": ${msgErro(e)}.`, '');
        }
      }
    }
  }

  // campos das condições
  const refs = []; // { campo, caminho }
  spec.ligacoes.forEach((l, i) => {
    if (l.condicao && Array.isArray(l.condicao.regras)) {
      l.condicao.regras.forEach((r, j) => {
        const base = `ligacoes[${i}].condicao.regras[${j}]`;
        if (ehTexto(r.campo)) refs.push({ campo: r.campo, caminho: `${base}.campo` });
        if (r.valorTipo === 'campo' && ehTexto(r.valor)) refs.push({ campo: r.valor, caminho: `${base}.valor` });
      });
    }
  });
  if (refs.length === 0) return;
  if (spec.formId === undefined) {
    ctx.aviso('W_SEM_FORMULARIO', 'Sem formId: campos das condições não conferidos.', '');
    return;
  }
  if (typeof lookups.camposFormulario !== 'function') {
    ctx.aviso('W_SEM_LOOKUP', 'Campos do formulário não conferidos no servidor (lookup camposFormulario não informado).', '');
    return;
  }
  let campos;
  try {
    campos = await lookups.camposFormulario(spec.formId);
    if (!Array.isArray(campos)) throw new Error('o lookup não devolveu uma lista de campos');
  } catch (e) {
    ctx.aviso('W_LOOKUP_FALHOU', `Não foi possível conferir os campos do formulário ${spec.formId}: ${msgErro(e)}.`, '');
    return;
  }
  const exatos = new Set(campos);
  for (const ref of refs) {
    if (exatos.has(ref.campo)) continue;
    const parecido = campos.find((c) => typeof c === 'string' && c.toLowerCase() === ref.campo.toLowerCase());
    const dica = parecido ? `; você quis dizer "${parecido}"?` : '';
    ctx.erro('E_CAMPO_INEXISTENTE', `Campo "${ref.campo}" não existe no formulário ${spec.formId}${dica}.`, ref.caminho);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Só a fase 3 (papéis e campos das condições no servidor), sem as fases 1 e 2: serve para conferir uma spec
 * lida de um `.process` que pode ter coisas fora da v1. Exige apenas `atividades` e `ligacoes` como listas.
 * @returns {Promise<{ok: boolean, erros: Array, avisos: Array}>}
 */
export async function conferirNoServidor(spec, lookups = {}) {
  const ctx = novoContexto();
  if (!ehObjeto(spec) || !Array.isArray(spec.atividades) || !Array.isArray(spec.ligacoes)) {
    return { ok: true, erros: [], avisos: [] };
  }
  await fase3(spec, lookups || {}, ctx);
  return { ok: ctx.erros.length === 0, erros: ctx.erros, avisos: ctx.avisos };
}

/**
 * Valida a spec v1. Nunca lança por spec ruim e nunca altera a spec.
 * @param {*} spec
 * @param {{versaoAlvo: '1.8.2'|'2.0', lookups?: {papelExiste?: Function, camposFormulario?: Function}}} opcoes
 * @returns {Promise<{ok: boolean, erros: Array, avisos: Array}>}
 */
export async function validarSpec(spec, opcoes = {}) {
  const ctx = novoContexto();
  const { versaoAlvo, lookups = {} } = opcoes || {};
  const fim = () => ({ ok: ctx.erros.length === 0, erros: ctx.erros, avisos: ctx.avisos });

  if (!VERSOES_ALVO.includes(versaoAlvo)) {
    ctx.erro('E_VERSAO_ALVO', `versaoAlvo deve ser "1.8.2" ou "2.0" (recebido: ${String(versaoAlvo)}).`, 'versaoAlvo');
  }
  if (!ehObjeto(spec)) {
    ctx.erro('E_SPEC_INVALIDA', 'A spec deve ser um objeto JSON.', '');
    return fim();
  }

  fase1(spec, versaoAlvo, ctx);
  if (ctx.erros.length > 0) return fim();

  fase2(spec, ctx);
  await fase3(spec, lookups || {}, ctx);
  return fim();
}
