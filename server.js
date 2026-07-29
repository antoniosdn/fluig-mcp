#!/usr/bin/env node
/**
 * MCP stdio server for TOTVS Fluig.
 *
 * Thin wiring only: configuration lives in src/config.js, the protocol in src/client.js and
 * the tool surface in src/tools.js. Keeping this file small means `--list` can run without
 * credentials, which is what makes the server inspectable before it is trusted.
 */
import { readFileSync } from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './src/config.js';
import { FluigClient } from './src/client.js';
import { TOOLS, selectTools, toolManifest } from './src/tools.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const HELP = `fluig-mcp ${pkg.version} - MCP server for TOTVS Fluig

Usage:
  fluig-mcp             Start the MCP server on stdio (what an MCP client runs).
  fluig-mcp --list      List the exposed tools and exit. Needs no credentials.
  fluig-mcp --version   Print the version and exit.
  fluig-mcp --help      Show this message.

Required environment: FLUIG_HOST, FLUIG_USER, FLUIG_PASS.
Set FLUIG_READONLY=1 to expose only the tools that cannot change server state.
See README.md and .env.example for the full list.`;

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(HELP);
  process.exit(0);
}

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  console.log(pkg.version);
  process.exit(0);
}

if (process.argv.includes('--list')) {
  // Deliberately does not load the configuration: listing the surface must not require
  // credentials, so that anyone can audit what this server can do before wiring it up.
  const readOnly = /^(1|true|yes|on)$/i.test(String(process.env.FLUIG_READONLY || ''));
  const tools = selectTools({ readOnly });
  console.log(`fluig-mcp ${pkg.version} - ${tools.length} tools${readOnly ? ' (read-only mode)' : ''}:`);
  for (const t of tools) console.log(`  ${t.write ? '!' : ' '} ${t.name}: ${t.description}`);
  if (!readOnly) console.log('\n(! marks tools that change server state.)');
  process.exit(0);
}

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`fluig-mcp: ${err.message}`);
  process.exit(1);
}

const client = new FluigClient(config);
const tools = selectTools({ readOnly: config.readOnly });
const byName = new Map(tools.map((t) => [t.name, t]));

const server = new Server(
  { name: 'fluig', version: pkg.version },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(toolManifest),
}));

/** True when the name is a real tool that read-only mode filtered out. */
const isHiddenByReadOnly = (name) => config.readOnly && TOOLS.some((t) => t.name === name);

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = byName.get(req.params.name);
  if (!tool) {
    const hint = isHiddenByReadOnly(req.params.name)
      ? ' (this tool changes server state and is hidden because FLUIG_READONLY is set)'
      : '';
    return { content: [{ type: 'text', text: `Unknown tool: ${req.params.name}${hint}` }], isError: true };
  }
  try {
    const out = await tool.run(client, req.params.arguments || {});
    return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `ERROR: ${e?.message || e}` }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`fluig-mcp ${pkg.version} ready on stdio - ${tools.length} tools, host ${config.host}${config.readOnly ? ', read-only' : ''}.`);
