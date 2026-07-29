import test from 'node:test';
import assert from 'node:assert/strict';
import { FluigClient } from '../src/client.js';
import { loadConfig } from '../src/config.js';

/** A client wired to a host that is never contacted: every test here stays offline. */
function makeClient(extraEnv = {}) {
  return new FluigClient(loadConfig({
    FLUIG_HOST: 'https://fluig.example.com:8080',
    FLUIG_USER: 'alice',
    FLUIG_PASS: 'secret',
    ...extraEnv,
  }));
}

const PROCESS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<list>
  <ProcessDefinition>
    <processDefinitionVersionPK>
      <companyId>1</companyId>
      <processId>demo</processId>
      <version>3</version>
    </processDefinitionVersionPK>
    <processDescription>Demo</processDescription>
  </ProcessDefinition>
  <WorkflowProcessEvent>
    <workflowProcessEventPK>
      <companyId>1</companyId>
      <processId>demo</processId>
      <version>3</version>
      <eventId>beforeStateEntry</eventId>
    </workflowProcessEventPK>
    <eventDescription>function beforeStateEntry(sequenceId){}</eventDescription>
  </WorkflowProcessEvent>
</list>
`;

// --- Guards -----------------------------------------------------------------

test('SELECT-only guards reject statements that write', async () => {
  const c = makeClient();
  for (const sql of ['DELETE FROM x', 'UPDATE x SET a=1', 'drop table x', '  exec sp_who']) {
    await assert.rejects(() => c.dbQuery(sql), /only SELECT\/WITH is allowed/, `dbQuery accepted: ${sql}`);
    await assert.rejects(() => c.rmDbQuery(sql), /only SELECT\/WITH is allowed/, `rmDbQuery accepted: ${sql}`);
  }
});

test('the write-side guard rejects a SELECT and demands confirmation', async () => {
  const c = makeClient();
  await assert.rejects(() => c.rmDbExec('DELETE FROM x'), /requires \{ confirm: true \}/);
  await assert.rejects(() => c.rmDbExec('SELECT 1', { confirm: true }), /use rmDbQuery for SELECT/);
});

test('every destructive method refuses to run without confirm: true', async () => {
  const c = makeClient();
  const calls = [
    ['deleteDataset', () => c.deleteDataset('ds_x')],
    ['deployProcess', () => c.deployProcess('<list/>')],
    ['importProcessXml', () => c.importProcessXml('demo', '<list/>')],
    ['withdrawProcessVersion', () => c.withdrawProcessVersion('demo', 1)],
    ['deleteProcessVersion', () => c.deleteProcessVersion('demo', 1)],
    ['setProcessDiagram', () => c.setProcessDiagram('demo', 1, '<svg/>')],
    ['cancelProcessInstance', () => c.cancelProcessInstance(1, 'why')],
    ['setProcessEvent', () => c.setProcessEvent('demo', 'e', 1, 'code')],
    ['setProcessEventViaXml', () => c.setProcessEventViaXml('demo', 'e', 'code')],
    ['rmDbExec', () => c.rmDbExec('DELETE FROM x')],
  ];
  // These must fail on the guard, before any network access — a missing confirm should
  // never turn into a connection attempt against a real server.
  for (const [name, call] of calls) {
    await assert.rejects(call, /confirm: true/, `${name} did not refuse`);
  }
});

// --- Generated Rhino source -------------------------------------------------

test('SQL passthrough uses the configured datasource and embeds SQL safely', () => {
  const c = makeClient({ FLUIG_DATASOURCE: '/jdbc/Custom', FLUIG_RM_DATASOURCE: '/jdbc/RM' });
  const nasty = `SELECT '"', a\\b FROM t WHERE x = 'y'`;
  const code = c._selectPassthroughCode(c.datasource, nasty);

  assert.match(code, /ic\.lookup\("\/jdbc\/Custom"\)/);
  assert.ok(!code.includes('/jdbc/AppDS'), 'must not fall back to a hard-coded datasource');
  // The statement is embedded as a JSON string literal, so quotes and backslashes in the
  // SQL cannot terminate it early and turn into Rhino source.
  assert.ok(code.includes(JSON.stringify(nasty)));
  // And the result must still be syntactically valid JavaScript.
  assert.doesNotThrow(() => new Function(code));

  assert.match(c._selectPassthroughCode(c.rmDatasource, 'SELECT 1'), /ic\.lookup\("\/jdbc\/RM"\)/);
});

test('throwaway datasets carry the configured prefix', () => {
  assert.equal(makeClient()._scratch('dbquery'), 'ds_mcp_dbquery');
  assert.equal(makeClient({ FLUIG_SCRATCH_PREFIX: 'ds_tmp_' })._scratch('dbquery'), 'ds_tmp_dbquery');
});

// --- XML escaping -----------------------------------------------------------

test('XML escape and unescape round-trip event source without loss', () => {
  const c = makeClient();
  const source = [
    'function beforeTaskSave(colleagueId, nextSequenceId, userList) {',
    '  var v = $("#campo").val();       // jQuery',
    "  if (v === 'x' && v !== \"y\") throw 'erro: acentuação & <tags>';",
    '  var re = /a$/;',
    '}',
  ].join('\r\n');
  assert.equal(c._xmlUnescape(c._xmlEscape(source)), source);
});

// --- Process event patching -------------------------------------------------

/** Stubs the two network calls and returns whatever XML would have been uploaded. */
function stubXmlRoundTrip(client, xml = PROCESS_XML) {
  const captured = { xml: null, calls: 0 };
  client.exportProcessXml = async () => xml;
  client.importProcessXml = async (_processId, sent) => {
    captured.xml = sent;
    captured.calls += 1;
    return { ok: true };
  };
  return captured;
}

test('patching an event survives jQuery $ sequences intact', async () => {
  // String.replace reads $&, $', $` and $1 in the REPLACEMENT as capture references.
  // Fluig event code is full of them, so a naive replace corrupts the script on its way
  // to the server. This is the regression that keeps the function-form replacement honest.
  const c = makeClient();
  const captured = stubXmlRoundTrip(c);
  const source = 'function beforeStateEntry(s){ var a = "$&"; var b = "$\'"; var d = "$`"; var e = "$1"; $("#x").val("R$ 1,00"); }';

  const res = await c.setProcessEventViaXml('demo', 'beforeStateEntry', source, { confirm: true });
  assert.equal(res.action, 'updated');
  assert.equal(captured.calls, 1);

  c.exportProcessXml = async () => captured.xml;
  const events = await c.getProcessEventsFromXml('demo');
  const patched = events.find((e) => e.eventId === 'beforeStateEntry');
  assert.equal(patched.code, source, 'event source came back different from what was sent');
});

test('patching one event leaves the rest of the definition untouched', async () => {
  const c = makeClient();
  const captured = stubXmlRoundTrip(c);
  await c.setProcessEventViaXml('demo', 'beforeStateEntry', 'function beforeStateEntry(s){}', { confirm: true });
  assert.match(captured.xml, /<processDescription>Demo<\/processDescription>/);
  assert.match(captured.xml, /<processId>demo<\/processId>/);
  assert.equal((captured.xml.match(/<WorkflowProcessEvent>/g) || []).length, 1);
});

test('an unknown event is created from the definition metadata', async () => {
  const c = makeClient();
  const captured = stubXmlRoundTrip(c);

  const res = await c.setProcessEventViaXml('demo', 'afterProcessFinish', 'function afterProcessFinish(){}', { confirm: true });
  assert.equal(res.action, 'created');
  assert.equal((captured.xml.match(/<WorkflowProcessEvent>/g) || []).length, 2);

  c.exportProcessXml = async () => captured.xml;
  const events = await c.getProcessEventsFromXml('demo');
  assert.deepEqual(events.map((e) => e.eventId).sort(), ['afterProcessFinish', 'beforeStateEntry']);
  const created = events.find((e) => e.eventId === 'afterProcessFinish');
  assert.equal(created.version, 3, 'new event must inherit the definition version');
});

test('an event is created even when the definition has none yet', async () => {
  const c = makeClient();
  const bare = PROCESS_XML.replace(/ {2}<WorkflowProcessEvent>[\s\S]*?<\/WorkflowProcessEvent>\n/, '');
  assert.ok(!bare.includes('WorkflowProcessEvent'), 'fixture setup failed');
  const captured = stubXmlRoundTrip(c, bare);

  await c.setProcessEventViaXml('demo', 'afterProcessFinish', 'function afterProcessFinish(){}', { confirm: true });
  assert.match(captured.xml, /<eventId>afterProcessFinish<\/eventId>/);
  assert.ok(captured.xml.trimEnd().endsWith('</list>'), 'block must be inserted before </list>');
});

test('dryRun validates the patch and sends nothing', async () => {
  const c = makeClient();
  const captured = stubXmlRoundTrip(c);
  const res = await c.setProcessEventViaXml('demo', 'beforeStateEntry', 'function beforeStateEntry(s){}', { dryRun: true });
  assert.equal(res.dryRun, true);
  assert.equal(res.action, 'updated');
  assert.ok(res.bytes > 0);
  assert.equal(captured.calls, 0, 'dryRun must not upload anything');
});

test('a malformed event block aborts instead of shipping a broken definition', async () => {
  const c = makeClient();
  const broken = PROCESS_XML.replace(/<eventDescription>[\s\S]*?<\/eventDescription>/, '');
  stubXmlRoundTrip(c, broken);
  await assert.rejects(
    () => c.setProcessEventViaXml('demo', 'beforeStateEntry', 'function beforeStateEntry(s){}', { confirm: true }),
    /no <eventDescription>/,
  );
});

// --- SOAP payload normalisation ---------------------------------------------

test('dataset rows are normalised from either SOAP shape', async () => {
  const c = makeClient();
  // node-soap returns a bare object for a single row and wraps typed scalars in `$value`.
  c._soap['/webdesk/ECMDatasetService?wsdl'] = {
    getDatasetAsync: async () => ([{
      dataset: {
        columns: ['ID', 'NAME'],
        values: { value: [{ $value: '7' }, 'Ada'] },
      },
    }]),
  };
  assert.deepEqual(await c.runDataset('ds_demo'), {
    columns: ['ID', 'NAME'],
    values: [{ ID: '7', NAME: 'Ada' }],
  });
});

test('an empty dataset response yields empty rows rather than throwing', async () => {
  const c = makeClient();
  c._soap['/webdesk/ECMDatasetService?wsdl'] = { getDatasetAsync: async () => ([{}]) };
  assert.deepEqual(await c.runDataset('ds_demo'), { columns: [], values: [] });
});

test('card data converts to and from the StringArrayArray shape', () => {
  const c = makeClient();
  assert.deepEqual(c._cardDataToSoap({ nome: 'Ada', idade: 36, vazio: null }), {
    item: [
      { item: ['nome', 'Ada'] },
      { item: ['idade', '36'] },
      { item: ['vazio', ''] },
    ],
  });
  assert.deepEqual(
    c._saaToRows({ item: [{ item: [{ $value: 'a' }, 'b'] }] }),
    [['a', 'b']],
  );
});
