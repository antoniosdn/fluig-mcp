# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/);
versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [Não lançado]

### Adicionado

- `fluig_flow_import` e `fluig-mcp importar`: importam um processo do servidor como o "importar processo"
  do Fluig Studio, pela ponte Java `src/flow/ponte-importador/` e o importador do próprio Studio. O
  `.process` sai com os ids iguais aos números do servidor (a importação pela Fluiggers renumerava), com
  raias, scripts de evento e literais. Antes de gravar, é conferido pela Fluiggers e o ECM30 que o
  conversor oficial gera dele precisa ter os mesmos números de atividades e ligações do servidor.
  Exige Java 8+ x64 (no Mac com chip Apple, sob Rosetta); macOS e Windows.
- `instalar-conversor` instala também o importador do Studio (17 JARs, `~/.fluig-mcp/importador/<versão>`,
  conferidos por SHA-256); `--sem-importador` pula.
- `fluig_flow_deploy` com `novo=false` reaplica o `slotId` dos campos descritores do servidor, que o
  conversor do Studio renumerava (`W_SLOTS_DO_SERVIDOR`).
- Gerador de fluxo: serviço automatizado exige `tratamentoErro` (id da atividade humana que trata o erro); a captura de erro sai ligada à atividade de tratamento no ECM30 e no `.process`, e os leitores reconhecem essa ligação em vez de tratá-la como fora da v1.
- Cópia fixa de parte da extensão Fluiggers 3.0.1 (MIT) em `vendor/fluiggers-3.0.1/` e carregador
  `src/flow/fluiggers.js`, base para gerar e regenerar `.process`/SVG sem VS Code.
- Gerador de fluxo: `fluig_flow_validate`, `fluig_flow_generate`, `fluig_flow_read` e
  `fluig_flow_deploy`. Geram o XML ECM30 de um processo a partir de uma spec JSON (versões alvo
  1.8.2 e 2.0), conferem papéis, campos e versão no servidor e publicam pelo SOAP oficial. O
  deploy recusa `prod` e exige `confirm`.
- Gerar `.process` + ECM30 + SVG a partir da spec v1 (`fluig-mcp gerar`, `fluig_flow_generate`, nova `fluig_flow_regenerate`): o `.process` sai das funções da Fluiggers 3.0.1, com conferência antes de gravar, escrita atômica e backup. `fluig_flow_deploy` passa a publicar o ECM30 com o SVG, a partir de uma spec ou de um `.process`.
- Regenerar ECM30 e SVG de um `.process` sem VS Code nem Eclipse: `fluig-mcp regenerar` (conversor
  oficial do Studio pela ponte Java da Fluiggers, ou gerador próprio como plano B) e
  `fluig-mcp instalar-conversor` (cache local em `~/.fluig-mcp`, conferido por SHA-256; nenhum JAR
  no repositório).
- `fluig_log_search`: busca resumida no log do servidor pela widget de leitura de log
  (`FLUIG_LOG_API`, padrão `/ascendra_log_viewer/api/logs`). Corta linhas longas, agrupa
  ocorrências que só mudam data, id ou número, limita o total e, com `contexto`, devolve as
  linhas vizinhas de cada ocorrência. Uma busca que voltava com 400 mil caracteres pelo
  `fluig_rest_get` passa a voltar com menos de 3 mil.

## [1.0.0] — 2026-09-24

Primeira versão pública. 97 ferramentas, dois ambientes, e as armadilhas do produto embutidas
no código.

### Adicionado

- **33 ferramentas novas** cobrindo o que faltava para fechar ciclos que o servidor já abria:
  - *Runtime BPM*: `fluig_task_list`, `fluig_task_count`, `fluig_request_list`,
    `fluig_request_get`, `fluig_process_possible_assignees`, `fluig_process_activities_resume`.
  - *Formulários*: `fluig_card_list`, `fluig_card_children_get` (linhas pai-filho **com
    `rowId`**), `fluig_form_fields`, `fluig_card_save`, `fluig_form_create`,
    `fluig_card_html_url`.
  - *Dataset reversível*: `fluig_dataset_history`, `fluig_dataset_draft_check`,
    `fluig_dataset_restore`, `fluig_dataset_state_set`.
  - *Processo*: `fluig_process_version_release` (publica a versão que `import_xml` deixa em
    edição), `fluig_process_def_states`, `fluig_process_diagram_get`, `fluig_process_move_rest`,
    `fluig_process_create`, `fluig_process_convert_instances`, `fluig_process_error_log`,
    `fluig_workflow_exporter`, `fluig_deadline_calc`.
  - *GED*: `fluig_ged_list`, `fluig_ged_path`, `fluig_ged_download`, `fluig_ged_upload`,
    `fluig_process_attachment_download`.
  - *RM e integração*: `fluig_service_list`, `fluig_rm_dataserver_schema`,
    `fluig_rm_save_record` (escrita no ERP pela business layer, em vez de SQL cru).
  - *Diagnóstico*: `fluig_version`, `fluig_session_reset`.
- **Dois ambientes no mesmo servidor**, com `env` obrigatório em toda chamada.
- **`FLUIG_READONLY=1`**: expõe somente as 60 ferramentas que não alteram o servidor.
- **`--list`, `--help`, `--version`** funcionando sem credencial.

### Corrigido

- `fluig_rm_query` **parou de gravar no servidor**. Era anunciada como read-only e gravava um
  dataset a cada chamada; agora chama `ds_generic_rm_sql` direto pelo `dataset-handle/search`.
- `date-calculator` usa `seconds`, não `duration` — com o nome errado o servidor devolvia
  `NullPointerException`, que parecia bug do produto.
- `fluig_card_html_url` não aceita `cardId`; os parâmetros corretos são
  `documentId`+`documentVersionId` ou `processId`+`processInstanceId`.
- `fluig_ged_list` normaliza o grid antigo (`invdata`), que fazia pasta cheia parecer vazia.
- Requisições saem pelo **hostname**, não pelo IP sondado — corrige o mismatch de TLS/SNI em
  HTTPS e o bloqueio de IPS por acesso via IP. O `fetch` do Node deriva o SNI e a verificação do
  certificado da URL, não do header `Host`, então o IP na URL quebrava toda chamada HTTPS.
  Correção de [Antonio (@antoniosdn)](https://github.com/antoniosdn),
  [PR #1](https://github.com/alucardigo/fluig-mcp/pull/1).
- O mesmo defeito existia no **cliente SOAP**, que montava a URL do WSDL pelo IP — afetando
  `listDatasets`, `runDataset`, `startProcess`, `move` e todas as demais ferramentas SOAP.
  Corrigido junto, no merge do PR #1. Validado em produção HTTPS (627 datasets pelo hostname).
- `fluig_task_count` exige `processId`: sem filtro a rota varre a base e passa de 120 s.

### Segurança

- **Sem defaults de host e credencial.** Variável faltando é erro explícito.
- **A senha de produção não cai mais na de homologação** — o fallback queimava tentativas do
  Active Directory e chegou a bloquear a conta do usuário.
- **O login não repete** ao ser recusado, e falha sem tocar a rede quando não há senha.
- Ferramentas cuja consulta é read-only mas que **gravam um dataset para executar SQL**
  (`fluig_db_query`, `fluig_rm_db_query`, `fluig_service_list`, `fluig_process_error_log`,
  `fluig_rm_dataserver_schema`) passaram a ser tratadas como escrita e exigem `confirm` em
  produção. As descrições pararam de chamá-las de read-only.
- `.gitignore` bloqueia `out/`, dumps e material de análise — são dados do cliente e código
  proprietário de terceiro.
