# fluig-mcp

[![CI](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/alucardigo/fluig-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-informational)](package.json)

**Operate a TOTVS Fluig instance from an AI agent or a terminal — datasets, forms, global events and BPM process definitions — without opening Fluig Studio.**

[Leia em português](README.pt-BR.md)

---

## Why

Development on Fluig normally goes through Fluig Studio, an Eclipse distribution. Reading one
form event, checking which dataset a workflow calls, or shipping a one-line fix to a service
task all mean launching an IDE, exporting a package, importing it back, and publishing by hand.
Nothing in that loop is scriptable, and none of it is reachable by an agent.

Everything Fluig Studio does, it does over HTTP. `fluig-mcp` speaks the same three protocols
the platform uses — the session cookie from `login.do`, the legacy `/webdesk/*` SOAP services,
and the v2 REST API — from a plain Node process. That makes the whole platform available as
[Model Context Protocol](https://modelcontextprotocol.io) tools, so an assistant can read a
form's `validateForm`, trace why a task landed on the wrong person, or deploy a patched process
version, in the conversation where the question came up.

## What it does

- **Datasets** — list, read the source of a custom dataset, inspect its structure without
  running it, run it, create, update and delete.
- **Forms** — list, read every file and event, and publish a new version.
- **Global events** — read and write.
- **BPM process definitions** — export the `.ecm30.xml`, read and patch process event source,
  deploy a new version, publish it, **withdraw it to roll back**, and delete versions.
- **Process instances** — start, take, move, cancel; read the card, the history, the
  attachments, the active and reachable states, and who is eligible to receive a task.
- **SQL passthrough** — read-only `SELECT` against the Fluig database, and against TOTVS RM
  either directly or through the stored-statement bridge dataset.
- **Escape hatches** — authenticated `GET`/`POST` against any path of the API.

56 tools in total. Run `node server.js --list` to see them all — it needs no credentials, so you
can audit the surface before trusting it with any.

### Process events without the widget

Process event source lives inside the process definition XML, in
`<WorkflowProcessEvent><eventDescription>`. `fluig-mcp` reads it from there and writes it back
by exporting the definition, patching the one event, and re-importing — which means every write
becomes a **new, revertible version** that passed server-side validation, on a stock server,
with no add-on installed. The round trip is byte-exact: accents, quotes and jQuery `$` all
survive intact ([regression test](test/client.test.js)).

## Requirements

- Node.js 20 or newer.
- Network reach to a Fluig instance (tested against Fluig 1.8.x).
- A Fluig user. Most tools want administrative rights; the process instance tools act as this
  user and need the matching roles.

## Install

```bash
git clone https://github.com/alucardigo/fluig-mcp.git
cd fluig-mcp
npm install
```

## Configure

Configuration is entirely environment variables. There are **no defaults for the host or the
credentials** — a missing variable is a hard error, never a silent fallback.

| Variable | Required | Default | What it is |
|---|:-:|---|---|
| `FLUIG_HOST` | yes | — | Portal base URL, with scheme and port |
| `FLUIG_USER` | yes | — | Fluig login |
| `FLUIG_PASS` | yes | — | Password for that login |
| `FLUIG_COMPANY` | no | `1` | Tenant id; `-1` asks the server to resolve it |
| `FLUIG_USERCODE` | no | `FLUIG_USER` | Colleague id, when it differs from the login |
| `FLUIG_READONLY` | no | `0` | `1` exposes only the tools that cannot change server state |
| `FLUIG_IPS` | no | — | Comma-separated fallback IPs, probed when DNS is unreliable |
| `FLUIG_DATASOURCE` | no | `/jdbc/AppDS` | JNDI datasource of the Fluig database |
| `FLUIG_RM_DATASOURCE` | no | `/jdbc/Corpore` | JNDI datasource of the TOTVS RM database |
| `FLUIG_RM_BRIDGE_DATASET` | no | `ds_generic_rm_sql` | Dataset relaying RM stored SQL statements |
| `FLUIG_SCRATCH_PREFIX` | no | `ds_mcp_` | Prefix of the throwaway datasets this server creates |

See [`.env.example`](.env.example).

### Claude Code

```bash
claude mcp add fluig \
  --env FLUIG_HOST=https://fluig.example.com:8080 \
  --env FLUIG_USER=your.user \
  --env FLUIG_PASS=your-password \
  -- node /absolute/path/to/fluig-mcp/server.js
```

### Claude Desktop, Cursor, or any other MCP client

```json
{
  "mcpServers": {
    "fluig": {
      "command": "node",
      "args": ["/absolute/path/to/fluig-mcp/server.js"],
      "env": {
        "FLUIG_HOST": "https://fluig.example.com:8080",
        "FLUIG_USER": "your.user",
        "FLUIG_PASS": "your-password",
        "FLUIG_READONLY": "1"
      }
    }
  }
}
```

Start with `FLUIG_READONLY=1`. Drop it once you know what the agent does with the read tools.

## Check it works

The CLI shares the client, so it is the fastest way to prove credentials and connectivity
before an agent is involved:

```bash
export FLUIG_HOST=https://fluig.example.com:8080
export FLUIG_USER=your.user
export FLUIG_PASS=your-password

node bin/cli.js ping
node bin/cli.js dataset list colleague
node bin/cli.js form list
node bin/cli.js process events MyProcess
```

`node bin/cli.js --help` lists every command. Downloads land in `./out` (git-ignored).

## Tools

`!` marks a tool that changes server state. Those are hidden entirely when `FLUIG_READONLY=1`,
and each one also requires an explicit `confirm: true`.

**Session**

| Tool | Does |
|---|---|
| `fluig_ping` | Validate authentication and session |

**Datasets**

| Tool | Does |
|---|---|
| `fluig_dataset_list` | List datasets, with an optional filter |
| `fluig_dataset_get` | Source code of a custom dataset |
| `fluig_dataset_structure` | Columns and types, without running the dataset |
| `fluig_dataset_run` | Run it and return rows |
| `!` `fluig_dataset_save` | Create or update a custom dataset (ES5/Rhino source) |
| `!` `fluig_dataset_delete` | Delete a custom dataset |

**Forms**

| Tool | Does |
|---|---|
| `fluig_form_list` | List forms |
| `fluig_form_events` | Customisation events with source (`displayFields`, `validateForm`, …) |
| `fluig_form_files` / `fluig_form_file` | List files / read one file |
| `fluig_form_full` | Metadata, every file and every event in one call |
| `!` `fluig_form_save` | Publish a new form version |

**Global events**

| Tool | Does |
|---|---|
| `fluig_globalevent_list` | List global events |
| `!` `fluig_globalevent_save` | Create or update one |

**SQL**

| Tool | Does |
|---|---|
| `fluig_db_query` | Read-only `SELECT` against the Fluig database |
| `fluig_rm_db_query` | Read-only `SELECT` against the TOTVS RM database |
| `fluig_rm_query` | RM query through the stored-statement bridge dataset |
| `!` `fluig_rm_db_exec` | `INSERT`/`UPDATE`/`DELETE` against RM |

**Process definitions**

| Tool | Does |
|---|---|
| `fluig_process_export_xml` | Download the definition as `.ecm30.xml` |
| `fluig_process_events_xml` | Process events with source, from the definition |
| `fluig_process_versions` / `fluig_process_version` | Versions / active version |
| `fluig_process_formid` / `fluig_process_image` | Bound form / flow diagram |
| `fluig_process_search` / `fluig_process_available` | Search / what the user may start |
| `fluig_deploy_list` | Processes available for export |
| `fluig_process_event_get` | Event source from `event_proces` (legacy read) |
| `!` `fluig_process_event_set_xml` | Patch an event as a new version (supports `dryRun`) |
| `!` `fluig_process_import_xml` | Deploy a definition over REST v2 |
| `!` `fluig_deploy_process` | Deploy a definition over SOAP |
| `!` `fluig_process_version_withdraw` | Withdraw a version — how you roll a deploy back |
| `!` `fluig_process_version_delete` | Delete a version |
| `!` `fluig_process_diagram_set` | Replace a version's SVG diagram |
| `!` `fluig_process_event_set` | Deprecated in-place patch of `event_proces` |

**Process instances**

| Tool | Does |
|---|---|
| `fluig_process_states` / `fluig_process_states_detail` | Reachable target states |
| `fluig_process_active_states` / `fluig_process_actual_thread` | Where the instance sits |
| `fluig_process_card_get` / `fluig_process_card_value` | Whole card / one field |
| `fluig_process_history` / `fluig_process_attachments` | History / attachments |
| `fluig_process_available_users` / `..._start` | Who may receive a task |
| `fluig_user_replacements` | Who answers for whom, and until when |
| `!` `fluig_process_start` | Start an instance |
| `!` `fluig_process_take` | Take a pool task |
| `!` `fluig_process_move` | Save the card and move the instance |
| `!` `fluig_process_cancel` | Cancel an instance |

**Optional FluiggersWidget add-on** — not needed; the `_xml` tools above cover the same ground
on a stock server.

| Tool | Does |
|---|---|
| `fluig_workflow_check` | Is the widget installed? |
| `fluig_workflow_events_get` | Read process events through the widget |
| `!` `fluig_workflow_events_update` | Write process events through the widget |

**Escape hatches**

| Tool | Does |
|---|---|
| `fluig_rest_get` | Authenticated `GET` on any path |
| `!` `fluig_rest_post` | Authenticated `POST` on any path |

## How it works

| Concern | Mechanism |
|---|---|
| Authentication | `POST /portal/api/servlet/login.do` → `JSESSIONIDSSO` cookie, reused everywhere — including the v2 REST API, which accepts it in place of OAuth |
| Datasets | SOAP `ECMDatasetService` for list/run, REST `dataset/loadDataset\|createDataset\|editDataset` for read/write |
| Forms | SOAP `ECMCardIndexService` |
| Global events | REST `ecm/globalevent/*` |
| Process definitions | REST v2 `/process-management/api/v2/processes/*`, with SOAP `WorkflowEngineService` as the fallback deploy path |
| Process instances | SOAP `WorkflowEngineService` |
| SQL | A throwaway custom dataset that opens the JNDI datasource server-side and runs the statement |

**Network resilience.** Fluig is usually behind corporate DNS, and corporate DNS lies:
split-horizon zones hand out addresses unreachable from where you are, and one unlucky lookup
then looks exactly like an outage. So the client resolves the address itself — last known-good,
`dns.resolve4`, `dns.lookup`, operator seeds — TCP-probes the candidates in parallel, pins the
first that answers, and keeps the original `Host` header so name-based virtual hosts still work.
The good address is cached briefly and re-probed on any failure. Every call also retries with
backoff, and only on genuinely transient errors.

## Safety

This server hands an LLM the ability to run SQL, publish forms and **delete process
definitions**. Treat it accordingly.

- **`FLUIG_READONLY=1`** hides all 18 state-changing tools. 38 remain, including everything
  needed to read and diagnose.
- Every destructive operation requires an explicit `confirm: true`; there is no default-yes.
- `fluig_process_event_set_xml` and `fluig_process_import_xml` create a **new version** rather
  than editing the live one, so `fluig_process_version_withdraw` rolls a bad deploy back.
- The SQL query tools are `SELECT`/`WITH` only, enforced before the statement leaves the process.
- To run SQL at all, the server writes a throwaway dataset named `${FLUIG_SCRATCH_PREFIX}*`
  (default `ds_mcp_dbquery`, `ds_mcp_rmquery`, …). This happens in read-only mode too, because
  it is how reading works. Anything with that prefix on your server was created here and is
  safe to delete with `fluig_dataset_delete`.
- Point it at a test or staging instance first.

See [SECURITY.md](SECURITY.md).

## Limitations

- Forms are read-oriented: `fluig_form_save` replaces the entire file and event set, so read
  with `fluig_form_full` first or you will drop what you did not send.
- The RM datasource is frequently configured read-only. When it is, the supported write path
  into RM is the RM DataServer API, not `fluig_rm_db_exec`.
- The stored-statement bridge dataset (`FLUIG_RM_BRIDGE_DATASET`) is an integration convention,
  not a platform guarantee — the name and its presence vary by installation.
- Dataset code runs under Rhino: ES5 only, no `let`/`const`, arrow functions or template
  literals.
- Verified against Fluig 1.8.x. Other versions likely work but are untested.

## Development

```bash
npm test      # unit tests, no server needed
npm run check # syntax check every source file
npm run list  # print the tool surface
```

Tests use the built-in `node:test` runner and stay offline — the network layer is stubbed, so
the suite runs anywhere. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Acknowledgements

The dataset and form protocol was originally worked out by the community
[`fluig-vscode-extension`](https://github.com/fluiggers/fluig-vscode-extension) project
(Fluiggers), which is well worth using if you write Fluig code in VS Code. The process
definition, instance lifecycle and deploy paths here were mapped independently against a live
server.

## Disclaimer

Independent, unofficial project. Not affiliated with, endorsed by, or supported by TOTVS.
TOTVS, Fluig and RM are trademarks of TOTVS S.A. Some endpoints used here are internal or
undocumented and may change between releases.

## License

[MIT](LICENSE) © Rodrigo de Souza Faria
