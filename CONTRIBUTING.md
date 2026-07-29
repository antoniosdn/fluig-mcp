# Contributing

Bug reports, protocol findings and pull requests are all welcome. Fluig installations differ
enough that a report of "this endpoint behaves differently on my server" is genuinely useful on
its own.

## Getting set up

```bash
git clone https://github.com/alucardigo/fluig-mcp.git
cd fluig-mcp
npm install
npm test          # offline; no Fluig server needed
npm run check     # syntax check
npm run list      # print the tool surface
```

The test suite stubs the network layer, so everything runs anywhere. Never add a test that needs a
live server — instance ids, process names and datasets differ per installation, and a suite that
only passes on one machine is worse than no suite.

## Pull requests

- **One logical change per commit**, each leaving the tree green. That is what makes `git bisect`
  worth anything later.
- **Explain the why in the commit body.** The diff already shows the what.
- **Cover behaviour with a test.** A bug fix without a regression test invites the bug back. The
  jQuery-`$` case in `test/client.test.js` is the model: a real failure, pinned down forever.
- **Say if a change is observable.** Renaming an argument or changing a returned shape breaks
  callers; if it is worth doing anyway, say so and note the migration.
- **Disclose AI assistance** if you used it, and be able to explain every non-obvious decision in
  the diff without re-reading your prompt. You own the code you submit either way.

## House rules

- No new runtime dependencies without a concrete reason. Two is the current count and it is a
  feature.
- Keep files small and single-purpose: configuration in `src/config.js`, protocol in
  `src/client.js`, tool surface in `src/tools.js`, wiring in `server.js`.
- Comments explain **why**, never what. The ones documenting a server quirk, an inverted API name
  or a bug that cost a day are the most valuable lines in the file — do not tidy them away.
- Tool descriptions are read by language models. Say what the tool does, what it costs and what it
  breaks, in plain sentences.
- The README is in Portuguese, because Fluig is a Brazilian platform and so is everyone who runs
  it. The code is in English — comments, tool descriptions, error messages and identifiers — so
  that the source stays consistent with its own dependencies and with the wider Node ecosystem.
  Keep both sides of that line where they are.

## Adding a tool

1. Add the client method to `src/client.js`. Anything destructive takes `opts.confirm` and throws
   before it touches the network.
2. Add the registry entry in `src/tools.js` with `write: true` if it changes server state, and a
   `confirm` property in the schema if it is destructive.
3. The tests in `test/tools.test.js` enforce the registry invariants automatically — run them.
4. Add the row to the tool tables in `README.md`.

## Reporting a protocol finding

The most valuable contributions are endpoint discoveries. When you send one, include the Fluig
version, the request (method, path, headers that mattered, body shape), the response, and how you
confirmed it. "It worked once" and "this is the documented contract" are very different claims —
please distinguish them.

Security issues go through [SECURITY.md](SECURITY.md), not the public issue tracker.
