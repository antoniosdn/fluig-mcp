import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, selectTools, toolManifest } from '../src/tools.js';

test('tool names are unique and namespaced', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'duplicate tool name');
  for (const n of names) assert.match(n, /^fluig_[a-z0-9_]+$/, `bad tool name: ${n}`);
});

test('every tool is fully described', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string', `${t.name}: missing description`);
    assert.ok(t.description.length > 20, `${t.name}: description too thin`);
    assert.equal(typeof t.write, 'boolean', `${t.name}: missing write flag`);
    assert.equal(typeof t.run, 'function', `${t.name}: missing run()`);
  }
});

test('input schemas are well formed JSON Schema objects', () => {
  for (const t of TOOLS) {
    const s = t.inputSchema;
    assert.equal(s.type, 'object', `${t.name}: inputSchema.type must be "object"`);
    assert.equal(typeof s.properties, 'object', `${t.name}: missing properties`);
    assert.ok(Array.isArray(s.required), `${t.name}: missing required array`);
    for (const key of s.required) {
      assert.ok(key in s.properties, `${t.name}: required "${key}" is not declared in properties`);
    }
    for (const [key, prop] of Object.entries(s.properties)) {
      assert.ok(prop && typeof prop.type === 'string', `${t.name}.${key}: property needs a type`);
      assert.ok(prop.description, `${t.name}.${key}: property needs a description`);
    }
  }
});

test('destructive tools accept a confirm flag', () => {
  // Anything that deletes or overwrites must be impossible to trigger by accident,
  // so the schema has to offer the caller a confirm switch.
  const destructive = TOOLS.filter((t) => /_delete$|_cancel$|_exec$|_withdraw$|_import_xml$|deploy_process$|_diagram_set$/.test(t.name));
  assert.ok(destructive.length >= 7, 'expected the destructive tools to be found by name');
  for (const t of destructive) {
    assert.ok(t.write, `${t.name}: destructive tool must be flagged as a write`);
    assert.ok('confirm' in t.inputSchema.properties, `${t.name}: needs a confirm property`);
  }
});

test('read-only mode drops every write tool and keeps the rest', () => {
  const all = selectTools({ readOnly: false });
  const ro = selectTools({ readOnly: true });
  assert.equal(all.length, TOOLS.length);
  assert.ok(ro.length < all.length, 'read-only mode should hide something');
  assert.ok(ro.every((t) => !t.write), 'read-only mode leaked a write tool');
  assert.equal(ro.length, TOOLS.filter((t) => !t.write).length);
  // The tools that make the server worth running must survive read-only mode.
  for (const name of ['fluig_ping', 'fluig_db_query', 'fluig_form_events', 'fluig_process_events_xml']) {
    assert.ok(ro.some((t) => t.name === name), `${name} should be available in read-only mode`);
  }
});

test('the manifest exposes metadata only — never the handler', () => {
  const m = toolManifest(TOOLS[0]);
  assert.deepEqual(Object.keys(m).sort(), ['description', 'inputSchema', 'name']);
  assert.equal(m.run, undefined);
  assert.equal(m.write, undefined);
});

test('no tool description leaks an internal host, address or credential', () => {
  // Descriptions are the most-copied text in the project; keep them free of anything
  // that could only have come from one particular installation.
  const suspicious = /\b\d{1,3}(\.\d{1,3}){3}\b|https?:\/\/(?!example\.)|password\s*[:=]/i;
  for (const t of TOOLS) {
    assert.ok(!suspicious.test(t.description), `${t.name}: description looks environment-specific`);
  }
});
