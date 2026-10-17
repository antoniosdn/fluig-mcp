import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarSpec, conferirNoServidor } from '../src/flow/validar.js';

function specBase() {
  return {
    processId: 'aquisicaoEquip',
    descricao: 'Aquisição de equipamentos',
    formId: 14349,
    atividades: [
      { id: 'ini', tipo: 'inicio', nome: 'Início' },
      { id: 'ped', tipo: 'humana', nome: 'Preencher pedido', responsavel: { tipo: 'pool_papel', valor: 'solicitante' } },
      { id: 'gv', tipo: 'gateway_exclusivo', nome: 'Aprovar?' },
      { id: 'apr', tipo: 'humana', nome: 'Aprovar', responsavel: { tipo: 'papel', valor: 'diretoria' } },
      { id: 'fim', tipo: 'fim', nome: 'Fim' },
      { id: 'can', tipo: 'cancelamento', nome: 'Cancelado' },
    ],
    ligacoes: [
      { de: 'ini', para: 'ped' },
      { de: 'ped', para: 'gv' },
      { de: 'gv', para: 'apr', ordem: 1, condicao: { regras: [{ campo: 'status', op: 'igual', valor: 'A' }] } },
      { de: 'gv', para: 'can', ordem: 2, condicao: { regras: [{ campo: 'status', op: 'diferente', valor: 'A' }] } },
      { de: 'apr', para: 'fim' },
    ],
  };
}

const lookupsOk = () => ({
  papelExiste: async (c) => ['solicitante', 'diretoria'].includes(c),
  camposFormulario: async () => ['status', 'valor'],
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const v = (spec, opts = {}) => validarSpec(spec, { versaoAlvo: '2.0', ...opts });
const codigos = (r) => [...r.erros, ...r.avisos].map((p) => p.codigo);
const temProblema = (r, codigo, caminho) =>
  [...r.erros, ...r.avisos].some((p) => p.codigo === codigo && (caminho === undefined || p.caminho === caminho));

// monta variantes a partir da base; `mut` altera o clone
const com = (mut) => {
  const s = specBase();
  mut(s);
  return s;
};
const ativ = (s, id) => s.atividades.find((a) => a.id === id);

// paralelo: ini -> ab -> (a, b) -> jn -> fim
function specParalelo() {
  return {
    processId: 'par',
    atividades: [
      { id: 'ini', tipo: 'inicio', nome: 'Início' },
      { id: 'ab', tipo: 'gateway_paralelo_abertura', nome: 'Abre' },
      { id: 'a', tipo: 'humana', nome: 'A', responsavel: { tipo: 'papel', valor: 'p' } },
      { id: 'b', tipo: 'humana', nome: 'B', responsavel: { tipo: 'papel', valor: 'p' } },
      { id: 'jn', tipo: 'gateway_paralelo_juncao', nome: 'Junta' },
      { id: 'fim', tipo: 'fim', nome: 'Fim' },
    ],
    ligacoes: [
      { de: 'ini', para: 'ab' },
      { de: 'ab', para: 'a' },
      { de: 'ab', para: 'b' },
      { de: 'a', para: 'jn' },
      { de: 'b', para: 'jn' },
      { de: 'jn', para: 'fim' },
    ],
  };
}

test('specBase é válida nas duas versões; só avisos W6 sem lookups', async () => {
  for (const versaoAlvo of ['2.0', '1.8.2']) {
    const r = await validarSpec(specBase(), { versaoAlvo });
    assert.equal(r.ok, true, JSON.stringify(r.erros));
    assert.deepEqual(r.erros, []);
    assert.deepEqual(codigos(r), ['W_SEM_LOOKUP', 'W_SEM_LOOKUP']);
  }
  const r = await v(specBase(), { lookups: lookupsOk() });
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.avisos, []);
});

// [codigo, mutação, caminho esperado]
const casosErro = [
  ['E_SPEC_INVALIDA', null, ''],
  ['E_CAMPO_OBRIGATORIO', (s) => { delete s.processId; }, 'processId'],
  ['E_CAMPO_OBRIGATORIO', (s) => { ativ(s, 'ped').nome = ' '; }, 'atividades[1].nome'],
  ['E_CAMPO_OBRIGATORIO', (s) => { delete s.ligacoes[0].de; }, 'ligacoes[0].de'],
  ['E_CAMPO_OBRIGATORIO', (s) => { delete s.ligacoes[2].condicao.regras[0].op; }, 'ligacoes[2].condicao.regras[0].op'],
  ['E_TIPO_CAMPO', (s) => { s.atividades = 'x'; }, 'atividades'],
  ['E_TIPO_CAMPO', (s) => { s.formId = 1.5; }, 'formId'],
  ['E_TIPO_CAMPO', (s) => { s.ligacoes[2].ordem = 'um'; }, 'ligacoes[2].ordem'],
  ['E_TIPO_CAMPO', (s) => { s.ligacoes[0].retorno = 'sim'; }, 'ligacoes[0].retorno'],
  ['E_TIPO_CAMPO', (s) => { ativ(s, 'ped').posicao = { x: 'a', y: 1 }; }, 'atividades[1].posicao.x'],
  ['E_CAMPO_DESCONHECIDO', (s) => { s.atividades[0].nomee = 'x'; }, 'atividades[0].nomee'],
  ['E_CAMPO_DESCONHECIDO', (s) => { s.ligacoes[2].condicao.regras[0].valorr = 'x'; }, 'ligacoes[2].condicao.regras[0].valorr'],
  ['E_PROCESSID', (s) => { s.processId = 'com espaco'; }, 'processId'],
  ['E_TIPO_ATIVIDADE', (s) => { ativ(s, 'ped').tipo = 'humano'; }, 'atividades[1].tipo'],
  ['E_TIPO_FORA_V1', (s) => { ativ(s, 'ped').tipo = 'espera'; }, 'atividades[1].tipo'],
  ['E_ID_DUPLICADO', (s) => { ativ(s, 'can').id = 'fim'; }, 'atividades[5].id'],
  ['E_RESPONSAVEL_TIPO', (s) => { ativ(s, 'ped').responsavel.tipo = 'usuario'; }, 'atividades[1].responsavel.tipo'],
  ['E_RESPONSAVEL_FORA_HUMANA', (s) => { ativ(s, 'gv').responsavel = { tipo: 'papel', valor: 'x' }; }, 'atividades[2].responsavel'],
  ['E_EXECUCAO', (s) => { ativ(s, 'ped').tipo = 'servico'; delete ativ(s, 'ped').responsavel; }, 'atividades[1].execucao'],
  ['E_EXECUCAO', (s) => { Object.assign(ativ(s, 'ped'), { tipo: 'servico', execucao: 'agora' }); delete ativ(s, 'ped').responsavel; }, 'atividades[1].execucao'],
  ['E_EXECUCAO_FORA_SERVICO', (s) => { ativ(s, 'ped').execucao = 'imediata'; }, 'atividades[1].execucao'],
  ['E_LIGACAO_ID', (s) => { s.ligacoes[0].para = 'nada'; }, 'ligacoes[0].para'],
  ['E_LIGACAO_LACO', (s) => { s.ligacoes[0].para = 'ini'; }, 'ligacoes[0]'],
  ['E_CONDICAO_FORMA', (s) => { s.ligacoes[2].condicao.js = 'true'; }, 'ligacoes[2].condicao'],
  ['E_CONDICAO_FORMA', (s) => { s.ligacoes[2].condicao = {}; }, 'ligacoes[2].condicao'],
  ['E_CONDICAO_FORMA', (s) => { s.ligacoes[2].condicao = { regras: [] }; }, 'ligacoes[2].condicao'],
  ['E_CONDICAO_FORMA', (s) => { s.ligacoes[2].condicao = { js: '' }; }, 'ligacoes[2].condicao'],
  ['E_OPERADOR', (s) => { s.ligacoes[2].condicao.regras[0].op = '=='; }, 'ligacoes[2].condicao.regras[0].op'],
  ['E_VALOR_TIPO', (s) => { s.ligacoes[2].condicao.regras[0].valorTipo = 'variavel'; }, 'ligacoes[2].condicao.regras[0].valorTipo'],
  ['E_VALOR_TIPO', (s) => { Object.assign(s.ligacoes[2].condicao.regras[0], { valorTipo: 'campo', valor: 10 }); }, 'ligacoes[2].condicao.regras[0].valorTipo'],
  ['E_REGRA_VALOR_AUSENTE', (s) => { delete s.ligacoes[2].condicao.regras[0].valor; }, 'ligacoes[2].condicao.regras[0].valor'],
  ['E_REGRA_VALOR_AUSENTE', (s) => { s.ligacoes[2].condicao.regras[0].valor = ''; }, 'ligacoes[2].condicao.regras[0].valor'],
  ['E_REGRA_VALOR_PROIBIDO', (s) => { Object.assign(s.ligacoes[2].condicao.regras[0], { op: 'vazio', valor: 'x' }); }, 'ligacoes[2].condicao.regras[0].valor'],
  // fase 2
  ['E_INICIO_QTD', (s) => { s.atividades.push({ id: 'ini2', tipo: 'inicio', nome: 'Outro' }); s.ligacoes.push({ de: 'ini2', para: 'fim' }); }, 'atividades'],
  ['E_FIM_AUSENTE', (s) => { s.atividades = s.atividades.filter((a) => a.id !== 'fim' && a.id !== 'can'); s.ligacoes = [{ de: 'ini', para: 'ped' }, { de: 'ped', para: 'apr' }, { de: 'apr', para: 'ped' }]; s.atividades = s.atividades.filter((a) => a.id !== 'gv'); }, 'atividades'],
  ['E_INICIO_ENTRADA', (s) => { s.ligacoes.push({ de: 'apr', para: 'ini' }); }, 'ligacoes[5]'],
  ['E_FIM_SAIDA', (s) => { s.ligacoes.push({ de: 'fim', para: 'apr' }); }, 'ligacoes[5]'],
  ['E_SEM_SAIDA', (s) => { s.ligacoes = s.ligacoes.filter((l) => l.de !== 'apr'); }, 'atividades[3]'],
  ['E_INALCANCAVEL', (s) => { s.atividades.push({ id: 'sol', tipo: 'humana', nome: 'Solta', responsavel: { tipo: 'papel', valor: 'diretoria' } }); s.ligacoes.push({ de: 'sol', para: 'fim' }); }, 'atividades[6]'],
  ['E_SEM_CAMINHO_FIM', (s) => {
    s.atividades.push({ id: 'l1', tipo: 'humana', nome: 'L1', responsavel: { tipo: 'papel', valor: 'diretoria' } });
    s.atividades.push({ id: 'l2', tipo: 'humana', nome: 'L2', responsavel: { tipo: 'papel', valor: 'diretoria' } });
    s.ligacoes.push({ de: 'ped', para: 'l1' }, { de: 'l1', para: 'l2' }, { de: 'l2', para: 'l1' });
  }, 'atividades[6]'],
  ['E_LIGACAO_DUPLICADA', (s) => { s.ligacoes.push({ de: 'apr', para: 'fim' }); }, 'ligacoes[5]'],
  ['E_GATEWAY_SAIDAS', (s) => { s.ligacoes.splice(3, 1); s.atividades = s.atividades.filter((a) => a.id !== 'can'); }, 'atividades[2]'],
  ['E_GATEWAY_SEM_CONDICAO', (s) => { delete s.ligacoes[3].condicao; }, 'ligacoes[3]'],
  ['E_GATEWAY_SEM_CONDICAO', (s) => { delete s.ligacoes[3].ordem; }, 'ligacoes[3]'],
  ['E_GATEWAY_ORDEM_REPETIDA', (s) => { s.ligacoes[3].ordem = 1; }, 'ligacoes[3].ordem'],
  ['E_CONDICAO_FORA_GATEWAY', (s) => { s.ligacoes[0].condicao = { js: 'true' }; }, 'ligacoes[0]'],
  ['E_CONDICAO_FORA_GATEWAY', (s) => { s.ligacoes[4].ordem = 1; }, 'ligacoes[4]'],
  ['E_SERVICO_AUTO_SAIDAS', (s) => {
    Object.assign(ativ(s, 'ped'), { tipo: 'servico', execucao: 'automatizada', tratamentoErro: 'apr' }); delete ativ(s, 'ped').responsavel;
    s.ligacoes.push({ de: 'ped', para: 'apr' });
  }, 'atividades[1]'],
  ['E_VERSAO_RECURSO', (s) => { s.ligacoes[2].condicao.nome = 'Aprovado'; }, 'ligacoes[2].condicao.nome', '1.8.2'],
  ['E_TIPO_CAMPO', (s) => { s.ligacoes[3].padrao = 'sim'; }, 'ligacoes[3].padrao'],
  ['E_PADRAO_FORA_GATEWAY', (s) => { s.ligacoes[0].padrao = true; }, 'ligacoes[0].padrao'],
  ['E_PADRAO_REPETIDO', (s) => { s.ligacoes[2].padrao = true; s.ligacoes[3].padrao = true; }, 'atividades[2]'],
];

for (const [codigo, mut, caminho, versao] of casosErro) {
  test(`${codigo} dispara em ${caminho || 'spec'} e a base não`, async () => {
    const base = await v(specBase());
    assert.equal(temProblema(base, codigo), false, 'a base não deve ter o código');
    const opts = versao ? { versaoAlvo: versao } : {};
    let r;
    if (mut === null) {
      r = await v([1, 2]);
    } else {
      r = await v(com(mut), opts);
    }
    assert.equal(temProblema(r, codigo, caminho), true, `esperava ${codigo} em "${caminho}", veio ${JSON.stringify([...r.erros, ...r.avisos])}`);
  });
}

test('E_VERSAO_ALVO: ausente e fora da lista; E_VERSAO_RECURSO aceito em 2.0', async () => {
  assert.equal(temProblema(await validarSpec(specBase(), {}), 'E_VERSAO_ALVO'), true);
  assert.equal(temProblema(await validarSpec(specBase(), { versaoAlvo: '3.0' }), 'E_VERSAO_ALVO'), true);
  assert.equal(temProblema(await validarSpec(specBase(), { versaoAlvo: '1.8.2' }), 'E_VERSAO_ALVO'), false);
  const s = com((x) => { x.ligacoes[2].condicao.nome = 'Aprovado'; });
  assert.equal((await v(s)).ok, true);
  assert.equal(temProblema(await validarSpec(s, { versaoAlvo: '1.8.2' }), 'E_VERSAO_RECURSO'), true);
});

test('vazio/preenchido sem valor ou com "" são aceitos', async () => {
  for (const valor of [undefined, '']) {
    const s = com((x) => {
      const r = x.ligacoes[2].condicao.regras[0];
      r.op = 'preenchido';
      if (valor === undefined) delete r.valor; else r.valor = valor;
    });
    const r = await v(s);
    assert.equal(r.ok, true, JSON.stringify(r.erros));
  }
});

test('valorTipo campo com valor string é aceito', async () => {
  const s = com((x) => { Object.assign(x.ligacoes[2].condicao.regras[0], { valorTipo: 'campo', valor: 'valor' }); });
  const r = await v(s, { lookups: lookupsOk() });
  assert.equal(r.ok, true, JSON.stringify(r.erros));
});

// avisos
test('W_PROCESSID_CARACTERES', async () => {
  assert.equal(temProblema(await v(specBase()), 'W_PROCESSID_CARACTERES'), false);
  const r = await v(com((s) => { s.processId = 'aquisição-equip'; }));
  assert.equal(temProblema(r, 'W_PROCESSID_CARACTERES', 'processId'), true);
  assert.equal(r.ok, true);
});

test('W_CONDICAO_JS', async () => {
  assert.equal(temProblema(await v(specBase()), 'W_CONDICAO_JS'), false);
  const r = await v(com((s) => { s.ligacoes[2].condicao = { js: 'hAPI.getCardValue("x") == "1"' }; }));
  assert.equal(temProblema(r, 'W_CONDICAO_JS', 'ligacoes[2].condicao'), true);
  assert.equal(r.ok, true);
});

test('W_OPERADOR_COMPARACAO', async () => {
  assert.equal(temProblema(await v(specBase()), 'W_OPERADOR_COMPARACAO'), false);
  for (const op of ['maior', 'maior_igual', 'menor', 'menor_igual']) {
    const r = await v(com((s) => { s.ligacoes[2].condicao.regras[0].op = op; }));
    assert.equal(temProblema(r, 'W_OPERADOR_COMPARACAO', 'ligacoes[2].condicao.regras[0].op'), true, op);
    assert.equal(r.ok, true);
  }
});

test('W_HUMANA_SEM_RESPONSAVEL', async () => {
  assert.equal(temProblema(await v(specBase()), 'W_HUMANA_SEM_RESPONSAVEL'), false);
  const r = await v(com((s) => { delete ativ(s, 'apr').responsavel; }));
  assert.equal(temProblema(r, 'W_HUMANA_SEM_RESPONSAVEL', 'atividades[3]'), true);
  assert.equal(r.ok, true);
});

test('W_SERVICO_AUTOMATIZADO só em automatizada', async () => {
  const mk = (execucao) => com((s) => {
    Object.assign(ativ(s, 'ped'), { tipo: 'servico', execucao });
    if (execucao === 'automatizada') ativ(s, 'ped').tratamentoErro = 'apr';
    delete ativ(s, 'ped').responsavel;
  });
  assert.equal(temProblema(await v(mk('imediata')), 'W_SERVICO_AUTOMATIZADO'), false);
  const r = await v(mk('automatizada'));
  assert.equal(temProblema(r, 'W_SERVICO_AUTOMATIZADO', 'atividades[1]'), true);
  assert.match(r.avisos.find((a) => a.codigo === 'W_SERVICO_AUTOMATIZADO').mensagem, /ligada a apr; o script do serviço é feito depois no editor/);
  assert.equal(r.ok, true);
});

// tratamentoErro (passo 5.4)
// base: ini -> ped(serviço automatizado, trata erro em "tr") -> gv -> apr/can; tr (humana) volta para ped
const comTratamento = (mut) => com((s) => {
  Object.assign(ativ(s, 'ped'), { tipo: 'servico', execucao: 'automatizada', tratamentoErro: 'tr' });
  delete ativ(s, 'ped').responsavel;
  s.atividades.push({ id: 'tr', tipo: 'humana', nome: 'Tratar erro', responsavel: { tipo: 'papel', valor: 'diretoria' } });
  s.ligacoes.push({ de: 'tr', para: 'ped' });
  if (mut) mut(s);
});

test('tratamentoErro: spec válida, sem E_INALCANCAVEL (tratamento só alcançado pela captura) nem E_SEM_SAIDA', async () => {
  const r = await v(comTratamento());
  assert.deepEqual(r.erros, [], JSON.stringify(r.erros));
  // tratamento sem ligação de entrada: só a captura chega nele
  const so = await v(comTratamento((s) => {
    s.ligacoes = s.ligacoes.filter((l) => !(l.de === 'tr'));
    s.ligacoes.push({ de: 'tr', para: 'fim' });
  }));
  assert.deepEqual(so.erros, [], JSON.stringify(so.erros));
});

test('E_TRATAMENTO_AUSENTE: serviço automatizado sem tratamentoErro', async () => {
  const r = await v(comTratamento((s) => { delete ativ(s, 'ped').tratamentoErro; }));
  assert.equal(temProblema(r, 'E_TRATAMENTO_AUSENTE', 'atividades[1]'), true);
  assert.equal(r.ok, false);
});

test('E_TRATAMENTO_FORA_AUTOMATIZADO: em serviço imediato e em atividade que não é serviço', async () => {
  const imediato = await v(comTratamento((s) => { ativ(s, 'ped').execucao = 'imediata'; }));
  assert.equal(temProblema(imediato, 'E_TRATAMENTO_FORA_AUTOMATIZADO', 'atividades[1].tratamentoErro'), true);
  const humana = await v(comTratamento((s) => { ativ(s, 'apr').tratamentoErro = 'tr'; }));
  assert.equal(temProblema(humana, 'E_TRATAMENTO_FORA_AUTOMATIZADO', 'atividades[3].tratamentoErro'), true);
});

test('E_TRATAMENTO_ID e E_TRATAMENTO_TIPO', async () => {
  const id = await v(comTratamento((s) => { ativ(s, 'ped').tratamentoErro = 'naoexiste'; }));
  assert.equal(temProblema(id, 'E_TRATAMENTO_ID', 'atividades[1].tratamentoErro'), true);
  for (const alvo of ['gv', 'fim', 'ini', 'ped']) {
    const t = await v(comTratamento((s) => { ativ(s, 'ped').tratamentoErro = alvo; }));
    assert.equal(temProblema(t, 'E_TRATAMENTO_TIPO', 'atividades[1].tratamentoErro'), true, alvo);
  }
});

test('tratamentoErro que não é texto -> E_TIPO_CAMPO', async () => {
  for (const ruim of [5, '', '  ', {}, null]) {
    const r = await v(comTratamento((s) => { ativ(s, 'ped').tratamentoErro = ruim; }));
    assert.equal(temProblema(r, 'E_TIPO_CAMPO', 'atividades[1].tratamentoErro'), true, JSON.stringify(ruim));
  }
});

test('tratamento sem caminho até um fim -> E_SEM_CAMINHO_FIM com o complemento; sem saída -> E_SEM_SAIDA', async () => {
  const laco = await v(comTratamento((s) => {
    s.ligacoes = s.ligacoes.filter((l) => l.de !== 'tr');
    s.atividades.push({ id: 'tr2', tipo: 'humana', nome: 'Tratar 2', responsavel: { tipo: 'papel', valor: 'diretoria' } });
    s.ligacoes.push({ de: 'tr', para: 'tr2' }, { de: 'tr2', para: 'tr' });
  }));
  const e = laco.erros.find((x) => x.codigo === 'E_SEM_CAMINHO_FIM' && x.caminho === 'atividades[6]');
  assert.ok(e, JSON.stringify(laco.erros));
  assert.match(e.mensagem, /\(é o tratamento do erro de ped\)/);
  const sem = await v(comTratamento((s) => { s.ligacoes = s.ligacoes.filter((l) => l.de !== 'tr'); }));
  const e2 = sem.erros.find((x) => x.codigo === 'E_SEM_SAIDA' && x.caminho === 'atividades[6]');
  assert.ok(e2, JSON.stringify(sem.erros));
  assert.match(e2.mensagem, /\(é o tratamento do erro de ped\)/);
});

test('E_SERVICO_AUTO_SAIDAS não conta o tratamento; ligação repetida do tratamento não vira E_LIGACAO_DUPLICADA', async () => {
  const r = await v(comTratamento());
  assert.equal(temProblema(r, 'E_SERVICO_AUTO_SAIDAS'), false);
  // o tratamento também pode ser alvo de uma ligação normal do serviço (mesmo par): não é duplicata
  const dup = await v(comTratamento((s) => { s.ligacoes.push({ de: 'ped', para: 'tr' }); }));
  assert.equal(temProblema(dup, 'E_LIGACAO_DUPLICADA'), false);
});

test('tratamento compartilhado por dois serviços', async () => {
  const r = await v(comTratamento((s) => {
    s.atividades.push({ id: 'srv2', tipo: 'servico', nome: 'Outro', execucao: 'automatizada', tratamentoErro: 'tr' });
    s.ligacoes = s.ligacoes.map((l) => (l.de === 'apr' && l.para === 'fim' ? { de: 'apr', para: 'srv2' } : l));
    s.ligacoes.push({ de: 'srv2', para: 'fim' });
  }));
  assert.deepEqual(r.erros, [], JSON.stringify(r.erros));
});

test('E_SERVICO_AUTO_SAIDAS: imediata com 2 saídas não dá erro', async () => {
  const s = com((x) => {
    Object.assign(ativ(x, 'ped'), { tipo: 'servico', execucao: 'imediata' });
    delete ativ(x, 'ped').responsavel;
    x.ligacoes.push({ de: 'ped', para: 'apr' });
  });
  assert.equal(temProblema(await v(s), 'E_SERVICO_AUTO_SAIDAS'), false);
});

// paralelos
test('paralelo válido, aninhado e com ramo cancelando', async () => {
  let r = await v(specParalelo());
  assert.deepEqual(r.erros, []);

  const aninhado = specParalelo();
  aninhado.atividades.push(
    { id: 'ab2', tipo: 'gateway_paralelo_abertura', nome: 'Abre 2' },
    { id: 'c', tipo: 'humana', nome: 'C', responsavel: { tipo: 'papel', valor: 'p' } },
    { id: 'd', tipo: 'humana', nome: 'D', responsavel: { tipo: 'papel', valor: 'p' } },
    { id: 'jn2', tipo: 'gateway_paralelo_juncao', nome: 'Junta 2' }
  );
  aninhado.ligacoes = aninhado.ligacoes.filter((l) => !(l.de === 'a' && l.para === 'jn'));
  aninhado.ligacoes.push(
    { de: 'a', para: 'ab2' }, { de: 'ab2', para: 'c' }, { de: 'ab2', para: 'd' },
    { de: 'c', para: 'jn2' }, { de: 'd', para: 'jn2' }, { de: 'jn2', para: 'jn' }
  );
  r = await v(aninhado);
  assert.deepEqual(r.erros, [], JSON.stringify(r.erros));

  // três ramos: a, b -> jn e c -> cancelamento (aceito, a junção tem 2 entradas)
  const cancela = specParalelo();
  cancela.atividades.push(
    { id: 'c', tipo: 'humana', nome: 'C', responsavel: { tipo: 'papel', valor: 'p' } },
    { id: 'can', tipo: 'cancelamento', nome: 'Cancela' }
  );
  cancela.ligacoes.push({ de: 'ab', para: 'c' }, { de: 'c', para: 'can' });
  r = await v(cancela);
  assert.deepEqual(r.erros, [], JSON.stringify(r.erros));
});

const cond = (ordem, valor) => ({
  ordem,
  condicao: { regras: [{ campo: 'x', op: 'igual', valor }] },
});

test('retrabalho que volta antes da abertura dá E37 e termina', async () => {
  const s = specParalelo();
  s.atividades.push(
    { id: 'ped', tipo: 'humana', nome: 'Pedido', responsavel: { tipo: 'papel', valor: 'p' } },
    { id: 'gx', tipo: 'gateway_exclusivo', nome: 'Ok?' }
  );
  s.ligacoes = s.ligacoes.filter((l) => !(l.de === 'ini') && !(l.de === 'a' && l.para === 'jn'));
  s.ligacoes.push(
    { de: 'ini', para: 'ped' }, { de: 'ped', para: 'ab' },
    { de: 'a', para: 'gx' },
    { de: 'gx', para: 'jn', ...cond(1, '1') },
    { de: 'gx', para: 'ped', ...cond(2, '2') }
  );
  const r = await v(s);
  assert.equal(temProblema(r, 'E_PARALELO_SEM_JUNCAO', 'atividades[1]'), true, JSON.stringify(r.erros));
});

test('retrabalho dentro do ramo é aceito', async () => {
  const s = specParalelo();
  s.atividades.push(
    { id: 'a2', tipo: 'humana', nome: 'A2', responsavel: { tipo: 'papel', valor: 'p' } },
    { id: 'gx', tipo: 'gateway_exclusivo', nome: 'Ok?' }
  );
  s.ligacoes = s.ligacoes.filter((l) => !(l.de === 'a' && l.para === 'jn'));
  s.ligacoes.push(
    { de: 'a', para: 'gx' },
    { de: 'gx', para: 'jn', ...cond(1, '1') },
    { de: 'gx', para: 'a2', ...cond(2, '2') },
    { de: 'a2', para: 'a' }
  );
  const r = await v(s);
  assert.deepEqual(r.erros, [], JSON.stringify(r.erros));
});

test('formId e descricao nulos dão E_TIPO_CAMPO e não chamam lookup', async () => {
  let chamou = false;
  const lookups = { camposFormulario: async () => { chamou = true; return []; } };
  for (const campo of ['formId', 'descricao']) {
    const r = await v(com((x) => { x[campo] = null; }), { lookups });
    assert.equal(temProblema(r, 'E_TIPO_CAMPO', campo), true, campo);
  }
  assert.equal(chamou, false);
});

test('E_PARALELO_ABERTURA, E_PARALELO_JUNCAO', async () => {
  assert.equal(temProblema(await v(specParalelo()), 'E_PARALELO_ABERTURA'), false);
  assert.equal(temProblema(await v(specParalelo()), 'E_PARALELO_JUNCAO'), false);
  const s1 = specParalelo();
  s1.ligacoes = s1.ligacoes.filter((l) => l.para !== 'b' && l.de !== 'b');
  s1.atividades = s1.atividades.filter((a) => a.id !== 'b');
  const r1 = await v(s1);
  assert.equal(temProblema(r1, 'E_PARALELO_ABERTURA', 'atividades[1]'), true);
  assert.equal(temProblema(r1, 'E_PARALELO_JUNCAO', 'atividades[3]'), true);
});

test('E_PARALELO_SEM_JUNCAO: ramo vai a fim; duas junções; E_JUNCAO_SEM_ABERTURA', async () => {
  const ramoFim = specParalelo();
  ramoFim.ligacoes = ramoFim.ligacoes.filter((l) => !(l.de === 'b' && l.para === 'jn'));
  ramoFim.ligacoes.push({ de: 'b', para: 'fim' });
  assert.equal(temProblema(await v(ramoFim), 'E_PARALELO_SEM_JUNCAO', 'atividades[1]'), true);

  // duas junções: a -> jn, b -> jn2
  const dif = specParalelo();
  dif.atividades.push({ id: 'jn2', tipo: 'gateway_paralelo_juncao', nome: 'J2' });
  dif.ligacoes = dif.ligacoes.filter((l) => !(l.de === 'b' && l.para === 'jn'));
  dif.ligacoes.push({ de: 'b', para: 'jn2' }, { de: 'jn2', para: 'fim' });
  assert.equal(temProblema(await v(dif), 'E_PARALELO_SEM_JUNCAO', 'atividades[1]'), true);

  const solta = specParalelo();
  solta.atividades.push({ id: 'js', tipo: 'gateway_paralelo_juncao', nome: 'Solta' });
  solta.ligacoes.push({ de: 'a', para: 'js' }, { de: 'js', para: 'fim' });
  const rs = await v(solta);
  assert.equal(temProblema(rs, 'E_JUNCAO_SEM_ABERTURA', 'atividades[6]'), true);
  assert.equal(temProblema(await v(specParalelo()), 'E_JUNCAO_SEM_ABERTURA'), false);
});

// OU e duplicadas
test('OU: duas ligações do gateway para o mesmo destino são aceitas; repetida em humana não', async () => {
  const ou = com((s) => {
    s.ligacoes.push({ de: 'gv', para: 'apr', ordem: 3, condicao: { regras: [{ campo: 'valor', op: 'igual', valor: '1' }] } });
  });
  const r = await v(ou);
  assert.equal(temProblema(r, 'E_LIGACAO_DUPLICADA'), false);
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  const rep = await v(com((s) => { s.ligacoes.push({ de: 'ped', para: 'gv' }); }));
  assert.equal(temProblema(rep, 'E_LIGACAO_DUPLICADA', 'ligacoes[5]'), true);
});

// lookups
test('E_PAPEL_INEXISTENTE, E_CAMPO_INEXISTENTE com sugestão, consulta única', async () => {
  const chamadas = { papel: [], campos: 0 };
  const lookups = {
    papelExiste: async (c) => { chamadas.papel.push(c); return c === 'solicitante'; },
    camposFormulario: async () => { chamadas.campos++; return ['valor', 'Status']; },
  };
  const s = com((x) => { ativ(x, 'apr').responsavel.valor = 'solicitante'; });
  s.ligacoes[2].condicao.regras.push({ campo: 'status', op: 'igual', valor: 'B' });
  const r = await v(s, { lookups });
  assert.equal(temProblema(r, 'E_PAPEL_INEXISTENTE'), false);
  assert.deepEqual(chamadas.papel, ['solicitante']);
  assert.equal(chamadas.campos, 1);
  const e = r.erros.find((p) => p.codigo === 'E_CAMPO_INEXISTENTE');
  assert.ok(e);
  assert.match(e.mensagem, /você quis dizer "Status"/);

  const r2 = await v(specBase(), { lookups });
  assert.equal(temProblema(r2, 'E_PAPEL_INEXISTENTE', 'atividades[3].responsavel.valor'), true);
});

test('E_CAMPO_INEXISTENTE também confere valor com valorTipo campo', async () => {
  const s = com((x) => { Object.assign(x.ligacoes[2].condicao.regras[0], { campo: 'valor', valorTipo: 'campo', valor: 'outro' }); });
  const r = await v(s, { lookups: lookupsOk() });
  assert.equal(temProblema(r, 'E_CAMPO_INEXISTENTE', 'ligacoes[2].condicao.regras[0].valor'), true);
});

test('W_SEM_LOOKUP, W_SEM_FORMULARIO e W_LOOKUP_FALHOU (ok continua true)', async () => {
  assert.equal(temProblema(await v(specBase(), { lookups: lookupsOk() }), 'W_SEM_LOOKUP'), false);
  const sem = await v(specBase());
  assert.equal(sem.avisos.filter((a) => a.codigo === 'W_SEM_LOOKUP').length, 2);

  assert.equal(temProblema(await v(specBase(), { lookups: lookupsOk() }), 'W_SEM_FORMULARIO'), false);
  const semForm = await v(com((s) => { delete s.formId; }), { lookups: lookupsOk() });
  assert.equal(temProblema(semForm, 'W_SEM_FORMULARIO'), true);

  assert.equal(temProblema(await v(specBase(), { lookups: lookupsOk() }), 'W_LOOKUP_FALHOU'), false);
  const falha = await v(specBase(), {
    lookups: {
      papelExiste: async () => { throw new Error('sem rede'); },
      camposFormulario: () => Promise.reject(new Error('fora do ar')),
    },
  });
  assert.equal(falha.ok, true);
  assert.equal(falha.avisos.filter((a) => a.codigo === 'W_LOOKUP_FALHOU').length, 3);
});

test('fase 1 com erro não roda fase 2 nem lookups', async () => {
  let chamou = false;
  const lookups = { papelExiste: async () => { chamou = true; return true; }, camposFormulario: async () => { chamou = true; return []; } };
  const s = com((x) => {
    ativ(x, 'ped').tipo = 'humano';
    x.atividades.push({ id: 'sol', tipo: 'humana', nome: 'Solta' });
  });
  const r = await v(s, { lookups });
  assert.equal(temProblema(r, 'E_TIPO_ATIVIDADE'), true);
  assert.equal(temProblema(r, 'E_INALCANCAVEL'), false);
  assert.equal(chamou, false);
});

test('a spec não é alterada (com e sem erros)', async () => {
  const boa = specBase();
  const antesBoa = JSON.stringify(boa);
  await v(boa, { lookups: lookupsOk() });
  assert.equal(JSON.stringify(boa), antesBoa);

  const ruim = com((s) => { s.ligacoes[2].condicao.regras[0].valorTipo = 'x'; ativ(s, 'ped').tipo = 'servico'; });
  const antesRuim = JSON.stringify(ruim);
  await v(ruim);
  assert.equal(JSON.stringify(ruim), antesRuim);
});

test('erros trazem codigo, mensagem em texto e caminho', async () => {
  const r = await v(com((s) => { delete s.processId; }));
  for (const p of r.erros) {
    assert.equal(typeof p.codigo, 'string');
    assert.equal(typeof p.mensagem, 'string');
    assert.equal(typeof p.caminho, 'string');
  }
  assert.equal(r.ok, false);
});

test('padrao: saída padrão do gateway pode vir sem condicao e ordem; só com um dos dois continua erro', async () => {
  const semAmbos = com((s) => { delete s.ligacoes[3].condicao; delete s.ligacoes[3].ordem; s.ligacoes[3].padrao = true; });
  const r = await v(semAmbos);
  assert.equal(r.ok, true, JSON.stringify(r.erros));
  // padrao com condicao e ordem também vale
  assert.equal((await v(com((s) => { s.ligacoes[3].padrao = true; }))).ok, true);
  // padrao: false não muda nada
  assert.equal((await v(com((s) => { s.ligacoes[3].padrao = false; }))).ok, true);
  // padrao com condicao mas sem ordem, e com ordem mas sem condicao: erro
  const semOrdem = com((s) => { s.ligacoes[3].padrao = true; delete s.ligacoes[3].ordem; });
  assert.equal(temProblema(await v(semOrdem), 'E_GATEWAY_SEM_CONDICAO', 'ligacoes[3]'), true);
  const semCond = com((s) => { s.ligacoes[3].padrao = true; delete s.ligacoes[3].condicao; });
  assert.equal(temProblema(await v(semCond), 'E_GATEWAY_SEM_CONDICAO', 'ligacoes[3]'), true);
  // sem padrao, sem condicao continua erro
  const sem = com((s) => { delete s.ligacoes[3].condicao; delete s.ligacoes[3].ordem; });
  assert.equal(temProblema(await v(sem), 'E_GATEWAY_SEM_CONDICAO', 'ligacoes[3]'), true);
});

test('padrao: várias ligações OU para o mesmo destino padrão não repetem; dois destinos sim', async () => {
  const ou = com((s) => {
    s.ligacoes[3].padrao = true;
    s.ligacoes.push({ de: 'gv', para: 'can', ordem: 3, padrao: true, condicao: { js: 'true' } });
  });
  assert.equal(temProblema(await v(ou), 'E_PADRAO_REPETIDO'), false);
  const dois = com((s) => { s.ligacoes[2].padrao = true; s.ligacoes[3].padrao = true; });
  assert.equal(temProblema(await v(dois), 'E_PADRAO_REPETIDO', 'atividades[2]'), true);
});

test('conferirNoServidor: papel inexistente, campo inexistente, lookup lançando, sem lookup, spec sem listas', async () => {
  const spec = {
    formId: 7,
    atividades: [{ id: 'h', tipo: 'humana', nome: 'H', responsavel: { tipo: 'papel', valor: 'gestor' } }, { id: 'x', tipo: 'qualquer_coisa', nome: 'fora da v1' }],
    ligacoes: [{ de: 'h', para: 'x', condicao: { regras: [{ campo: 'valor', op: 'igual', valor: '1' }] } }],
  };
  const bom = { papelExiste: async () => true, camposFormulario: async () => ['valor'] };
  assert.deepEqual(await conferirNoServidor(spec, bom), { ok: true, erros: [], avisos: [] });

  const r1 = await conferirNoServidor(spec, { ...bom, papelExiste: async () => false });
  assert.equal(r1.ok, false);
  assert.equal(r1.erros[0].codigo, 'E_PAPEL_INEXISTENTE');

  const r2 = await conferirNoServidor(spec, { ...bom, camposFormulario: async () => ['outro'] });
  assert.equal(r2.erros[0].codigo, 'E_CAMPO_INEXISTENTE');

  const r3 = await conferirNoServidor(spec, { ...bom, papelExiste: async () => { throw new Error('caiu'); } });
  assert.equal(r3.ok, true);
  assert.equal(r3.avisos[0].codigo, 'W_LOOKUP_FALHOU');

  const r4 = await conferirNoServidor(spec, {});
  assert.deepEqual(r4.avisos.map((a) => a.codigo), ['W_SEM_LOOKUP', 'W_SEM_LOOKUP']);

  assert.deepEqual(await conferirNoServidor({ atividades: 'x' }, bom), { ok: true, erros: [], avisos: [] });
  assert.deepEqual(await conferirNoServidor(null, bom), { ok: true, erros: [], avisos: [] });
});
