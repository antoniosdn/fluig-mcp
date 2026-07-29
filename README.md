# fluig-mcp

[![CI](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-informational)](package.json)

**Opere um ambiente TOTVS Fluig por um agente de IA ou pelo terminal — datasets, formulários,
eventos globais e definições de processo BPM — sem abrir o Fluig Studio.**

---

## Por quê

Desenvolver no Fluig normalmente passa pelo Fluig Studio, uma distribuição do Eclipse. Ler um
evento de formulário, descobrir qual dataset um workflow chama ou subir uma correção de uma linha
num service task significa abrir a IDE, exportar um pacote, importar de volta e publicar na mão.
Nada desse ciclo é automatizável, e nada dele é acessível a um agente.

Tudo o que o Fluig Studio faz, ele faz por HTTP. O `fluig-mcp` fala os mesmos três protocolos da
plataforma — o cookie de sessão do `login.do`, os serviços SOAP legados em `/webdesk/*` e a API
REST v2 — de dentro de um processo Node comum. Isso expõe a plataforma inteira como ferramentas
[Model Context Protocol](https://modelcontextprotocol.io): o assistente lê o `validateForm` de um
formulário, rastreia por que uma tarefa caiu na pessoa errada ou publica uma versão corrigida de
processo na mesma conversa em que a pergunta apareceu.

## O que faz

- **Datasets** — listar, ler o código de um dataset custom, inspecionar a estrutura sem executar,
  executar, criar, atualizar e apagar.
- **Formulários** — listar, ler todos os arquivos e eventos, e publicar nova versão.
- **Eventos globais** — ler e gravar.
- **Definições de processo BPM** — exportar o `.ecm30.xml`, ler e alterar o código dos eventos de
  processo, publicar nova versão, **retirar do ar para reverter** e apagar versões.
- **Solicitações** — iniciar, assumir, mover, cancelar; ler o card, o histórico, os anexos, os
  estados ativos e disponíveis, e quem pode receber a tarefa.
- **SQL passthrough** — `SELECT` read-only no banco do Fluig e no TOTVS RM, direto ou pela
  sentença registrada.
- **Escape hatches** — `GET`/`POST` autenticado em qualquer caminho da API.

São 56 ferramentas. `node server.js --list` mostra todas — e não pede credencial nenhuma, para
você auditar a superfície antes de confiar alguma a ela.

### Evento de processo sem widget

O código dos eventos de processo vive dentro do XML da definição, em
`<WorkflowProcessEvent><eventDescription>`. O `fluig-mcp` lê de lá e grava de volta exportando a
definição, alterando só aquele evento e reimportando — o que faz de cada escrita uma **nova
versão, revertível**, que passou pela validação do servidor, num servidor sem nenhum add-on
instalado. O round-trip é byte a byte: acentos, aspas e o `$` do jQuery sobrevivem intactos
([teste de regressão](test/client.test.js)).

## Requisitos

- Node.js 20 ou superior.
- Acesso de rede a um ambiente Fluig (testado contra Fluig 1.8.x).
- Um usuário do Fluig. A maioria das ferramentas quer perfil administrativo; as de solicitação
  agem como esse usuário e precisam dos papéis correspondentes.

## Instalação

```bash
git clone https://github.com/alucardigo/fluig-mcp.git
cd fluig-mcp
npm install
```

## Configuração

Toda a configuração vem de variáveis de ambiente. **Não existe default de host nem de
credencial** — variável faltando é erro explícito, nunca um fallback silencioso.

| Variável | Obrigatória | Default | O que é |
|---|:-:|---|---|
| `FLUIG_HOST` | sim | — | URL base do portal, com esquema e porta |
| `FLUIG_USER` | sim | — | Login do Fluig |
| `FLUIG_PASS` | sim | — | Senha desse login |
| `FLUIG_COMPANY` | não | `1` | Tenant; `-1` faz o servidor resolver |
| `FLUIG_USERCODE` | não | `FLUIG_USER` | Colleague id, quando difere do login |
| `FLUIG_READONLY` | não | `0` | `1` expõe só as ferramentas que não alteram o servidor |
| `FLUIG_IPS` | não | — | IPs de fallback (vírgula), sondados quando o DNS oscila |
| `FLUIG_DATASOURCE` | não | `/jdbc/AppDS` | Datasource JNDI do banco do Fluig |
| `FLUIG_RM_DATASOURCE` | não | `/jdbc/Corpore` | Datasource JNDI do banco do TOTVS RM |
| `FLUIG_RM_BRIDGE_DATASET` | não | `ds_generic_rm_sql` | Dataset que repassa sentenças SQL do RM |
| `FLUIG_SCRATCH_PREFIX` | não | `ds_mcp_` | Prefixo dos datasets descartáveis criados aqui |

Veja [`.env.example`](.env.example).

### Claude Code

```bash
claude mcp add fluig \
  --env FLUIG_HOST=https://fluig.exemplo.com:8080 \
  --env FLUIG_USER=seu.usuario \
  --env FLUIG_PASS=sua-senha \
  -- node /caminho/absoluto/para/fluig-mcp/server.js
```

### Claude Desktop, Cursor ou qualquer outro cliente MCP

```json
{
  "mcpServers": {
    "fluig": {
      "command": "node",
      "args": ["/caminho/absoluto/para/fluig-mcp/server.js"],
      "env": {
        "FLUIG_HOST": "https://fluig.exemplo.com:8080",
        "FLUIG_USER": "seu.usuario",
        "FLUIG_PASS": "sua-senha",
        "FLUIG_READONLY": "1"
      }
    }
  }
}
```

Comece com `FLUIG_READONLY=1`. Tire quando já souber o que o agente faz com as ferramentas de
leitura.

## Testando

A CLI usa o mesmo cliente, então é o caminho mais rápido para provar credencial e conectividade
antes de envolver um agente:

```bash
export FLUIG_HOST=https://fluig.exemplo.com:8080
export FLUIG_USER=seu.usuario
export FLUIG_PASS=sua-senha

node bin/cli.js ping
node bin/cli.js dataset list colleague
node bin/cli.js form list
node bin/cli.js process events MeuProcesso
```

`node bin/cli.js --help` lista todos os comandos. O que for baixado vai para `./out`
(fora do git).

## Ferramentas

`!` marca ferramenta que altera o servidor. Essas desaparecem por completo com
`FLUIG_READONLY=1`, e cada uma exige `confirm: true` explícito.

**Sessão**

| Ferramenta | O que faz |
|---|---|
| `fluig_ping` | Valida autenticação e sessão |

**Datasets**

| Ferramenta | O que faz |
|---|---|
| `fluig_dataset_list` | Lista datasets, com filtro opcional |
| `fluig_dataset_get` | Código-fonte de um dataset custom |
| `fluig_dataset_structure` | Colunas e tipos, sem executar o dataset |
| `fluig_dataset_run` | Executa e devolve as linhas |
| `!` `fluig_dataset_save` | Cria ou atualiza dataset custom (código ES5/Rhino) |
| `!` `fluig_dataset_delete` | Apaga dataset custom |

**Formulários**

| Ferramenta | O que faz |
|---|---|
| `fluig_form_list` | Lista formulários |
| `fluig_form_events` | Eventos de customização com o código (`displayFields`, `validateForm`, …) |
| `fluig_form_files` / `fluig_form_file` | Lista arquivos / lê um arquivo |
| `fluig_form_full` | Metadados, todos os arquivos e todos os eventos numa chamada |
| `!` `fluig_form_save` | Publica nova versão do formulário |

**Eventos globais**

| Ferramenta | O que faz |
|---|---|
| `fluig_globalevent_list` | Lista eventos globais |
| `!` `fluig_globalevent_save` | Cria ou atualiza um |

**SQL**

| Ferramenta | O que faz |
|---|---|
| `fluig_db_query` | `SELECT` read-only no banco do Fluig |
| `fluig_rm_db_query` | `SELECT` read-only no banco do TOTVS RM |
| `fluig_rm_query` | Consulta ao RM pela sentença registrada (dataset ponte) |
| `!` `fluig_rm_db_exec` | `INSERT`/`UPDATE`/`DELETE` no RM |

**Definições de processo**

| Ferramenta | O que faz |
|---|---|
| `fluig_process_export_xml` | Baixa a definição como `.ecm30.xml` |
| `fluig_process_events_xml` | Eventos de processo com o código, direto da definição |
| `fluig_process_versions` / `fluig_process_version` | Versões / versão ativa |
| `fluig_process_formid` / `fluig_process_image` | Formulário vinculado / diagrama |
| `fluig_process_search` / `fluig_process_available` | Busca / o que o usuário pode iniciar |
| `fluig_deploy_list` | Processos disponíveis para export |
| `fluig_process_event_get` | Código do evento na `event_proces` (leitura legada) |
| `!` `fluig_process_event_set_xml` | Grava evento como nova versão (aceita `dryRun`) |
| `!` `fluig_process_import_xml` | Deploy da definição pela REST v2 |
| `!` `fluig_deploy_process` | Deploy da definição por SOAP |
| `!` `fluig_process_version_withdraw` | Retira a versão do ar — é como se reverte um deploy |
| `!` `fluig_process_version_delete` | Apaga uma versão |
| `!` `fluig_process_diagram_set` | Substitui o SVG do diagrama da versão |
| `!` `fluig_process_event_set` | Alteração in-place da `event_proces` (obsoleto) |

**Solicitações**

| Ferramenta | O que faz |
|---|---|
| `fluig_process_states` / `fluig_process_states_detail` | Estados-destino disponíveis |
| `fluig_process_active_states` / `fluig_process_actual_thread` | Onde a solicitação está |
| `fluig_process_card_get` / `fluig_process_card_value` | Card inteiro / um campo |
| `fluig_process_history` / `fluig_process_attachments` | Histórico / anexos |
| `fluig_process_available_users` / `..._start` | Quem pode receber a tarefa |
| `fluig_user_replacements` | Quem responde por quem, e até quando |
| `!` `fluig_process_start` | Inicia uma solicitação |
| `!` `fluig_process_take` | Assume tarefa de pool |
| `!` `fluig_process_move` | Salva o card e move a solicitação |
| `!` `fluig_process_cancel` | Cancela a solicitação |

**Add-on FluiggersWidget (opcional)** — dispensável; as ferramentas `_xml` acima resolvem o mesmo
num servidor sem add-on.

| Ferramenta | O que faz |
|---|---|
| `fluig_workflow_check` | O widget está instalado? |
| `fluig_workflow_events_get` | Lê eventos de processo pelo widget |
| `!` `fluig_workflow_events_update` | Grava eventos de processo pelo widget |

**Escape hatches**

| Ferramenta | O que faz |
|---|---|
| `fluig_rest_get` | `GET` autenticado em qualquer caminho |
| `!` `fluig_rest_post` | `POST` autenticado em qualquer caminho |

## Como funciona por baixo

| Assunto | Mecanismo |
|---|---|
| Autenticação | `POST /portal/api/servlet/login.do` → cookie `JSESSIONIDSSO`, reaproveitado em tudo — inclusive na REST v2, que o aceita em vez de OAuth |
| Datasets | SOAP `ECMDatasetService` para listar/executar, REST `dataset/loadDataset\|createDataset\|editDataset` para ler/gravar |
| Formulários | SOAP `ECMCardIndexService` |
| Eventos globais | REST `ecm/globalevent/*` |
| Definições de processo | REST v2 `/process-management/api/v2/processes/*`, com SOAP `WorkflowEngineService` como rota alternativa de deploy |
| Solicitações | SOAP `WorkflowEngineService` |
| SQL | Um dataset custom descartável que abre o datasource JNDI no servidor e roda a instrução |

**Resiliência de rede.** Fluig quase sempre está atrás de DNS corporativo, e DNS corporativo
mente: zonas split-horizon devolvem endereço inalcançável de onde você está, e um lookup azarado
fica idêntico a uma queda de servidor. Então o cliente resolve o endereço ele mesmo — último IP
bom, `dns.resolve4`, `dns.lookup`, seeds do operador —, sonda os candidatos por TCP em paralelo,
fixa o primeiro que responde e preserva o `Host` original para o virtual host continuar
funcionando. O endereço bom fica em cache curto e é re-sondado em qualquer falha. Toda chamada
também tem retry com backoff, e só insiste em erro de fato transiente.

## Segurança

Este servidor entrega a um LLM a capacidade de rodar SQL, publicar formulários e **apagar
definições de processo**. Trate com o cuidado correspondente.

- **`FLUIG_READONLY=1`** esconde as 18 ferramentas de escrita. Sobram 38, incluindo tudo o que é
  necessário para ler e diagnosticar.
- Toda operação destrutiva exige `confirm: true` explícito; não existe sim por omissão.
- `fluig_process_event_set_xml` e `fluig_process_import_xml` criam **nova versão** em vez de
  mexer na que está no ar, então `fluig_process_version_withdraw` reverte um deploy ruim.
- As ferramentas de consulta aceitam só `SELECT`/`WITH`, validado antes de a instrução sair do
  processo.
- Para rodar SQL, o servidor grava um dataset descartável chamado `${FLUIG_SCRATCH_PREFIX}*`
  (por padrão `ds_mcp_dbquery`, `ds_mcp_rmquery`, …). Isso acontece em modo read-only também,
  porque é assim que a leitura funciona. Tudo com esse prefixo no seu servidor foi criado aqui e
  pode ser apagado com `fluig_dataset_delete`.
- Aponte primeiro para um ambiente de teste ou homologação.

Veja [SECURITY.md](SECURITY.md).

## Limitações

- Formulário é orientado a leitura: `fluig_form_save` substitui todo o conjunto de arquivos e
  eventos, então leia com `fluig_form_full` antes ou você perde o que não mandou.
- O datasource do RM costuma estar configurado como read-only. Quando está, o caminho suportado
  de escrita no RM é a API DataServer do RM, não o `fluig_rm_db_exec`.
- O dataset ponte de sentenças (`FLUIG_RM_BRIDGE_DATASET`) é convenção de integração, não
  garantia de plataforma — o nome e a existência variam por instalação.
- Código de dataset roda em Rhino: só ES5, sem `let`/`const`, arrow function ou template string.
- Verificado contra Fluig 1.8.x. Outras versões provavelmente funcionam, mas não foram testadas.

## Desenvolvimento

```bash
npm test      # testes de unidade, não precisa de servidor
npm run check # checagem de sintaxe de todos os fontes
npm run list  # imprime a superfície de ferramentas
```

Os testes usam o runner nativo `node:test` e rodam offline — a camada de rede é stubada, então a
suíte roda em qualquer lugar. Veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

O protocolo de dataset e formulário foi originalmente mapeado pelo projeto comunitário
[`fluig-vscode-extension`](https://github.com/fluiggers/fluig-vscode-extension) (Fluiggers), que
vale muito a pena se você escreve código Fluig no VS Code. As rotas de definição de processo,
ciclo de vida de solicitação e deploy aqui foram mapeadas de forma independente contra um
servidor real.

## Aviso

Projeto independente e não oficial. Sem vínculo, endosso ou suporte da TOTVS. TOTVS, Fluig e RM
são marcas da TOTVS S.A. Alguns endpoints usados aqui são internos ou não documentados e podem
mudar entre versões.

## Licença

[MIT](LICENSE) © Rodrigo de Souza Faria
