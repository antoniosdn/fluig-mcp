# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-29

First public release.

### Added

- MCP stdio server exposing 56 tools over the TOTVS Fluig API.
- Datasets: list, read source, inspect structure without running, run, upsert, delete.
- Forms: list, read every file and event, read a whole form, publish a new version.
- Global events: read and write.
- BPM process definitions: export the `.ecm30.xml`; read and patch process event source through
  export → patch → import, producing a new revertible version on a stock server with no add-on;
  deploy over REST v2 or SOAP; list, withdraw and delete versions; replace the SVG diagram.
- Process instances: start, take, move, cancel; read the card, a single field, the history, the
  attachments, active and reachable states, and eligible assignees; list user replacements.
- SQL passthrough: read-only `SELECT` against the Fluig database and against TOTVS RM, plus RM
  queries through the stored-statement bridge dataset, and a guarded write path.
- Authenticated `GET`/`POST` escape hatches.
- `FLUIG_READONLY=1` to expose only the 38 tools that cannot change server state.
- Self-healing address resolution: candidate addresses are TCP-probed in parallel and the first
  reachable one is pinned, with the original `Host` header preserved for virtual hosts; retry with
  backoff on transient errors only; detection of inline web-filter block pages, which otherwise
  masquerade as "not found".
- `fluig-cli`, a terminal front end over the same client, for verifying connectivity and dumping
  datasets, forms and process definitions to disk.
- Offline test suite on the built-in `node:test` runner, including a regression test pinning the
  jQuery-`$` corruption in process event patching.
