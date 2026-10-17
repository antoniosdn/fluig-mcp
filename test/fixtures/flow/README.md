# Fixtures do leitor de XML ECM30 (passo 2 do gerador de fluxo)

| Arquivo | Origem | Observação |
|---|---|---|
| `medicao_contrato.ecm30.xml` | Demo Ascendra (`fluig-demo-ascendra/workflow/.resources/`) | Saneada. Servidor 1.8.2. Condições por regras (`conditionType` 1), serviço imediato, 2 cancelamentos, `Pool Papel` e `Executor Atividade`, 3 raias, 1 script. |
| `rpa.ecm30.xml` | Demo Ascendra (`fluig-demo-ascendra/workflow/.resources/`) | Saneada. 2 serviços automatizados, cada um com captura de erro ligada a uma atividade de tratamento; `Campo Formulário`, `Executor Atividade`, 4 scripts. |
| `sintetico-paralelo-2.0.ecm30.xml` | **Sintética**, montada à mão | Formato do export do servidor 2.0 (gateway paralelo, captura de erro sem ligação, nome de condição, regra `preenchido`, `icon`, `processCategoryId`, `processDiagram`). Não veio de servidor nem tem dado de cliente. |

## Saneamento das fixtures do demo

Única alteração: o conteúdo de todo `<eventDescription>...</eventDescription>` (texto dos scripts de evento)
foi trocado por `// script omitido na fixture`. Nada mais muda.

Conferência feita ao copiar:

- `grep -ic clariens` = 0 nas duas;
- a quantidade de `<eventDescription>// script omitido na fixture</eventDescription>` é igual à de `<WorkflowProcessEvent>` (1 em `medicao_contrato`, 4 em `rpa`);
- o diff contra o original só tem linhas de `eventDescription`.

Os arquivos ficam sem CRLF (LF), como no original.

## Ajuste na fixture sintética (passo 4)

No gateway exclusivo `sequence` 9 (`Aprovado?`), `<automatic>false</automatic>` virou `true`: o conversor e o export do
servidor sempre gravam `automatic=true` nos gateways exclusivos (bpmnType 120) e o gerador faz o mesmo. A fixture tinha
sido montada à mão com `false`. Foi a única linha alterada.
