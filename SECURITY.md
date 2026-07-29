# Security

## What this tool can do

Be clear-eyed about the blast radius before wiring this into an agent. With write tools enabled,
whatever drives this server can:

- run arbitrary SQL against the Fluig database, and against TOTVS RM if a datasource exists;
- create, overwrite and delete custom datasets;
- publish new versions of forms and of BPM process definitions;
- **delete process versions — and deleting the last version removes the whole process
  definition**;
- start, move and cancel process instances, acting as the configured user;
- issue an authenticated `POST` to any endpoint of the platform.

None of that is a bug. It is the point of the tool, and it is why the defaults are conservative.

## Guard rails

| Guard rail | What it does |
|---|---|
| `FLUIG_READONLY=1` | Removes all 18 state-changing tools from the MCP surface entirely. They cannot be called, not even by name. |
| `confirm: true` | Every destructive client method refuses to run without it, before any network call. |
| `SELECT`/`WITH` only | The query tools reject anything else before the statement leaves the process. |
| New versions, not in-place edits | Process writes go through export → patch → import, so `fluig_process_version_withdraw` rolls a bad deploy back. |
| No credentials in code | Host, user and password come from the environment. A missing one is a hard error — there is nothing to fall back to. |

## Recommendations

1. **Start read-only.** Set `FLUIG_READONLY=1` and leave it until you have watched what the agent
   does with the read tools.
2. **Use a dedicated Fluig account** with the narrowest set of roles the job needs, rather than a
   personal administrator login. It also makes the audit trail meaningful.
3. **Point at staging first.** Verify a process deploy with a round trip — export a definition and
   re-import it unchanged — before letting anything touch production.
4. **Keep credentials out of the repository.** `.env` is git-ignored. Prefer your MCP client's
   `env` block or your OS secret store over a file on disk.
5. **Mind the CLI output directory.** `./out` contains your organisation's dataset, form and
   process source. It is git-ignored here; keep it that way wherever it lands.

## Throwaway datasets

Running SQL requires a server-side dataset, so the query tools write one named
`${FLUIG_SCRATCH_PREFIX}<purpose>` — by default `ds_mcp_dbquery`, `ds_mcp_rmdbquery`,
`ds_mcp_rmquery`, `ds_mcp_rmexec`, `ds_mcp_dbexec`. This happens in read-only mode too, because it
is the mechanism by which reading works.

Those datasets only hold the statement that was last run through them. Anything with that prefix
on your server was created by this tool and can be removed with `fluig_dataset_delete`. If a
server where nothing at all may be written is a requirement, do not enable the SQL tools.

## Reporting a vulnerability

Please report security issues privately through
[GitHub Security Advisories](https://github.com/alucardigo/fluig-mcp/security/advisories/new)
rather than as a public issue, and allow a reasonable window for a fix before disclosure.

If the issue is in TOTVS Fluig itself rather than in this client, report it to TOTVS — this
project is independent and cannot patch the platform.
