// Monta .process sintéticos com o editor do vendor Fluiggers (mesma receita do flow-fluiggers.test.js).
// Não é um teste: só um utilitário importado por flow-process e flow-regenerar.
import { carregarFluiggers } from '../src/flow/fluiggers.js';

/**
 * @param {{id?: string, nome?: string, atribuicao?: {mechanism: string, mechanismConfiguration: object}|null,
 *          gateway?: boolean}} o
 * Com gateway (padrão): início → humana → gateway →(regras E js, OU)→ fim; gateway →(padrão)→ cancelamento.
 * Sem gateway: início → humana → fim.
 * `servico` (só com gateway: false) acrescenta humana → serviço automatizado (com captura de erro) → fim e uma
 * segunda humana (tratamento): 'tratado' = captura → tratamento; 'sem_saida' = captura sem fluxo;
 * 'duas_saidas' = captura → tratamento e → fim; 'com_entrada' = tratamento → captura além da saída.
 */
export function montarProcessoSintetico({ id = 'sintetico', nome = 'Aprovar', atribuicao, gateway = true, servico } = {}) {
  const F = carregarFluiggers();
  const E = F.editor;
  const tpl = F.templateCriacao;
  let texto = F.buildProcessScaffold(tpl, id, { description: 'Processo sintetico' }).text;
  const no = (kind, subtype, x, y) => {
    const r = E.createIsolatedNode(texto, { kind, subtype, x, y, templateText: tpl });
    texto = r.text;
    return r.elementId;
  };
  const lig = (a, b) => {
    texto = E.createSequenceFlow(texto, { sourceId: a, targetId: b, bendpoints: [], templateText: tpl }).text;
  };
  const inicio = no('start', '10', 60, 100);
  const humana = no('task', '80', 220, 90);
  texto = E.patchProcess(texto, humana, { name: nome }).text;
  lig(inicio, humana);
  const ids = { inicio, humana };
  if (gateway) {
    const gw = no('gateway', '120', 400, 100);
    const fim = no('end', '60', 600, 60);
    const canc = no('end', '65', 600, 160);
    lig(humana, gw);
    lig(gw, fim);
    lig(gw, canc);
    const fluxos = F.parseProcess(texto).flows;
    const fluxoCanc = fluxos.find((f) => f.attributes.targetRef === canc).id;
    texto = E.patchGatewayBranches(texto, gw, {
      defaultFlowId: fluxoCanc,
      conditions: [
        {
          order: 1,
          targetId: fim,
          conditionType: '1',
          rules: [
            { field: 'parecer', operator: '1', value: 'sim', valueType: '1', ruleOrder: 1 },
            { field: 'valor', operator: '3', value: 'limite', valueType: '0', ruleOrder: 2 },
          ],
        },
        { order: 2, targetId: fim, conditionType: '0', expression: 'hAPI.getCardValue("x") == "1"' },
      ],
    }).text;
    Object.assign(ids, { gateway: gw, fim, cancelamento: canc, fluxoCancelamento: fluxoCanc });
  } else {
    const fim = no('end', '60', 420, 100);
    lig(humana, fim);
    ids.fim = fim;
    if (servico) {
      const srv = no('task', '82', 300, 200);
      texto = E.patchProcess(texto, srv, { name: 'Integrar', executionType: '1' }).text;
      const rc = E.createAttachedErrorEvent(texto, { taskId: srv, x: 340, y: 255, templateText: tpl });
      texto = rc.text;
      const trata = no('task', '80', 300, 320);
      texto = E.patchProcess(texto, trata, { name: 'Tratar erro' }).text;
      lig(humana, srv);
      lig(srv, fim);
      lig(trata, fim);
      if (servico !== 'sem_saida') lig(rc.elementId, trata);
      if (servico === 'duas_saidas') lig(rc.elementId, fim);
      if (servico === 'com_entrada') lig(trata, rc.elementId);
      Object.assign(ids, { servico: srv, captura: rc.elementId, tratamento: trata });
    }
  }
  const attr = atribuicao === undefined ? { mechanism: 'Pool Papel', mechanismConfiguration: { roleId: 'admin' } } : atribuicao;
  if (attr) {
    // O editor grava o managerMechanism só na segunda aplicação (a primeira grava apenas a configuração).
    texto = E.patchTaskAssignment(texto, humana, attr).text;
    texto = E.patchTaskAssignment(texto, humana, attr).text;
  }
  return { texto, ids };
}
