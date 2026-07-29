/**
 * Configuration, read entirely from the environment.
 *
 * There are deliberately no defaults for the host or the credentials. A tool that
 * ships with a working endpoint baked in is a leak waiting to happen, and a default
 * password is never the right answer — so a missing variable is a hard, explicit error
 * instead of a silent fallback to somebody else's server.
 */

/** Variables without which the client cannot do anything useful. */
const REQUIRED = ['FLUIG_HOST', 'FLUIG_USER', 'FLUIG_PASS'];

const TRUTHY = /^(1|true|yes|on)$/i;

/**
 * @typedef {object} FluigConfig
 * @property {string}   host             Base URL of the Fluig portal, e.g. `https://fluig.example.com:8080`.
 * @property {string}   user             Login used for REST, SOAP and the session cookie.
 * @property {string}   pass             Password for that login.
 * @property {number}   companyId        Tenant id (Fluig `companyId`). `-1` asks the server to resolve it.
 * @property {string}   userCode         Colleague id; defaults to `user`.
 * @property {string[]} seedIps          Fallback IPs probed when DNS is unreliable.
 * @property {string}   datasource       JNDI name of the Fluig database datasource.
 * @property {string}   rmDatasource     JNDI name of the TOTVS RM database datasource.
 * @property {string}   rmBridgeDataset  Dataset that proxies RM stored SQL statements.
 * @property {string}   scratchPrefix    Prefix for the throwaway datasets this server creates.
 * @property {boolean}  readOnly         When true, only non-mutating tools are exposed.
 */

/**
 * Reads and validates configuration.
 *
 * @param {NodeJS.ProcessEnv} [env] Environment to read from; injectable for tests.
 * @returns {FluigConfig}
 * @throws {Error} When a required variable is missing or `FLUIG_HOST` is not a valid http(s) URL.
 */
export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => !env[key] || !String(env[key]).trim());
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
      'Set them in your MCP client config or your shell — see .env.example.',
    );
  }

  const host = String(env.FLUIG_HOST).trim().replace(/\/+$/, '');
  let parsed;
  try {
    parsed = new URL(host);
  } catch {
    throw new Error(`FLUIG_HOST is not a valid URL: ${host}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`FLUIG_HOST must use http or https, got: ${parsed.protocol}`);
  }

  const user = String(env.FLUIG_USER).trim();

  return {
    host,
    user,
    pass: String(env.FLUIG_PASS),
    companyId: Number(env.FLUIG_COMPANY ?? 1),
    userCode: String(env.FLUIG_USERCODE || user).trim(),
    seedIps: String(env.FLUIG_IPS || '').split(',').map((s) => s.trim()).filter(Boolean),
    datasource: String(env.FLUIG_DATASOURCE || '/jdbc/AppDS').trim(),
    rmDatasource: String(env.FLUIG_RM_DATASOURCE || '/jdbc/Corpore').trim(),
    rmBridgeDataset: String(env.FLUIG_RM_BRIDGE_DATASET || 'ds_generic_rm_sql').trim(),
    scratchPrefix: String(env.FLUIG_SCRATCH_PREFIX || 'ds_mcp_').trim(),
    readOnly: TRUTHY.test(String(env.FLUIG_READONLY || '')),
  };
}
