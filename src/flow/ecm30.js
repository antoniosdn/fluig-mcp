/**
 * Modelos do XML ECM30 que o gerador de fluxo emite (passo 3). Só constantes.
 *
 * Cada modelo é um array de linhas `[campo, valorPadrao, versao?]`, na ordem em que o
 * Studio grava o elemento. Convenções:
 *   - valorPadrao `null`: campo variável, preenchido pelo gerador (erro de programação se ficar sem valor);
 *   - valorPadrao VAZIO_AUTO: elemento vazio gravado como `<campo/>` (e não `<campo></campo>`);
 *   - terceiro item '2.0': a linha só é emitida quando a versão alvo é 2.0.
 *
 * Fonte dos valores: os 10 ecm30.xml do demo Ascendra (saída do Studio para 1.8.2).
 * "n/m" nos comentários = ocorrências nesses arquivos. Ver plano-passo3-gerador-xml.md.
 */

/** Marca de elemento vazio gravado como `<x/>`. */
export const VAZIO_AUTO = Symbol('vazio-auto');

/**
 * Os 20 filhos da raiz `<list>`, na ordem. Os dois primeiros são elementos soltos;
 * os demais são `<list>`: o nome do elemento que ela guarda, ou null para lista sempre vazia.
 */
export const BLOCOS = [
  'ProcessDefinition', // 0
  'ProcessDefinitionVersion', // 1
  'ProcessState', // 2
  'ConditionProcessState', // 3
  'ProcessLink', // 4
  null, // 5 ProcessAttachmentSecurity
  null, // 6 WorkflowProcessEvent
  null, // 7 AdvancedProcessProperties
  null, // 8 SwimLane
  null, // 9
  null, // 10
  null, // 11 ProcessLinkBend
  null, // 12
  null, // 13 ExtendedPropertyField
  null, // 14 ProcessFormField
  'ProcessStateService', // 15
  null, // 16
  null, // 17
  null, // 18 ProcessAttachmentRules
  'ConditionProcessAutomaticRules', // 19
];

/** Índice (em BLOCOS) dos blocos que o gerador preenche. */
export const BLOCO = {
  definicao: 0,
  versao: 1,
  estados: 2,
  condicoes: 3,
  ligacoes: 4,
  servicos: 15,
  regras: 19,
};

/** ProcessDefinition (20 campos; variante sem managerEngineAllocationConfiguration) [demo 5/10]. */
export const M_PROCESSO = [
  ['processDefinitionPK', null],
  ['processDescription', null],
  ['instruction', ''],
  ['active', true],
  ['publicProcess', false],
  ['volumeId', null],
  ['categoryId', null],
  ['managerEngineAllocationId', ''],
  ['snapshotFrequency', 0],
  ['baseDay', 0],
  ['baseMonth', 0],
  ['periodId', null],
  ['uniqueCardVersion', false], // 9/10
  ['keyWord', ''],
  ['complementsLevel', 1],
  ['notifyRequisitionerComplements', true],
  ['notifyManagerComplements', false],
  ['deadlineTime', 0],
  ['warningDeadlineTime', 0],
  ['notifyAuthorityComplements', true],
];

/** ProcessDefinitionVersion [demo 10/10, ordem única]. formIdV2 só em 2.0. */
export const M_VERSAO = [
  ['processDefinitionVersionPK', null],
  ['versionDescription', ''],
  ['formId', null],
  ['formIdV2', 0, '2.0'],
  ['editionMode', true],
  ['updateAttachmentsVersion', false],
  ['controlsAttachmentsSecurity', false],
  ['active', true],
  ['blockedVersion', false],
  ['counterSign', false],
  ['openInstances', 0],
  ['bpmnVersion', 2],
  ['processStates', VAZIO_AUTO],
  ['favorito', false],
  ['inheritFormSecurity', false],
  ['mobileReady', false],
];

/** ProcessState de início (bpmnType 10) [demo 10/10]. */
export const M_INICIO = [
  ['processStatePK', null],
  ['stateName', null],
  ['stateDescription', null],
  ['instruction', ''],
  ['deadlineTime', 0],
  ['joint', false],
  ['agreementPercentage', 0],
  ['engineAllocationId', ''],
  ['engineAllocationConfiguration', ''],
  ['selectColleague', 1],
  ['initialState', true],
  ['notifyAuthorityDelay', true], // 9/10
  ['notifyRequisitionerDelay', false],
  ['allowanceAuthorityTime', 3600], // 9/10
  ['frequenceAuthorityTime', 3600], // 9/10
  ['allowanceRequisitionerTime', 0],
  ['frequenceRequisitionerTime', 0],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['notifyAuthorityFollowUp', false], // 9/10
  ['notifyRequisitionerFollowUp', false],
  ['automatic', false],
  ['positionX', null],
  ['positionY', null],
  ['forecastedEffortType', 0],
  ['forecastedEffort', 0],
  ['notifyManagerFollowUp', false],
  ['notifyManagerDelay', false],
  ['allowanceManagerTime', 0],
  ['frequenceManagerTime', 0],
  ['inhibitTransfer', false],
  ['periodId', ''], // 8/10
  ['stateType', 0],
  ['bpmnType', 10],
  ['signalId', 0],
  ['counterSign', false],
  ['openInstances', 0],
  ['noticeExpirationAuthorityTime', 0],
  ['noticeExpirationRequisitionerTime', 0],
  ['noticeExpirationManagerTime', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
];

/** ProcessState de atividade humana (bpmnType 80) [demo 56/56]. */
export const M_HUMANA = [
  ['processStatePK', null],
  ['stateName', null],
  ['stateDescription', null],
  ['instruction', ''],
  ['deadlineTime', 0], // moda, 21/56
  ['deadlineFieldName', ''],
  ['joint', false],
  ['agreementPercentage', 0],
  ['engineAllocationId', null],
  ['engineAllocationConfiguration', null],
  ['selectColleague', 1],
  ['initialState', false],
  ['notifyAuthorityDelay', true],
  ['notifyRequisitionerDelay', false],
  ['allowanceAuthorityTime', 3600],
  ['frequenceAuthorityTime', 3600],
  ['allowanceRequisitionerTime', 0],
  ['frequenceRequisitionerTime', 0],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['notifyAuthorityFollowUp', true], // 53/56
  ['notifyRequisitionerFollowUp', false],
  ['automatic', false],
  ['positionX', null],
  ['positionY', null],
  ['forecastedEffortType', 0],
  ['forecastedEffort', 0],
  ['notifyManagerFollowUp', false],
  ['notifyManagerDelay', false],
  ['allowanceManagerTime', 0],
  ['frequenceManagerTime', 0],
  ['inhibitTransfer', false],
  ['periodId', ''],
  ['stateType', 0],
  ['bpmnType', 80],
  ['signalId', 0],
  ['counterSign', false],
  ['openInstances', 0],
  ['noticeExpirationAuthorityTime', 0],
  ['noticeExpirationRequisitionerTime', 0],
  ['noticeExpirationManagerTime', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
  ['executionType', 0],
];

/** ProcessState de tarefa de serviço (bpmnType 82) [demo 9/9]: sem engineAllocationConfiguration. */
export const M_SERVICO = [
  ['processStatePK', null],
  ['stateName', null],
  ['stateDescription', null],
  ['instruction', ''],
  ['deadlineTime', 0],
  ['deadlineFieldName', ''],
  ['joint', false],
  ['agreementPercentage', 0],
  ['engineAllocationId', ''],
  ['selectColleague', 1],
  ['initialState', false],
  ['notifyAuthorityDelay', false],
  ['notifyRequisitionerDelay', false],
  ['allowanceAuthorityTime', 0], // 6/9
  ['frequenceAuthorityTime', 0], // 6/9
  ['allowanceRequisitionerTime', 0],
  ['frequenceRequisitionerTime', 0],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['notifyAuthorityFollowUp', true], // 9/9
  ['notifyRequisitionerFollowUp', false],
  ['automatic', false],
  ['positionX', null],
  ['positionY', null],
  ['forecastedEffortType', 0],
  ['forecastedEffort', 0],
  ['notifyManagerFollowUp', false],
  ['notifyManagerDelay', false],
  ['allowanceManagerTime', 0],
  ['frequenceManagerTime', 0],
  ['inhibitTransfer', false],
  ['periodId', ''],
  ['stateType', 0],
  ['bpmnType', 82],
  ['signalId', 0],
  ['counterSign', false],
  ['openInstances', 0],
  ['noticeExpirationAuthorityTime', 0],
  ['noticeExpirationRequisitionerTime', 0],
  ['noticeExpirationManagerTime', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
  ['executionType', null],
];

/** Captura de erro (bpmnType 43), só para serviço automatizado [demo 6/6]. */
export const M_CAPTURA = [
  ['processStatePK', null],
  ['stateName', 'Intermediário'],
  ['stateDescription', 'Intermediário'],
  ['instruction', 'Evento intermediário do processo'],
  ['deadlineTime', 0],
  ['joint', false],
  ['agreementPercentage', 0],
  ['engineAllocationId', ''],
  ['engineAllocationConfiguration', ''],
  ['selectColleague', 0],
  ['initialState', false],
  ['notifyAuthorityDelay', true],
  ['notifyRequisitionerDelay', false],
  ['allowanceAuthorityTime', 1],
  ['frequenceAuthorityTime', 1],
  ['allowanceRequisitionerTime', 0],
  ['frequenceRequisitionerTime', 0],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['notifyAuthorityFollowUp', true],
  ['notifyRequisitionerFollowUp', false],
  ['automatic', false],
  ['positionX', null],
  ['positionY', null],
  ['forecastedEffortType', 0],
  ['forecastedEffort', 0],
  ['notifyManagerFollowUp', false],
  ['notifyManagerDelay', false],
  ['frequenceManagerTime', 0], // sem allowanceManagerTime: ausente em 6/6
  ['inhibitTransfer', false],
  ['periodId', ''],
  ['stateType', 0],
  ['bpmnType', 43],
  ['signalId', 0],
  ['counterSign', false],
  ['openInstances', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
  ['parentSequence', null],
];

/** Eventos de fim (bpmnType 60, 65 e 68) [demo 60: 21/21, 65: 7/7; 68 sem exemplo, mesmo modelo]. */
export const M_FIM = [
  ['processStatePK', null],
  ['stateName', null],
  ['stateDescription', null],
  ['instruction', 'Atividade final do processo'],
  ['deadlineTime', 0],
  ['joint', false],
  ['agreementPercentage', 0],
  ['engineAllocationId', ''],
  ['engineAllocationConfiguration', ''],
  ['selectColleague', 0],
  ['initialState', false],
  ['notifyAuthorityDelay', true],
  ['notifyRequisitionerDelay', false],
  ['allowanceAuthorityTime', 0],
  ['frequenceAuthorityTime', 1],
  ['allowanceRequisitionerTime', 0],
  ['frequenceRequisitionerTime', 0],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['notifyAuthorityFollowUp', false],
  ['notifyRequisitionerFollowUp', true], // moda, 15/28
  ['automatic', false],
  ['positionX', null],
  ['positionY', null],
  ['forecastedEffortType', 0],
  ['forecastedEffort', 0],
  ['notifyManagerFollowUp', false],
  ['notifyManagerDelay', false],
  ['allowanceManagerTime', 0],
  ['frequenceManagerTime', 0],
  ['inhibitTransfer', false],
  ['periodId', ''],
  ['stateType', 6],
  ['bpmnType', null],
  ['signalId', 0],
  ['counterSign', false],
  ['openInstances', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
];

/** Gateways (bpmnType 120, 126 e 127) [demo 120: 33/33; 126 e 127 sem exemplo, mesmo modelo]. */
export const M_GATEWAY = [
  ['processStatePK', null],
  ['stateName', null],
  ['stateDescription', null],
  ['joint', false],
  ['initialState', false],
  ['transferAttachments', false],
  ['subProcessId', ''],
  ['formFolder', 0],
  ['automatic', null],
  ['positionX', null],
  ['positionY', null],
  ['inhibitTransfer', false],
  ['stateType', null],
  ['bpmnType', null],
  ['signalId', 0],
  ['openInstances', 0],
  ['destinationStates', VAZIO_AUTO],
  ['digitalSignature', false],
];

/** ProcessLink [demo 153/168: variante sem os campos movement*]. */
export const M_LIGACAO = [
  ['processLinkPK', null],
  ['actionLabel', ''],
  ['returnPermited', null],
  ['initialStateSequence', null],
  ['finalStateSequence', null],
  ['returnLabel', ''],
  ['name', ''],
  ['automaticLink', false],
  ['defaultLink', false],
  ['type', 0],
];

/** ConditionProcessState. `condition` só nas condições em JavaScript; conditionName só em 2.0. */
export const M_CONDICAO = [
  ['conditionProcessStatePK', null],
  ['condition', null],
  ['destinationSequenceId', null],
  ['conditionType', null],
  ['conditionName', null, '2.0'],
];

/** ConditionProcessAutomaticRules [demo medicao_contrato 3/3]. */
export const M_REGRA = [
  ['sequence', null],
  ['expressionOrder', null],
  ['ruleOrder', null],
  ['field', null],
  ['value', null],
  ['operator', null],
  ['valueType', null],
];

/** ProcessStateService [demo 9/9]. */
export const M_SERVICO_CONFIG = [
  ['companyId', null],
  ['processId', null],
  ['version', 1],
  ['sequence', null],
  ['attempts', null],
  ['sucessFullMessage', ''],
  ['serviceName', ''],
  ['frequency', null],
  ['frequencyType', 0],
];

/** Chaves (PK) por tipo de elemento: nome do filho e campos, na ordem do demo. */
export const PK = {
  processo: ['companyId', 'processId'],
  versao: ['companyId', 'processId', 'version'],
  estado: ['companyId', 'processId', 'version', 'sequence'],
  ligacao: ['companyId', 'processId', 'version', 'linkSequence'],
  condicao: ['companyId', 'processId', 'expressionOrder', 'version', 'sequence'],
};
