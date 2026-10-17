/**
 * Spec v1 do gerador de fluxo (processo BPM do Fluig).
 *
 * Formato (JSON):
 *   {
 *     processId: string,            // sem espaço; ideal [A-Za-z0-9_]
 *     descricao?: string,
 *     formId?: inteiro > 0,         // formulário vinculado (confere campos)
 *     atividades: [{
 *       id: string único, tipo: uma chave de TIPOS, nome: string,
 *       responsavel?: { tipo: 'papel' | 'pool_papel', valor: string },  // só em humana
 *       execucao?: 'automatizada' | 'imediata',                          // só e obrigatório em servico
 *       tratamentoErro?: id, // só e obrigatório em servico automatizada: atividade humana que trata o erro (saída da captura)
 *       posicao?: { x: número, y: número }
 *     }],
 *     ligacoes: [{
 *       de: id, para: id,
 *       ordem?: inteiro >= 1,       // só em saída de gateway_exclusivo
 *       condicao?: { regras: [{ campo, op, valor?, valorTipo? }], nome? }
 *               | { js: string, nome? },   // só em saída de gateway_exclusivo
 *       retorno?: boolean,          // returnPermited
 *       padrao?: true               // saída padrão de gateway_exclusivo (ProcessLink.defaultLink);
 *                                   // pode vir sem condicao/ordem
 *     }]
 *   }
 *
 * Regras de uma condição combinam por E. OU = várias ligações do mesmo
 * gateway para o mesmo destino, cada uma com sua ordem.
 * `valorTipo` ausente equivale a "fixo". `condicao.nome` só com versaoAlvo 2.0.
 * A captura de erro do serviço automatizado é criada pelo gerador e ligada a `tratamentoErro`
 * (essa ligação não entra em `ligacoes`). Ordem das chaves da atividade: id, tipo, nome, responsavel,
 * execucao, tratamentoErro, posicao.
 *
 * Este módulo só tem constantes (sem lógica), com o mapa para os números do ECM30.
 */

/** tipo da spec -> números do ECM30 (bpmnType, stateType). */
export const TIPOS = {
  inicio: { bpmnType: 10, stateType: 0 },
  humana: { bpmnType: 80, stateType: 0 },
  servico: { bpmnType: 82, stateType: 0 },
  gateway_exclusivo: { bpmnType: 120, stateType: 1 },
  gateway_paralelo_abertura: { bpmnType: 126, stateType: 3 },
  gateway_paralelo_juncao: { bpmnType: 127, stateType: 4 },
  fim: { bpmnType: 60, stateType: 6 },
  cancelamento: { bpmnType: 65, stateType: 6 },
  fim_terminativo: { bpmnType: 68, stateType: 6 },
};

/** Tipos reconhecidos mas fora da v1, com o motivo exibido no erro. */
export const TIPOS_FORA_V1 = {
  espera: 'a configuração do timer ainda não está confirmada, o gerador não saberia emitir',
  subprocesso: 'subprocesso não faz parte da v1',
  captura_erro:
    'o gerador cria a captura de erro sozinho para serviço automatizado; indique a atividade que trata o erro em tratamentoErro',
  mensagem: 'eventos de mensagem não fazem parte da v1',
  sinal: 'eventos de sinal não fazem parte da v1',
};

/** Tipos de atividade aceitos como tratamento do erro de um serviço automatizado (v1). */
export const TIPOS_TRATAMENTO = ['humana'];

/** Tipos que encerram o fluxo. */
export const TIPOS_FIM = ['fim', 'cancelamento', 'fim_terminativo'];

/** op da spec -> operator do ECM30. */
export const OPERADORES = {
  vazio: 0,
  igual: 1,
  diferente: 2,
  maior: 3,
  maior_igual: 4,
  menor: 5,
  menor_igual: 6,
  contem: 7,
  nao_contem: 8,
  preenchido: 9,
};

/** Operadores que não usam valor. */
export const OPS_SEM_VALOR = ['vazio', 'preenchido'];

/** Operadores de comparação (texto x número não confirmado no Fluig). */
export const OPS_COMPARACAO = ['maior', 'maior_igual', 'menor', 'menor_igual'];

/** valorTipo da spec -> valueType do ECM30. */
export const VALOR_TIPOS = { fixo: 1, campo: 0 };

/** execucao da spec -> executionType do ECM30. */
export const EXECUCAO = { automatizada: 1, imediata: 2 };

/** Tipos de responsável aceitos na v1. */
export const RESPONSAVEL_TIPOS = ['papel', 'pool_papel'];

/** Versões do Fluig aceitas em versaoAlvo. */
export const VERSOES_ALVO = ['1.8.2', '2.0'];
