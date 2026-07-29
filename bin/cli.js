#!/usr/bin/env node
/**
 * Command-line front end for the same client the MCP server uses.
 *
 * Handy for a quick check that credentials and connectivity work before wiring the MCP
 * server into an agent, and for dumping datasets, forms and process definitions to disk.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { FluigClient } from '../src/client.js';

const OUT_DIR = process.env.FLUIG_OUT_DIR || join(process.cwd(), 'out');

const USAGE = `fluig-cli - drive TOTVS Fluig from the terminal

  fluig-cli ping                              Check credentials and session
  fluig-cli dataset list [filter]             List datasets
  fluig-cli dataset get <datasetId>           Source of a custom dataset       -> out/datasets
  fluig-cli dataset run <name> [--limit N] [--fields a,b]
  fluig-cli form list [filter]                List forms
  fluig-cli form events <documentId>          Form events                      -> out/forms/<id>/events
  fluig-cli form get <documentId> <version>   Files + events                   -> out/forms/<id>
  fluig-cli globalevent list                  List global events
  fluig-cli process versions <processId>      Versions of a process
  fluig-cli process events <processId>        Process events, from the definition XML
  fluig-cli process export <processId>        Definition XML                   -> out/processes
  fluig-cli workflow check                    Is the optional FluiggersWidget installed?

Required environment: FLUIG_HOST, FLUIG_USER, FLUIG_PASS. See README.md.`;

function print(x) {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
}

async function save(relativePath, content) {
  const full = join(OUT_DIR, relativePath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content, 'utf8');
  console.error(`  -> saved: ${full}`);
}

function flag(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [, , group, action, ...rest] = process.argv;
  if (!group || group === '--help' || group === '-h') {
    print(USAGE);
    return;
  }

  let client;
  try {
    client = new FluigClient(loadConfig());
  } catch (err) {
    console.error(`fluig-cli: ${err.message}`);
    process.exit(1);
  }

  switch (`${group} ${action ?? ''}`.trim()) {
    case 'ping': {
      print(await client.ping() ? 'OK - authenticated, session valid.' : 'FAILED.');
      break;
    }

    case 'dataset list': {
      const filter = (rest[0] || '').toLowerCase();
      const all = await client.listDatasets();
      const rows = all
        .filter((d) => !filter || `${d.datasetId} ${d.datasetDescription || ''}`.toLowerCase().includes(filter))
        .map((d) => `${(d.type || '').padEnd(8)} ${d.datasetId}`);
      print(rows.join('\n'));
      console.error(`\n(${rows.length} of ${all.length} datasets)`);
      break;
    }

    case 'dataset get': {
      const id = rest[0];
      const ds = await client.getCustomDataset(id);
      if (ds.datasetImpl !== undefined) {
        await save(`datasets/${id}.js`, ds.datasetImpl);
        print(ds.datasetImpl);
      } else {
        print(ds);
      }
      break;
    }

    case 'dataset run': {
      const name = rest[0];
      const limit = Number(flag(rest, '--limit') || 0);
      const fields = (flag(rest, '--fields') || '').split(',').map((s) => s.trim()).filter(Boolean);
      const { columns, values } = await client.runDataset(name, { fields });
      await save(`datasets-run/${name}.json`, JSON.stringify({ columns, total: values.length, values }, null, 2));
      print({ columns, total: values.length, sample: limit > 0 ? values.slice(0, limit) : values });
      break;
    }

    case 'form list': {
      const filter = (rest[0] || '').toLowerCase();
      const forms = await client.listForms();
      const rows = forms
        .filter((f) => !filter || `${f.documentId} ${f.documentDescription || ''} ${f.datasetName || ''}`.toLowerCase().includes(filter))
        .map((f) => `${String(f.documentId).padEnd(9)} v${f.version}  ${f.documentDescription}  [ds:${f.datasetName || '-'}]`);
      print(rows.join('\n'));
      console.error(`\n(${rows.length} of ${forms.length} forms)`);
      break;
    }

    case 'form events': {
      const documentId = Number(rest[0]);
      const events = await client.getFormEvents(documentId);
      for (const e of events) await save(`forms/${documentId}/events/${e.eventId}.js`, e.eventDescription || '');
      print(events.map((e) => `${e.eventId} (${(e.eventDescription || '').length} chars)`).join('\n') || '(no events)');
      break;
    }

    case 'form get': {
      const documentId = Number(rest[0]);
      const version = Number(rest[1] || 1000);
      const names = await client.getFormFileNames(documentId);
      for (const fileName of names) {
        const b64 = await client.getFormFileBase64(documentId, version, fileName);
        if (b64) await save(`forms/${documentId}/${fileName}`, Buffer.from(b64, 'base64').toString('utf8'));
      }
      const events = await client.getFormEvents(documentId);
      for (const e of events) await save(`forms/${documentId}/events/${e.eventId}.js`, e.eventDescription || '');
      print({ files: names, events: events.map((e) => e.eventId) });
      break;
    }

    case 'globalevent list': {
      const events = await client.listGlobalEvents();
      print(Array.isArray(events) ? events.map((e) => e.globalEventPK?.eventId).join('\n') : events);
      break;
    }

    case 'process versions': {
      print(await client.listProcessVersions(rest[0]));
      break;
    }

    case 'process events': {
      const processId = rest[0];
      const events = await client.getProcessEventsFromXml(processId, rest[1] ? Number(rest[1]) : undefined);
      for (const e of events) await save(`processes/${processId}/events/${e.eventId}.js`, e.code || '');
      print(events.map((e) => `${e.eventId} (${(e.code || '').length} chars)`).join('\n') || '(no events)');
      break;
    }

    case 'process export': {
      const processId = rest[0];
      const xml = await client.exportProcessXml(processId, rest[1] ? Number(rest[1]) : undefined);
      await save(`processes/${processId}.ecm30.xml`, xml);
      console.error(`(${xml.length} bytes)`);
      break;
    }

    case 'workflow check': {
      print(await client.hasFluiggersWidget()
        ? 'FluiggersWidget INSTALLED.'
        : 'FluiggersWidget NOT installed - use "process events" / the fluig_process_*_xml tools instead.');
      break;
    }

    default:
      print(USAGE);
  }
}

main().catch((err) => {
  console.error('ERROR:', err?.message || err);
  process.exit(1);
});
