# fluig-mcp

[![CI](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-informational)](package.json)
[![Ferramentas](https://img.shields.io/badge/ferramentas-97-success)](#as-ferramentas)

Servidor [MCP](https://modelcontextprotocol.io) para o **TOTVS Fluig**. Dá a um agente de IA —
Claude Code, Claude Desktop, Cursor, ou qualquer cliente MCP — acesso às APIs REST e SOAP do
Fluig: datasets, formulários, fichas, GED, eventos, agendador, processos BPM e a ponte para o
TOTVS RM (Corpore).

**97 ferramentas**, homologação e produção no mesmo servidor, sem abrir o Fluig Studio.

```
┌──────────────┐      stdio/MCP      ┌───────────┐   REST v1/v2   ┌──────────────┐
│ Claude Code  │ ◄─────────────────► │ fluig-mcp │ ◄────────────► │ TOTVS Fluig  │
│  (ou outro)  │                     │ 97 tools  │   SOAP/WSDL    │   + RM       │
└──────────────┘                     └───────────┘                └──────────────┘
```

## Por que isto existe

Desenvolver e operar no Fluig normalmente exige o Fluig Studio (Eclipse) na sua máquina e muito
clique no Painel de Controle. Coisas simples — ler o `beforeTaskSave` de um processo, descobrir
por que uma solicitação travou, conferir as linhas de uma tabela pai-filho, publicar uma versão
que ficou em edição — viram sessões inteiras de navegação manual.

Este servidor expõe tudo isso como ferramentas que um agente chama direto. E, mais importante:
ele **embute as armadilhas do produto** que custaram tempo para descobrir (veja
[Armadilhas conhecidas](#armadilhas-conhecidas-do-fluig)), para que você não precise redescobrir
cada uma na marra.

## Instalação

Requer **Node.js 20+**.

```bash
git clone https://github.com/alucardigo/fluig-mcp.git
cd fluig-mcp
npm install
```

Inspecione o que ele faz **antes** de dar credencial a ele:

```bash
node server.js --list
```

`--list` não carrega configuração nenhuma, de propósito: você consegue auditar a superfície
inteira antes de confiar uma senha ao processo.

## Configuração

Nenhuma variável tem default. Host ou senha embutidos no código seriam um vazamento esperando
acontecer, então variável faltando é **erro explícito**, nunca fallback silencioso para o
servidor de outra pessoa.

| Variável | Ambiente | Obrigatória |
|---|---|---|
| `FLUIG_HOST` · `FLUIG_USER` · `FLUIG_PASS` | homologação (`env: "teste"`) | para usar homologação |
| `FLUIG_HOST_PROD` · `FLUIG_USER_PROD` · `FLUIG_PASS_PROD` | produção (`env: "prod"`) | para usar produção |
| `FLUIG_READONLY=1` | ambos | não — mas leia [Segurança](#segurança) |

Configure um dos pares, ou os dois. Veja [`.env.example`](.env.example) para as opcionais
(tenant, datasources JNDI, IPs semente, prefixo dos datasets descartáveis).

### Registrando no cliente MCP

Claude Code / Claude Desktop (`~/.claude.json` ou `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "fluig": {
      "command": "node",
      "args": ["/caminho/para/fluig-mcp/server.js"],
      "env": {
        "FLUIG_HOST": "http://fluig-homolog.suaempresa.com.br:8080",
        "FLUIG_USER": "seu.usuario",
        "FLUIG_PASS": "sua-senha",
        "FLUIG_HOST_PROD": "https://fluig.suaempresa.com.br:8443",
        "FLUIG_USER_PROD": "seu.usuario",
        "FLUIG_PASS_PROD": "sua-senha-de-producao"
      }
    }
  }
}
```

> Se o seu cliente MCP demora a subir servidores pesados, aumente o timeout de inicialização
> (no Claude Code: `MCP_TIMEOUT`, em milissegundos). O default de 30 s estoura quando vários
> servidores sobem em paralelo — e o sintoma, `connection timed out`, parece bug deste servidor
> sem ser.

## `env` é obrigatório em toda chamada

Não existe ambiente default. Toda ferramenta exige `env: "teste"` ou `env: "prod"`, e omitir ou
errar o valor é recusado **antes de qualquer acesso à rede**.

Isso é deliberado e vem de dor real: com um default silencioso, quem pedia produção lia
homologação e reportava o número errado como se fosse de produção. Forçar a escolha explícita em
toda chamada custa nada e elimina os dois erros — ler o ambiente errado e escrever no ambiente
errado.

## Segurança

Este servidor pode alterar dados de produção. Ele foi construído assumindo isso.

**Modo somente leitura.** `FLUIG_READONLY=1` remove as 38 ferramentas de escrita da listagem e
passa a recusá-las. Recomendado para agente rodando sem supervisão.

```bash
FLUIG_READONLY=1 node server.js --list   # 64 ferramentas, nenhuma de escrita
```

**Gerador de fluxo.** `fluig_flow_deploy` recusa `env:"prod"` nesta versão, exige `confirm: true`,
confere a versão do servidor (recusa `versaoAlvo` maior) e publica sem SVG.

**Confirmação explícita.** Toda ferramenta de escrita exige `confirm: true`. As destrutivas
(`fluig_process_convert_instances`, `fluig_rm_save_record`) devolvem um **dry-run** com o plano
antes de executar qualquer coisa.

**Proteção da conta no AD.** O login aborta na primeira recusa em vez de repetir, e falha **sem
tocar a rede** quando não há senha configurada. Três falhas bloqueiam a conta em domínios com
`lockoutThreshold=3` — repetir login é o jeito mais fácil de deixar alguém sem acesso.

**Nem toda ferramenta "de leitura" é read-only.** Executar SQL arbitrário no Fluig exige que o
SQL viva dentro de um dataset, então `fluig_db_query`, `fluig_rm_db_query`, `fluig_service_list`,
`fluig_process_error_log` e `fluig_rm_dataserver_schema` **gravam** um dataset descartável para
rodar — e o SQL fica no histórico imutável (`FDN_DATASETHISTORY`). Elas estão marcadas como
escrita, exigem `confirm` em produção, e a descrição diz isso. Para ler o RM sem escrever nada,
use `fluig_rm_query` (sentença `WS.###`), que roda pelo `dataset-handle/search`.

Um dataset passthrough permanente eliminaria essa escrita, mas criaria coisa pior: um dataset
publicado que executa SQL de qualquer chamador com permissão de rodar dataset. Trocar rastro de
escrita por elevação de privilégio é mau negócio — por isso não foi feito.

Para reportar vulnerabilidade, veja [SECURITY.md](SECURITY.md).

## As ferramentas

`!` marca as que alteram o servidor.

**BPM e processos** (47)
`fluig_task_list` · `fluig_task_count` · `fluig_request_list` · `fluig_request_get` ·
`fluig_process_def_states` · `fluig_process_states` · `fluig_process_active_states` ·
`fluig_process_states_detail` · `fluig_process_actual_thread` · `fluig_process_history` ·
`fluig_process_attachments` · `fluig_process_attachment_download` · `fluig_process_available` ·
`fluig_process_available_users` · `fluig_process_available_users_start` · `fluig_process_search` ·
`fluig_process_version` · `fluig_process_versions` · `fluig_process_image` ·
`fluig_process_diagram_get` · `fluig_process_export_xml` · `fluig_process_events_xml` ·
`fluig_process_event_get` · `fluig_process_possible_assignees` · `fluig_process_formid` ·
`fluig_process_activities_resume` · `fluig_deadline_calc` · `fluig_workflow_exporter` ·
`fluig_workflow_check` · `fluig_workflow_events_get` · `fluig_deploy_list` ·
**!** `fluig_process_start` · **!** `fluig_process_move` · **!** `fluig_process_move_rest` ·
**!** `fluig_process_take` · **!** `fluig_process_cancel` · **!** `fluig_process_import_xml` ·
**!** `fluig_process_event_set` · **!** `fluig_process_event_set_xml` ·
**!** `fluig_process_version_release` · **!** `fluig_process_version_withdraw` ·
**!** `fluig_process_version_delete` · **!** `fluig_process_diagram_set` ·
**!** `fluig_process_create` · **!** `fluig_process_convert_instances` ·
**!** `fluig_process_error_log` · **!** `fluig_deploy_process` · **!** `fluig_workflow_events_update`

**Formulários e fichas** (15)
`fluig_form_list` · `fluig_form_events` · `fluig_form_files` · `fluig_form_file` ·
`fluig_form_full` · `fluig_form_fields` · `fluig_card_list` · `fluig_card_children_get` ·
`fluig_card_html_url` · `fluig_process_card_get` · `fluig_process_card_value` ·
**!** `fluig_form_save` · **!** `fluig_form_create` · **!** `fluig_card_save`

**Datasets** (12)
`fluig_dataset_list` · `fluig_dataset_get` · `fluig_dataset_run` · `fluig_dataset_structure` ·
`fluig_dataset_admin` · `fluig_dataset_history` · `fluig_dataset_draft_check` ·
**!** `fluig_dataset_save` · **!** `fluig_dataset_delete` · **!** `fluig_dataset_enable` ·
**!** `fluig_dataset_restore` · **!** `fluig_dataset_state_set`

**GED** (4)
`fluig_ged_list` · `fluig_ged_path` · `fluig_ged_download` · **!** `fluig_ged_upload`

**TOTVS RM e integração** (6)
`fluig_rm_query` · **!** `fluig_rm_db_query` · **!** `fluig_rm_db_exec` ·
**!** `fluig_rm_dataserver_schema` · **!** `fluig_rm_save_record` · **!** `fluig_service_list`

**Agendador** (4) · **Eventos globais** (2) · **Diagnóstico** (8)
`fluig_jobs_list` · **!** `fluig_job_add` · **!** `fluig_job_delete` · **!** `fluig_job_run` ·
`fluig_globalevent_list` · **!** `fluig_globalevent_save` · `fluig_ping` · `fluig_version` ·
`fluig_session_reset` · `fluig_user_replacements` · `fluig_rest_get` · **!** `fluig_rest_post` ·
**!** `fluig_db_query` · `fluig_log_search`

`fluig_log_search` lê o log do servidor pela widget de leitura de log instalada no Fluig
(padrão `/ascendra_log_viewer/api/logs`; outra base em `FLUIG_LOG_API`) e devolve o resultado
resumido: linhas cortadas, repetidas agrupadas e total limitado a cerca de 30 mil caracteres.

**Gerador de fluxo** (4)
`fluig_flow_validate` · `fluig_flow_generate` · `fluig_flow_read` · **!** `fluig_flow_deploy`

Geram o processo a partir de uma spec JSON (v1; formato no comentário de `src/flow/spec.js`), para
as versões alvo `1.8.2` e `2.0`. `validate` confere a spec e, no servidor (só leitura), papéis,
campos do formulário e versão do Fluig; `generate` devolve o XML ECM30; `read` exporta um processo
existente como spec, com `origem` para gerar de novo sem renumerar; `deploy` publica uma versão
(sem SVG). Fora da v1: subprocesso, eventos de mensagem e sinal, timer, atribuição fora de papel e SVG.

Descrição completa de cada uma: `node server.js --list`.

## Regenerar ECM30 e SVG de um `.process`

Dado `<projeto>/workflow/diagrams/<nome>.process`, o comando grava `workflow/.resources/<nome>.ecm30.xml`
e `<nome>.processimage.svg`, como a extensão Fluiggers faz ao salvar, sem VS Code nem Eclipse. Não
precisa de credencial do Fluig.

```
fluig-mcp regenerar <arquivo.process> [1.8.2|2.0] [--proprio | --oficial] [--nao-gravar] [--cache <pasta>] [--java <caminho>]
```

- **Requisitos:** Java 8 ou superior (`FLUIG_MCP_JAVA`, `JAVA_HOME` ou `java` no PATH) e o conversor
  instalado no cache (`~/.fluig-mcp`, ou `FLUIG_MCP_CACHE`). O comando confere o SHA-256 do cache a cada execução.
- **Instalar o conversor** (uma vez por máquina), de uma destas formas:
  - `fluig-mcp instalar-conversor --de <pasta plugins do Studio>` (aceita a raiz do Eclipse);
  - `fluig-mcp instalar-conversor --de <studio.zip>`;
  - `fluig-mcp instalar-conversor --baixar 1.8.2.0` (baixa os 13 JARs; só aceita arquivo cujo tamanho e SHA-256 batam com a tabela).
- **Licença:** os JARs são da TOTVS e da Eclipse Foundation (EPL) e ficam só na sua máquina; este
  repositório não os redistribui. O download com `--baixar` é feito por quem roda o comando, sob esses termos.
- **Plano B:** sem conversor instalado (ou com `--proprio`), o ECM30 sai do gerador próprio, com o aviso
  `W_ECM30_NAO_OFICIAL`. Ele recusa processo cuja leitura perderia comportamento (atribuição fora da v1,
  tipo de atividade fora da v1 etc.). O `.process` nunca é alterado; o ECM30 anterior vai para
  `.resources/.backups/` antes de ser trocado.

## Armadilhas conhecidas do Fluig

Cada item abaixo foi medido contra um servidor real e está embutido no código — a ferramenta
valida, converte ou explica em vez de deixar você tropeçar.

| Armadilha | O que acontece |
|---|---|
| `date-calculator` usa `seconds`, não `duration` | Mandar `duration` devolve `NullPointerException` — parece bug do produto e é parâmetro faltando. A API trabalha em **segundos**, mas o `deadlineTime` do modelo é gravado em **minutos**: trocar um pelo outro erra o prazo por 60×. |
| `childrens` lê, `children` escreve | A rota de leitura das linhas pai-filho é plural; a de escrita é singular. Trocar dá 404. |
| `folders/{id}/documents` devolve grid antigo | A lista vem em `invdata`, não em `items`, e `totalrecords` não é o total. Pasta cheia parece vazia para quem procura `items`. |
| `order` é obrigatório no GED | Sem ele, a rota devolve **500**, não 400. |
| `cardindex/html` não aceita `cardId` | Combinação inválida de parâmetros devolve **500**. Use `documentId`+`documentVersionId` ou `processId`+`processInstanceId`. |
| `tasks/count` sem filtro | Varre a base inteira e passa de 120 s. A ferramenta exige `processId`. |
| `states/activities/resume` falha em alguns processos | `javax.ejb.EJBException` independente dos parâmetros. Bug do produto — caia para `fluig_task_list`/`fluig_request_list`. |
| `dataset-handle/search` nunca devolve 404 | Dataset inexistente responde **200** com `columns`/`values` nulos. "Não existe" se disfarça de "zero linhas". |
| `constraintsField` sem valor inicial | Devolve **500**, não 400. Validado antes de sair da máquina. |
| Booleanos do BPM v2 são string | `?active=1` devolve 400; o enum é `["true","false"]`. |
| `pageSize` muda por rota | 1000 no BPM, **100** em `cards`/`childrens` e no GED. |
| `dataset-history` ignora `fields`/`expand` | Cada item traz o fonte inteiro (~8 KB). O histórico é **imutável pela API**: senha que já esteve num dataset continua legível lá. |
| Falar por IP quebra de dois jeitos | Dispara bloqueio de IPS ("Web Filter Violation") e quebra o TLS/SNI em HTTPS. O cliente sonda IP para saber se há caminho vivo, mas **chama pelo hostname**. |
| `cardData` do move SOAP substitui o registro | Todo campo não enviado **some**. Leia o card antes (`fluig_process_card_get`). |
| `convert_instances` é irreversível | Converter **finaliza** as tarefas pendentes e cria novas no destino. Mapeamento errado = trabalho em curso perdido. Dry-run obrigatório. |
| Anexo: bug de `@QueryParam` duplicado | Na rota plural, `user` e `replacedUser` têm a mesma anotação. A ferramenta usa só a singular. |
| `workflow-exporter` anonimiza por default | `anonymizeForms` é `true` no servidor. A ferramenta **exige** a escolha explícita. |
| `/documents/{id}/stream` mente o Content-Type | A implementação reusa o helper dos thumbnails. Confie no `Content-Disposition`. |
| 2xx sem corpo é normal | `release`, `withdraw`, `delete` devolvem 204; `dataset-history/restore` devolve 201 onde a spec diz 202. Nunca faça `JSON.parse` cego. |

## Desenvolvimento

```bash
npm run check   # checagem de sintaxe
npm test        # testes unitários (node --test)
npm run list    # superfície de ferramentas, sem credencial
```

Contribuições são bem-vindas — veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Créditos

**[Antonio (@antoniosdn)](https://github.com/antoniosdn)** — [PR #1](https://github.com/alucardigo/fluig-mcp/pull/1)

Diagnosticou que o `fetch` do Node deriva o SNI e a verificação do certificado **da URL**, não do
header `Host` — então chamar pelo IP fixado quebrava toda requisição HTTPS. O sintoma parecia
instabilidade de rede, e foi tratado como tal por bastante tempo antes de ele apontar a causa.
A correção foi estendida no merge para o cliente SOAP, onde o mesmo defeito existia.

Do fork dele vieram também três decisões de projeto que este repositório adotou:
**configuração sem defaults** (endpoint ou senha embutidos são vazamento esperando acontecer),
**modo somente leitura** e **`--list` auditável sem credencial** — a ideia de que a superfície de
ferramentas precisa ser inspecionável antes de o servidor receber uma senha, hoje verificada no CI.

Contribuições são bem-vindas: veja [CONTRIBUTING.md](CONTRIBUTING.md).

## Licença

[MIT](LICENSE).

Código de terceiros: `vendor/fluiggers-3.0.1/` contém um recorte da extensão Fluiggers para VS Code
3.0.1 (MIT, © 2020 Bruno Gasparetto); ver `LICENSE.txt` e `PROCEDENCIA.md` da pasta.

TOTVS, Fluig e RM/Corpore são marcas da TOTVS S.A. Este projeto é independente e não é afiliado,
patrocinado nem endossado pela TOTVS.
