import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const MINIMAL = {
  FLUIG_HOST: 'https://fluig.example.com:8080',
  FLUIG_USER: 'alice',
  FLUIG_PASS: 'secret',
};

test('requires host, user and password', () => {
  assert.throws(() => loadConfig({}), /FLUIG_HOST, FLUIG_USER, FLUIG_PASS/);
  assert.throws(() => loadConfig({ FLUIG_HOST: MINIMAL.FLUIG_HOST }), /FLUIG_USER, FLUIG_PASS/);
});

test('treats blank values as missing', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, FLUIG_USER: '   ' }), /FLUIG_USER/);
});

test('rejects a host that is not an http(s) URL', () => {
  assert.throws(() => loadConfig({ ...MINIMAL, FLUIG_HOST: 'fluig.example.com' }), /not a valid URL/);
  assert.throws(() => loadConfig({ ...MINIMAL, FLUIG_HOST: 'ftp://fluig.example.com' }), /must use http or https/);
});

test('trims a trailing slash off the host', () => {
  assert.equal(loadConfig({ ...MINIMAL, FLUIG_HOST: 'https://f.example.com:8080//' }).host, 'https://f.example.com:8080');
});

test('ships no default host, user or password', () => {
  // Regression guard: a tool that defaults to somebody's server, or to a password,
  // leaks the moment it is published. There must be nothing to fall back to.
  const src = loadConfig.toString();
  assert.ok(!/https?:\/\/(?!$)/.test(src), 'loadConfig must not contain a hard-coded URL');
});

test('applies documented defaults', () => {
  const c = loadConfig(MINIMAL);
  assert.equal(c.companyId, 1);
  assert.equal(c.userCode, 'alice');
  assert.deepEqual(c.seedIps, []);
  assert.equal(c.datasource, '/jdbc/AppDS');
  assert.equal(c.rmDatasource, '/jdbc/Corpore');
  assert.equal(c.rmBridgeDataset, 'ds_generic_rm_sql');
  assert.equal(c.scratchPrefix, 'ds_mcp_');
  assert.equal(c.readOnly, false);
});

test('honours overrides', () => {
  const c = loadConfig({
    ...MINIMAL,
    FLUIG_COMPANY: '-1',
    FLUIG_USERCODE: 'alice.smith',
    FLUIG_IPS: '10.0.0.1, 10.0.0.2 ,',
    FLUIG_DATASOURCE: '/jdbc/Other',
    FLUIG_RM_DATASOURCE: '/jdbc/RM',
    FLUIG_RM_BRIDGE_DATASET: 'ds_rm_bridge',
    FLUIG_SCRATCH_PREFIX: 'ds_tmp_',
  });
  assert.equal(c.companyId, -1);
  assert.equal(c.userCode, 'alice.smith');
  assert.deepEqual(c.seedIps, ['10.0.0.1', '10.0.0.2']);
  assert.equal(c.datasource, '/jdbc/Other');
  assert.equal(c.rmDatasource, '/jdbc/RM');
  assert.equal(c.rmBridgeDataset, 'ds_rm_bridge');
  assert.equal(c.scratchPrefix, 'ds_tmp_');
});

test('parses the read-only flag from the usual truthy spellings', () => {
  for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(loadConfig({ ...MINIMAL, FLUIG_READONLY: v }).readOnly, true, `expected ${v} to be truthy`);
  }
  for (const v of ['0', 'false', 'no', '', undefined]) {
    assert.equal(loadConfig({ ...MINIMAL, FLUIG_READONLY: v }).readOnly, false, `expected ${v} to be falsy`);
  }
});
