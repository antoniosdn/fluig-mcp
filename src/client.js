import soap from 'soap';
import dns from 'node:dns/promises';
import net from 'node:net';

/**
 * Headless client for the TOTVS Fluig API.
 *
 * It speaks the same three protocols the platform itself uses — the session cookie from
 * `login.do`, the legacy `/webdesk/*` SOAP services, and the v2 REST API — so everything
 * the Fluig Studio / Eclipse plugin can do is reachable from a plain Node process.
 *
 * NETWORK RESILIENCE. Fluig is usually deployed behind corporate DNS, and corporate DNS
 * lies: split-horizon zones hand out addresses that are unreachable from where you are,
 * and a single unlucky lookup then looks exactly like "the server is down". So this client
 * resolves the address itself: it gathers candidates (last known-good IP, `dns.resolve4`,
 * `dns.lookup`, operator-provided seeds), TCP-probes them in parallel, and pins the first
 * one that answers — keeping the original `Host` header so name-based virtual hosts still
 * work. The good address is cached for ~60s and re-probed on any failure (self-healing).
 * This covers both `fetch` (REST) and node-soap. On top of that, every call goes through
 * a retry with backoff that only insists on transient network errors.
 */

/**
 * Runs `fn`, retrying transient network failures with linear backoff.
 * A non-transient error on a retry attempt aborts immediately — no point hammering a 403.
 */
async function retry(fn, tries = 4, baseMs = 400) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = /fetch failed|timeout|ECONN|ETIMEDOUT|socket|network|EAI_AGAIN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH/i
        .test(e?.message || e?.cause?.code || '');
      if (!transient && i > 0) break;
      await new Promise((r) => setTimeout(r, baseMs * (i + 1)));
    }
  }
  throw lastErr;
}

const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

/** TCP-probes `ip:port`. Resolves true/false and never throws. */
function tcpOk(ip, port, timeout = 2500) {
  return new Promise((res) => {
    const s = net.connect({ host: ip, port: Number(port), timeout });
    const done = (ok) => { try { s.destroy(); } catch { /* already gone */ } res(ok); };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

/**
 * Probes every candidate in parallel and resolves with the FIRST one that connects.
 * Only waits for the full timeout when they all fail — a dead address never delays a live one.
 */
function firstReachable(ips, port, timeout = 2500) {
  return new Promise((resolve) => {
    let pending = ips.length;
    if (!pending) return resolve(null);
    for (const ip of ips) {
      tcpOk(ip, port, timeout).then((ok) => {
        if (ok) resolve(ip);
        else if (--pending === 0) resolve(null);
      });
    }
  });
}

/**
 * Picks a reachable address for `hostname`, in preference order:
 * last known-good, `dns.resolve4`, `dns.lookup`, operator seeds — each with a short timeout,
 * and TCP-probed before being elected. Never trusts a single lookup.
 */
async function pickIp(hostname, port, seeds = [], preferred) {
  if (net.isIP(hostname)) return hostname;
  const candidates = [];
  if (preferred) candidates.push(preferred);
  try {
    for (const ip of await withTimeout(dns.resolve4(hostname), 1500)) {
      if (!candidates.includes(ip)) candidates.push(ip);
    }
  } catch { /* DNS is allowed to be flaky; that is the whole point of this function */ }
  try {
    for (const a of await withTimeout(dns.lookup(hostname, { all: true, family: 4 }), 1200)) {
      if (!candidates.includes(a.address)) candidates.push(a.address);
    }
  } catch { /* same */ }
  for (const ip of seeds) if (ip && !candidates.includes(ip)) candidates.push(ip);
  if (!candidates.length) return hostname; // last resort: let the OS try to resolve it
  return (await firstReachable(candidates, port)) || candidates[0];
}

export class FluigClient {
  /** @param {import('./config.js').FluigConfig} cfg */
  constructor(cfg) {
    this.host = cfg.host;
    this.user = cfg.user;
    this.pass = cfg.pass;
    this.companyId = cfg.companyId;
    this.userCode = cfg.userCode || cfg.user;

    this.datasource = cfg.datasource || '/jdbc/AppDS';
    this.rmDatasource = cfg.rmDatasource || '/jdbc/Corpore';
    this.rmBridgeDataset = cfg.rmBridgeDataset || 'ds_generic_rm_sql';
    this.scratchPrefix = cfg.scratchPrefix || 'ds_mcp_';

    this._cookie = null;
    this._soap = {};
    const u = new URL(this.host);
    this._proto = u.protocol;                                     // 'http:' | 'https:'
    this._hostname = u.hostname;
    this._port = u.port || (u.protocol === 'https:' ? '443' : '80');
    this._hostHeader = u.host;                                    // host:port, preserved for the vhost
    this._seeds = cfg.seedIps || [];
    this._live = null;                                            // { ip, base, at }
  }

  /** Name of a throwaway dataset owned by this server. */
  _scratch(suffix) {
    return `${this.scratchPrefix}${suffix}`;
  }

  /** Live base URL (proto//ip:port) with a verified address; cached ~60s, re-probed on error. */
  async _liveBase() {
    if (this._live && Date.now() - this._live.at < 60_000) return this._live;
    const ip = await pickIp(this._hostname, this._port, this._seeds, this._live?.ip);
    this._live = { ip, base: `${this._proto}//${ip}:${this._port}`, at: Date.now() };
    return this._live;
  }

  /** Forces address re-probing on the next request. */
  _bustIp() {
    this._live = null;
  }

  /** Resilient fetch: TCP-probe the address, then call the hostname so TLS/SNI match the cert. */
  async _fetch(path, opts = {}) {
    return retry(async () => {
      await this._liveBase();
      const headers = { ...(opts.headers || {}), Host: this._hostHeader };
      try {
        return await fetch(`${this.host}${path}`, { ...opts, headers });
      } catch (e) {
        this._bustIp(); // the pinned address may have just died — re-probe next attempt
        throw e;
      }
    });
  }

  // ---------- Session ----------

  /**
   * Authenticates and caches the session cookie (`JSESSIONIDSSO`), which every other
   * call reuses — including the public v2 REST API, which accepts it in place of OAuth.
   *
   * A 403 here does not necessarily mean bad credentials: an inline web filter can block
   * the pinned address and return its own page. So a failure re-probes the address and
   * retries before reporting an authentication problem, to avoid a false alarm.
   */
  async login() {
    if (this._cookie) return this._cookie;
    let lastStatus;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this._fetch('/portal/api/servlet/login.do', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `j_username=${encodeURIComponent(this.user)}&j_password=${encodeURIComponent(this.pass)}`,
        redirect: 'manual',
      });
      lastStatus = r.status;
      const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
      this._cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
      if (/JSESSIONIDSSO|jwt\.token/.test(this._cookie)) return this._cookie;
      this._cookie = null;
      if (attempt < 2) this._bustIp();
    }
    throw new Error(`Login failed (HTTP ${lastStatus}). Check FLUIG_HOST, FLUIG_USER and FLUIG_PASS.`);
  }

  /** True when the session is valid. */
  async ping() {
    const cookie = await this.login();
    const r = await this._fetch('/portal/p/api/servlet/ping', { method: 'POST', headers: { Cookie: cookie } });
    return r.ok && (await r.text()).includes('pong');
  }

  /**
   * Authenticated REST call that parses JSON.
   *
   * Corporate web filters sometimes block a specific egress path and answer with an HTML
   * block page. That failure mode disguises itself as "dataset not found" for anyone who
   * only notices that JSON.parse threw. So the block signature is detected explicitly and
   * triggers an address re-probe plus retry — a different address is usually not blocked.
   */
  async _rest(path, { method = 'GET', body, form = false } = {}) {
    const cookie = await this.login();
    const headers = { Cookie: cookie, Accept: 'application/json' };
    if (body) headers['Content-Type'] = form ? 'application/x-www-form-urlencoded' : 'application/json';
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await this._fetch(path, { method, headers, body });
      const text = await r.text();
      try { return JSON.parse(text); } catch { /* fall through to the block detection below */ }
      const blocked = /FortiGuard|Web Filter Violation|Web Page Blocked/i.test(text);
      if (blocked && attempt < 2) { this._bustIp(); continue; }
      return { _status: r.status, _raw: text, _blocked: blocked };
    }
  }

  /**
   * Authenticated "raw" REST call: does not force `Accept: application/json` and does not
   * try to parse the body. Required by the endpoints that speak XML or SVG (process
   * export/import, diagram upload).
   *
   * @returns {Promise<{status:number, text:string, contentType:string}>}
   */
  async _restRaw(path, { method = 'GET', body, contentType, accept } = {}) {
    const cookie = await this.login();
    const headers = { Cookie: cookie };
    if (accept) headers.Accept = accept;
    if (body !== undefined && contentType) headers['Content-Type'] = contentType;
    const r = await this._fetch(path, { method, headers, body });
    const text = await r.text();
    return { status: r.status, text, contentType: r.headers.get('content-type') || '' };
  }

  /** Cached node-soap client, pinned to the verified address with the vhost Host header. */
  async _soapClient(wsdlPath) {
    if (this._soap[wsdlPath]) return this._soap[wsdlPath];
    const cookie = await this.login();
    const { base } = await this._liveBase();
    const wsdlUrl = `${base}${wsdlPath}`;
    const client = await retry(() => soap.createClientAsync(wsdlUrl, {
      disableCache: true,
      handleNilAsNull: true,
      endpoint: wsdlUrl.replace('?wsdl', ''),    // talk straight to the verified address
      wsdl_headers: { Host: this._hostHeader },  // vhost for the WSDL fetch itself
    }));
    client.addHttpHeader('Host', this._hostHeader);
    client.addHttpHeader('Cookie', cookie);
    this._soap[wsdlPath] = client;
    return client;
  }

  // ---------- Datasets ----------

  /** Every dataset registered on the server (built-in, form-backed and custom). */
  async listDatasets() {
    const client = await this._soapClient('/webdesk/ECMDatasetService?wsdl');
    const [res] = await retry(() => client.findAllFormulariesDatasetsAsync({
      companyId: this.companyId, username: this.user, password: this.pass,
    }));
    const items = res?.dataset?.item || [];
    return Array.isArray(items) ? items : [items];
  }

  /** Full record of a CUSTOM dataset, including its source in `datasetImpl`. */
  async getCustomDataset(datasetId) {
    return this._rest(`/ecm/api/rest/ecm/dataset/loadDataset?datasetId=${encodeURIComponent(datasetId)}`);
  }

  /** Runs a dataset and normalises the SOAP payload into `{ columns, values }` rows. */
  async runDataset(name, { fields = [], constraints = [], order = [] } = {}) {
    const client = await this._soapClient('/webdesk/ECMDatasetService?wsdl');
    const [res] = await retry(() => client.getDatasetAsync({
      companyId: this.companyId, username: this.user, password: this.pass,
      name, fields: { item: fields }, constraints: { item: constraints }, order: { item: order },
    }));
    const ds = res?.dataset;
    if (!ds) return { columns: [], values: [] };
    const columns = Array.isArray(ds.columns) ? ds.columns : [ds.columns];
    const raw = ds.values == null ? [] : (Array.isArray(ds.values) ? ds.values : [ds.values]);
    const values = raw.map((item) => {
      const vals = Array.isArray(item.value) ? item.value : [item.value];
      const row = {};
      columns.forEach((c, i) => {
        row[c] = (vals[i] && vals[i].$value !== undefined) ? vals[i].$value : (vals[i] ?? null);
      });
      return row;
    });
    return { columns, values };
  }

  _customDatasetStructure(datasetId, code, description) {
    return {
      datasetPK: { companyId: this.companyId, datasetId },
      datasetDescription: description || datasetId,
      datasetImpl: code,
      datasetBuilder: 'com.datasul.technology.webdesk.dataset.CustomizedDatasetBuilder',
      serverOffline: false, mobileCache: false, lastReset: 0, lastRemoteSync: 0,
      type: 'CUSTOM', mobileOffline: false, updateIntervalTimestamp: 0,
    };
  }

  async createDataset(datasetId, code, description) {
    return this._rest('/ecm/api/rest/ecm/dataset/createDataset', {
      method: 'POST',
      body: JSON.stringify(this._customDatasetStructure(datasetId, code, description)),
    });
  }

  async updateDataset(datasetId, code, description) {
    // The REST read (loadDataset) lags behind the SOAP write by a moment after a recent
    // create/update. A short retry avoids a spurious "not found" when several passthrough
    // queries are issued back to back.
    let existing;
    for (let i = 0; i < 3; i++) {
      existing = await this.getCustomDataset(datasetId);
      if (existing && existing.datasetImpl !== undefined) break;
      if (i < 2) await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    if (!existing || existing.datasetImpl === undefined) {
      throw new Error(`Custom dataset '${datasetId}' not found for update.`);
    }
    existing.datasetImpl = code;
    if (description) existing.datasetDescription = description;
    return this._rest('/ecm/api/rest/ecm/dataset/editDataset?confirmnewstructure=false', {
      method: 'POST', body: JSON.stringify(existing),
    });
  }

  /** Upsert: creates the dataset when absent, updates it otherwise. */
  async saveDataset(datasetId, code, description) {
    const all = await this.listDatasets();
    const exists = all.some((d) => d.datasetId === datasetId && d.type === 'CUSTOM');
    return exists
      ? this.updateDataset(datasetId, code, description)
      : this.createDataset(datasetId, code, description);
  }

  /**
   * Structure (columns and types) of a dataset WITHOUT running it — useful to learn the
   * schema before composing a query.
   *
   * The endpoint (`/api/public/ecm/dataset/datasetStructure/`) is not in the public docs;
   * it was recovered from the official mobile app and confirmed against a live server.
   */
  async getDatasetStructure(datasetId) {
    const j = await this._rest(`/api/public/ecm/dataset/datasetStructure/${encodeURIComponent(datasetId)}`);
    const c = j?.content ?? j;
    return { datasetId: c?.datasetId ?? datasetId, fields: c?.fields ?? [], _raw: c?.fields ? undefined : j };
  }

  /**
   * Deletes a CUSTOM dataset.
   *
   * Signature confirmed both in the Fluig Studio client and in the live WSDL:
   * `(companyId:int, username:string, password:string, name:string)` — `companyId` comes
   * FIRST and the dataset goes in `name`, not `datasetId`. Authentication uses the SOAP
   * token in the username slot with an empty password.
   */
  async deleteDataset(datasetId, opts = {}) {
    if (opts.confirm !== true) throw new Error('deleteDataset requires { confirm: true }.');
    const token = await this.getToken();
    const { companyId } = await this.resolveTenant();
    const ds = await this._soapClient('/webdesk/ECMDatasetService?wsdl');
    const [res] = await retry(() => ds.deleteDatasetAsync({
      companyId, username: token, password: '', name: datasetId,
    }));
    return this._wfScalar(res, 'result', 'return') ?? res;
  }

  // ---------- Forms (ECM CardIndex) ----------

  async listForms() {
    const client = await this._soapClient('/webdesk/ECMCardIndexService?wsdl');
    const [res] = await retry(() => client.getCardIndexesWithoutApproverAsync({
      companyId: this.companyId, username: this.user, password: this.pass, colleagueId: this.userCode,
    }));
    const items = res?.result?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  }

  /** Customisation events of a form (displayFields, validateForm, enableFields, ...). */
  async getFormEvents(documentId) {
    const client = await this._soapClient('/webdesk/ECMCardIndexService?wsdl');
    const [res] = await retry(() => client.getCustomizationEventsAsync({
      companyId: this.companyId, username: this.user, password: this.pass, documentId,
    }));
    const items = res?.result?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  }

  async getFormFileNames(documentId) {
    const client = await this._soapClient('/webdesk/ECMCardIndexService?wsdl');
    const [res] = await retry(() => client.getAttachmentsListAsync({
      companyId: this.companyId, username: this.user, password: this.pass,
      documentId, colleagueId: this.userCode,
    }));
    const items = res?.result?.item || [];
    return Array.isArray(items) ? items : (items ? [items] : []);
  }

  async getFormFileBase64(documentId, version, fileName) {
    const client = await this._soapClient('/webdesk/ECMCardIndexService?wsdl');
    const [res] = await retry(() => client.getCardIndexContentAsync({
      companyId: this.companyId, username: this.user, password: this.pass,
      documentId, colleagueId: this.userCode, version, nomeArquivo: fileName,
    }));
    return res?.folder || '';
  }

  /** Reads a whole form: metadata + every file as text + every event. */
  async getFormFull(documentId, version) {
    const meta = (await this.listForms()).find((f) => String(f.documentId) === String(documentId)) || {};
    const names = await this.getFormFileNames(documentId);
    const files = [];
    for (const fileName of names) {
      const b64 = await this.getFormFileBase64(documentId, version, fileName);
      files.push({ fileName, content: b64 ? Buffer.from(b64, 'base64').toString('utf8') : '' });
    }
    const events = (await this.getFormEvents(documentId))
      .map((e) => ({ eventId: e.eventId, eventDescription: e.eventDescription }));
    return { meta, files, events };
  }

  /**
   * Publishes a form (SOAP `updateSimpleCardIndexWithDatasetAndGeneralInfo`).
   *
   * The API REPLACES the whole set, so every file and every event must be sent — read the
   * form with `getFormFull` first and change only what you mean to change.
   *
   * @param {number} documentId
   * @param {object} opts { datasetName, cardDescription, descriptionField, files, events,
   *                        versionOption:'0'|'2', principalHtml }
   */
  async saveForm(documentId, opts) {
    const client = await this._soapClient('/webdesk/ECMCardIndexService?wsdl');
    const attachments = (opts.files || []).map((f) => ({
      fileName: f.fileName,
      // BINARY files (png/jpg/...) must arrive pre-encoded in `contentBase64`. Round-tripping
      // binary through a utf8 string CORRUPTS it — a lesson learned by nearly destroying an
      // icon while republishing a form.
      filecontent: f.contentBase64 != null
        ? f.contentBase64
        : Buffer.from(f.content, 'utf8').toString('base64'),
      principal: opts.principalHtml
        ? f.fileName === opts.principalHtml
        : /\.html?$/i.test(f.fileName),
    }));
    const customEvents = (opts.events || []).map((e) => ({
      eventDescription: e.eventDescription, eventId: e.eventId, eventVersAnt: false,
    }));
    const params = {
      username: this.user, password: this.pass, companyId: this.companyId,
      publisherId: this.userCode,
      documentId,
      descriptionField: opts.descriptionField || '',
      cardDescription: opts.cardDescription,
      datasetName: opts.datasetName,
      Attachments: { item: attachments },
      customEvents: { item: customEvents },
      generalInfo: { versionOption: opts.versionOption || '2' },
    };
    const [res] = await retry(() => client.updateSimpleCardIndexWithDatasetAndGeneralInfoAsync(params));
    const item = res?.result?.item || res?.result || res;
    return item?.webServiceMessage || JSON.stringify(item);
  }

  // ---------- Global events ----------

  async listGlobalEvents() {
    return this._rest('/ecm/api/rest/ecm/globalevent/getEventList');
  }

  /** Upserts one global event; the endpoint takes the complete list, so it is read first. */
  async saveGlobalEvent(eventId, code) {
    const list = await this.listGlobalEvents();
    const arr = Array.isArray(list) ? list.slice() : [];
    const dto = { globalEventPK: { companyId: this.companyId, eventId }, eventDescription: code };
    const idx = arr.findIndex((e) => e.globalEventPK && e.globalEventPK.eventId === eventId);
    if (idx === -1) arr.push(dto); else arr[idx] = dto;
    const cookie = await this.login();
    const r = await this._fetch('/ecm/api/rest/ecm/globalevent/saveEventList', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookie,
      },
      body: JSON.stringify(arr),
    });
    return r.json();
  }

  // ---------- Optional FluiggersWidget add-on ----------
  // The community FluiggersWidget exposes process events over HTTP. It is optional: the
  // XML route below (exportProcessXml / setProcessEventViaXml) does the same job on a stock
  // server, and does it through a versioned, revertible deploy. These stay for installations
  // that already run the widget.

  async hasFluiggersWidget() {
    const cookie = await this.login();
    const r = await this._fetch('/fluiggersWidget/api/ping', { headers: { Cookie: cookie } });
    return r.status === 200 && (await r.text()).trim() === 'pong';
  }

  async getWorkflowEvents(processId, version) {
    const cookie = await this.login();
    const r = await this._fetch(
      `/fluiggersWidget/api/workflows/${encodeURIComponent(processId)}/${version}/events`,
      { headers: { Cookie: cookie } },
    );
    if (!r.ok) throw new Error(`Could not read process events (HTTP ${r.status}). Is FluiggersWidget installed?`);
    return r.json();
  }

  async updateWorkflowEvents(processId, version, events) {
    const cookie = await this.login();
    const r = await this._fetch(
      `/fluiggersWidget/api/workflows/${encodeURIComponent(processId)}/${version}/events`,
      {
        method: 'PUT',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      },
    );
    if (!r.ok) throw new Error(`Could not write process events (HTTP ${r.status}). Is FluiggersWidget installed?`);
    return r.json();
  }

  // ---------- REST escape hatches ----------

  async restGet(path) {
    return this._rest(path);
  }

  async restPost(path, body, form = false) {
    return this._rest(path, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      form,
    });
  }

  // ---------- SQL passthrough ----------
  // Custom datasets run server-side with a JDBC handle, which makes them a general-purpose
  // query channel: this client writes a throwaway dataset, runs it, and reads the rows back.
  // Powerful and correspondingly dangerous — see SECURITY.md.

  /** Builds the Rhino (ES5) source of a SELECT passthrough dataset. */
  _selectPassthroughCode(jndiName, sql) {
    return 'function createDataset(fields, constraints, sortFields){' +
      'var nd=DatasetBuilder.newDataset();var ic=new javax.naming.InitialContext();' +
      'var ds=ic.lookup(' + JSON.stringify(jndiName) + ');' +
      'var sql=' + JSON.stringify(sql) + ';var created=false,conn=null,stmt=null,rs=null;' +
      'try{conn=ds.getConnection();stmt=conn.createStatement();rs=stmt.executeQuery(sql);' +
      'var cc=rs.getMetaData().getColumnCount();' +
      'while(rs.next()){if(!created){for(var i=1;i<=cc;i++){nd.addColumn(rs.getMetaData().getColumnName(i));}created=true;}' +
      'var a=new Array();for(var i=1;i<=cc;i++){var o=rs.getObject(i);a[i-1]=(o!=null)?o.toString():"null";}nd.addRow(a);}' +
      'if(!created){nd.addColumn("INFO");nd.addRow(new Array("0 rows"));}}' +
      'catch(e){nd.addColumn("ERROR");nd.addRow(new Array(""+e.message));}' +
      'finally{if(rs!=null)rs.close();if(stmt!=null)stmt.close();if(conn!=null)conn.close();}return nd;}';
  }

  /** Read-only SELECT against the Fluig database. */
  async dbQuery(sql) {
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('dbQuery: only SELECT/WITH is allowed.');
    const name = this._scratch('dbquery');
    await this.saveDataset(name, this._selectPassthroughCode(this.datasource, sql), 'MCP passthrough (read-only)');
    return this.runDataset(name);
  }

  /** Read-only SELECT against the TOTVS RM database. */
  async rmDbQuery(sql) {
    if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('rmDbQuery: only SELECT/WITH is allowed.');
    const name = this._scratch('rmdbquery');
    await this.saveDataset(name, this._selectPassthroughCode(this.rmDatasource, sql), 'MCP RM passthrough (read-only)');
    return this.runDataset(name);
  }

  /**
   * INSERT/UPDATE/DELETE against the RM database. Requires `confirm: true`.
   *
   * Note that the RM datasource is frequently configured read-only, in which case the
   * supported write path is the RM DataServer API, not this one.
   */
  async rmDbExec(sql, opts = {}) {
    if (opts.confirm !== true) throw new Error('rmDbExec requires { confirm: true } (writes to the RM database).');
    if (/^\s*(select|with)\b/i.test(sql)) throw new Error('rmDbExec is for writes; use rmDbQuery for SELECT.');
    const code = 'function createDataset(fields, constraints, sortFields){' +
      'var nd=DatasetBuilder.newDataset();nd.addColumn("AFFECTED");' +
      'var ic=new javax.naming.InitialContext();var ds=ic.lookup(' + JSON.stringify(this.rmDatasource) + ');' +
      'var conn=null,ps=null;' +
      'try{conn=ds.getConnection();ps=conn.prepareStatement(' + JSON.stringify(sql) + ');' +
      'var n=ps.executeUpdate();nd.addRow(new Array(""+n));}' +
      'catch(e){nd.addColumn("ERROR");nd.addRow(new Array(""+e.message));}' +
      'finally{if(ps!=null)ps.close();if(conn!=null)conn.close();}return nd;}';
    const name = this._scratch('rmexec');
    await this.saveDataset(name, code, 'MCP RM exec (WRITE)');
    return this.runDataset(name);
  }

  /**
   * Queries TOTVS RM through the stored-SQL bridge dataset.
   *
   * Many Fluig/RM integrations do not expose the RM database directly; instead RM registers
   * named SQL statements and a bridge dataset relays them, keyed by statement code, branch
   * (`CODCOLIGADA`) and application (`CODAPLICACAO`). The bridge dataset name is
   * configurable (`FLUIG_RM_BRIDGE_DATASET`) because it varies between installations.
   *
   * @param {string} statementCode  RM statement id, e.g. `WS.247`.
   * @param {string[]} fields       Columns the statement returns (required — the bridge needs them declared).
   * @param {string} branch         `CODCOLIGADA`.
   * @param {string} application    `CODAPLICACAO`.
   * @param {Record<string,string>} params Extra statement parameters.
   */
  async rmQuery(statementCode, fields, branch = '0', application = 'G', params = {}) {
    if (!Array.isArray(fields) || !fields.length) {
      throw new Error('rmQuery: pass the list of fields the statement returns.');
    }
    let extra = '';
    for (const k of Object.keys(params)) {
      const v = String(params[k]);
      extra += 'c.push(DatasetFactory.createConstraint(' +
        JSON.stringify(k) + ',' + JSON.stringify(v) + ',' + JSON.stringify(v) + ',ConstraintType.MUST));';
    }
    const code = 'function createDataset(fields, constraints, sortFields){' +
      'var flds=' + JSON.stringify(fields) + ';var c=[];' +
      'c.push(DatasetFactory.createConstraint("CODSENTENCA",' +
        JSON.stringify(statementCode) + ',' + JSON.stringify(statementCode) + ',ConstraintType.MUST));' +
      'c.push(DatasetFactory.createConstraint("CODCOLIGADA",' +
        JSON.stringify(String(branch)) + ',' + JSON.stringify(String(branch)) + ',ConstraintType.MUST));' +
      'c.push(DatasetFactory.createConstraint("CODAPLICACAO",' +
        JSON.stringify(application) + ',' + JSON.stringify(application) + ',ConstraintType.MUST));' +
      extra +
      'var r=DatasetFactory.getDataset(' + JSON.stringify(this.rmBridgeDataset) + ',flds,c,null);' +
      'var nd=DatasetBuilder.newDataset();' +
      'if(r==null||r.rowsCount<1){nd.addColumn("INFO");nd.addRow(new Array("0 rows"));return nd;}' +
      'for(var j=0;j<flds.length;j++){nd.addColumn(flds[j]);}' +
      'for(var i=0;i<r.rowsCount;i++){var a=new Array();' +
      'for(var j=0;j<flds.length;j++){a[j]=""+r.getValue(i,flds[j]);}nd.addRow(a);}return nd;}';
    const name = this._scratch('rmquery');
    await this.saveDataset(name, code, 'MCP RM statement bridge');
    return this.runDataset(name);
  }

  // ---------- Process events via the database (legacy path) ----------

  /** Reads the source of a process event straight from `event_proces`. */
  async getProcessEventCode(processCode, eventName, version) {
    const esc = (s) => String(s).replace(/'/g, "''");
    const r = await this.dbQuery(
      'SELECT CAST(e.DSL_EVENT AS NVARCHAR(MAX)) AS CODE FROM event_proces e WITH(NOLOCK) ' +
      `WHERE e.COD_DEF_PROCES LIKE '%${esc(processCode)}%' ` +
      `AND e.COD_EVENT='${esc(eventName)}' AND e.NUM_VERS=${parseInt(version, 10)}`,
    );
    return r.values.length ? r.values[0].CODE : null;
  }

  /**
   * Writes a process event straight into `event_proces`, in place, with an automatic backup
   * of the previous source. Requires `confirm: true`.
   *
   * DEPRECATED in favour of `setProcessEventViaXml`, which goes through the supported
   * export/import path and produces a new, revertible version. This one edits the published
   * version behind the engine's back and bypasses server-side validation; it survives only
   * because it is occasionally the only way to patch without cutting a new version.
   */
  async setProcessEvent(processCode, eventName, version, newCode, opts = {}) {
    if (opts.confirm !== true) throw new Error('setProcessEvent requires { confirm: true } (writes to event_proces).');
    const backup = await this.getProcessEventCode(processCode, eventName, version);
    // Resolve the EXACT COD_DEF_PROCES/COD_EMPRESA: callers usually pass a fragment, while
    // the row key needs the full process id. Without this the UPDATE matches zero rows.
    const esc = (s) => String(s).replace(/'/g, "''");
    const meta = await this.dbQuery(
      'SELECT TOP 1 COD_EMPRESA, COD_DEF_PROCES FROM event_proces WITH(NOLOCK) ' +
      `WHERE COD_DEF_PROCES LIKE '%${esc(processCode)}%' ` +
      `AND COD_EVENT='${esc(eventName)}' AND NUM_VERS=${parseInt(version, 10)}`,
    );
    if (!meta.values.length) {
      throw new Error(`setProcessEvent: event not found (process~${processCode}, ${eventName}, v${version}).`);
    }
    const company = parseInt(opts.company || meta.values[0].COD_EMPRESA, 10);
    const processId = meta.values[0].COD_DEF_PROCES;
    const code = 'function createDataset(fields, constraints, sortFields){' +
      'var nd=DatasetBuilder.newDataset();nd.addColumn("AFFECTED");' +
      'var ic=new javax.naming.InitialContext();var ds=ic.lookup(' + JSON.stringify(this.datasource) + ');' +
      'var conn=null,ps=null;' +
      'try{conn=ds.getConnection();ps=conn.prepareStatement("UPDATE event_proces SET DSL_EVENT=? ' +
      'WHERE COD_EMPRESA=? AND COD_DEF_PROCES=? AND COD_EVENT=? AND NUM_VERS=?");' +
      'ps.setString(1,' + JSON.stringify(newCode) + ');ps.setInt(2,' + company + ');' +
      'ps.setString(3,' + JSON.stringify(String(processId)) + ');' +
      'ps.setString(4,' + JSON.stringify(String(eventName)) + ');' +
      'ps.setInt(5,' + parseInt(version, 10) + ');' +
      'var n=ps.executeUpdate();nd.addRow(new Array(""+n));}' +
      'catch(e){nd.addColumn("ERROR");nd.addRow(new Array(""+e.message));}' +
      'finally{if(ps!=null)ps.close();if(conn!=null)conn.close();}return nd;}';
    const name = this._scratch('dbexec');
    await this.saveDataset(name, code, 'MCP setProcessEvent (UPDATE event_proces)');
    const res = await this.runDataset(name);
    return { backup, result: res.values, processId };
  }

  // ---------- SOAP authentication token ----------

  /**
   * Token from `TokenService` — a different namespace and a different credential from the
   * session cookie. `WorkflowEngineService` authenticates with THIS token: it goes in the
   * `username` slot and `password` is left empty. Cached for slightly under its ~1 min life.
   * A response containing `UT010031` means the credentials were rejected.
   */
  async getToken() {
    if (this._token && Date.now() - this._tokenAt < 55_000) return this._token;
    const client = await this._soapClient('/webdesk/TokenService?wsdl');
    const [res] = await retry(() => client.getTokenAsync({ login: this.user, password: this.pass }));
    const token = res && (res.result ?? res.return ?? res);
    if (!token || String(token).includes('UT010031')) {
      throw new Error('Fluig getToken failed (UT010031): invalid user or password.');
    }
    this._token = String(token);
    this._tokenAt = Date.now();
    return this._token;
  }

  /** Resolves tenant + colleague id. A configured `companyId` other than -1 wins. */
  async resolveTenant() {
    if (this.companyId != null && parseInt(this.companyId, 10) !== -1) {
      return { companyId: parseInt(this.companyId, 10), colleagueId: this.userCode || this.user };
    }
    const j = await this._rest(
      '/portal/api/rest/wcmservice/rest/user/findUserByLogin/' +
      `?username=${encodeURIComponent(this.user)}&password=${encodeURIComponent(this.pass)}` +
      `&login=${encodeURIComponent(this.user)}`,
    );
    const c = j.content || j;
    return { companyId: parseInt(c.tenantId, 10), colleagueId: String(c.userCode) };
  }

  // ---------- Process definition deploy (SOAP) ----------

  /**
   * Deploys a process definition through `WorkflowEngineService` — no Fluig Studio needed.
   *
   * Beware the naming: in Fluig's vocabulary `importProcess` means UPLOAD (deploy) and
   * `exportProcess` means DOWNLOAD. The sequence is
   * `getToken -> [createWorkFlowProcessVersion] -> importProcess -> releaseProcess`.
   *
   * Prefer `importProcessXml` (REST v2) on servers that expose it: one call does the same
   * three steps server-side. This SOAP path stays for older or restricted deployments.
   *
   * @param {string} processDefXml Contents of the `.ecm30.xml` (root `<list><ProcessDefinition>`).
   * @param {object} opts { processId?, isNew=false, overWrite=true, svgXml?, confirm }
   */
  async deployProcess(processDefXml, opts = {}) {
    if (opts.confirm !== true) throw new Error('deployProcess requires { confirm: true } (structural deploy).');
    const processId = opts.processId || (String(processDefXml).match(/<processId>([^<]+)<\/processId>/) || [])[1];
    if (!processId) throw new Error('deployProcess: processId not given and not found in the XML.');
    const isNew = opts.isNew === true;
    const overWrite = opts.overWrite !== false;
    const token = await this.getToken();
    const { companyId, colleagueId } = await this.resolveTenant();
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
    const item = [{ fileName: `${processId}.ecm30.xml`, principal: true, filecontent: b64(processDefXml) }];
    if (opts.svgXml) {
      item.push({
        fileName: `${processId}.processimage.svg`, principal: false, attach: true, filecontent: b64(opts.svgXml),
      });
    }

    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    if (!isNew) {
      await retry(() => wf.createWorkFlowProcessVersionAsync({
        username: token, password: '', companyId, processId,
      }));
    }
    const [imp] = await retry(() => wf.importProcessAsync({
      username: token, password: '', companyId, processId,
      attachments: { item }, newProcess: isNew, overWrite, colleagueId,
    }));
    const [rel] = await retry(() => wf.releaseProcessAsync({
      username: token, password: '', companyId, processId,
    }));
    const released = rel && (rel.result ?? rel.return ?? '');
    // Fluig answers 200 with `ok=false` in the body instead of faulting.
    if (String(released).includes('ok=false')) {
      throw new Error(`releaseProcess returned ok=false: ${released}`);
    }
    return { processId, imported: imp && (imp.result ?? imp.return), released };
  }

  /** Processes available for export — handy to validate a deploy with a round trip. */
  async listDeployableProcesses() {
    const token = await this.getToken();
    const { companyId } = await this.resolveTenant();
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAllProcessAvailableToExportAsync({
      username: token, password: '', companyId,
    }));
    return res;
  }

  // ---------- Process instances (SOAP WorkflowEngineService) ----------

  /** `{field: value}` -> the StringArrayArray shape Fluig expects. */
  _cardDataToSoap(cardData = {}) {
    return {
      item: Object.keys(cardData).map((k) => ({
        item: [String(k), cardData[k] == null ? '' : String(cardData[k])],
      })),
    };
  }

  /** Normalises a StringArrayArray response into plain string rows. */
  _saaToRows(res) {
    const outer = res && (res.item != null ? res.item : (res.result?.item ?? res.return?.item ?? res));
    const rows = Array.isArray(outer) ? outer : (outer ? [outer] : []);
    return rows.map((r) => {
      const inner = r && (r.item != null ? r.item : r);
      const arr = Array.isArray(inner) ? inner : [inner];
      return arr.map((v) => (v && v.$value !== undefined) ? v.$value : v);
    });
  }

  /** Pulls the `.item` array out of whichever RPC part wrapper the response used. */
  _wfItems(res, ...keys) {
    let node = res;
    for (const k of keys) { if (res && res[k] != null) { node = res[k]; break; } }
    const items = node && (node.item != null ? node.item : node);
    return Array.isArray(items) ? items : (items != null ? [items] : []);
  }

  /** Unwraps a scalar (node-soap's `$value`) from whichever wrapper is present. */
  _wfScalar(res, ...keys) {
    let v = res;
    for (const k of keys) { if (res && res[k] != null) { v = res[k]; break; } }
    return (v && v.$value !== undefined) ? v.$value : v;
  }

  /** Target states reachable from the instance's current state. */
  async getAvailableStates(processId, processInstanceId, threadSequence = 0) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAvailableStatesAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processId, processInstanceId: Number(processInstanceId), threadSequence: Number(threadSequence),
    }));
    const items = res?.item ?? res?.result?.item ?? res;
    const arr = Array.isArray(items) ? items : (items != null ? [items] : []);
    return arr.map((v) => (v && v.$value !== undefined) ? Number(v.$value) : Number(v)).filter((n) => !isNaN(n));
  }

  /**
   * Starts a new process instance. Authenticates as the configured user, who must hold the
   * start role. `completeTask: false` parks the instance on the start activity instead of
   * moving it. The new instance id comes back in the first numeric cell of the response.
   */
  async startProcess(processId, {
    choosedState, cardData = {}, colleagueIds = [], comments = '', completeTask = true, managerMode = false,
  } = {}) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.startProcessAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processId, choosedState: Number(choosedState),
      colleagueIds: { item: colleagueIds }, comments, userId: this.userCode,
      completeTask: !!completeTask, attachments: { item: [] },
      cardData: this._cardDataToSoap(cardData), appointment: { item: [] },
      managerMode: !!managerMode,
    }));
    const rows = this._saaToRows(res);
    const flat = rows.flat().map(String);
    const pid = flat.find((v) => /^\d+$/.test(v));
    return { processInstanceId: pid ? Number(pid) : null, rows };
  }

  /** Takes ownership of a task — required for pool/role tasks before moving them. */
  async takeProcessTask(processInstanceId, threadSequence = 0) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.takeProcessTaskAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processInstanceId: Number(processInstanceId),
      threadSequence: Number(threadSequence),
    }));
    return res && (res.result ?? res.return ?? res);
  }

  /**
   * Saves the card and moves the instance to `choosedState`.
   *
   * The card is REPLACED, not merged: send every field that must survive, or it is wiped.
   * Read the current card with `getInstanceCardData` first.
   */
  async saveAndSendTask(processInstanceId, {
    choosedState, cardData = {}, colleagueIds = [], comments = '',
    completeTask = true, managerMode = false, threadSequence = 0,
  } = {}) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.saveAndSendTaskAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processInstanceId: Number(processInstanceId), choosedState: Number(choosedState),
      colleagueIds: { item: colleagueIds }, comments, userId: this.userCode,
      completeTask: !!completeTask, attachments: { item: [] },
      cardData: this._cardDataToSoap(cardData), appointment: { item: [] },
      managerMode: !!managerMode, threadSequence: Number(threadSequence),
    }));
    return { rows: this._saaToRows(res) };
  }

  /** Whole card of a running instance as `{field: value}`. */
  async getInstanceCardData(processInstanceId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getInstanceCardDataAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processInstanceId: Number(processInstanceId),
    }));
    const rows = this._saaToRows(res?.CardData ?? res);
    const card = {};
    for (const r of rows) {
      const a = Array.isArray(r) ? r : [r];
      if (a.length) card[String(a[0])] = a[1] != null ? String(a[1]) : '';
    }
    return card;
  }

  /** A single card field of a running instance. */
  async getCardValue(processInstanceId, cardFieldName) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getCardValueAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processInstanceId: Number(processInstanceId), userId: this.userCode, cardFieldName,
    }));
    return this._wfScalar(res, 'content', 'result');
  }

  /** States the instance currently sits on. */
  async getActiveStates(processInstanceId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAllActiveStatesAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processInstanceId: Number(processInstanceId),
    }));
    return this._wfItems(res, 'States', 'result')
      .map((v) => (v && v.$value !== undefined) ? Number(v.$value) : Number(v))
      .filter((n) => !isNaN(n));
  }

  /** Target states with name and type — richer than `getAvailableStates`. */
  async getAvailableStatesDetail(processId, processInstanceId, threadSequence = 0) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAvailableStatesDetailAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processId, processInstanceId: Number(processInstanceId), threadSequence: Number(threadSequence),
    }));
    return this._wfItems(res, 'AvailableStatesDetail', 'result');
  }

  /** Current thread of a given state sequence. */
  async getActualThread(processInstanceId, stateSequence) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getActualThreadAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processInstanceId: Number(processInstanceId), stateSequence: Number(stateSequence),
    }));
    return Number(this._wfScalar(res, 'ActualThread', 'result'));
  }

  /** Full movement history of an instance: who moved it, when, from and to which activity. */
  async getProcessHistories(processInstanceId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getHistoriesAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processInstanceId: Number(processInstanceId),
    }));
    return this._wfItems(res, 'Histories', 'result');
  }

  /** Attachments of an instance. */
  async getProcessAttachments(processInstanceId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAttachmentsAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processInstanceId: Number(processInstanceId),
    }));
    return this._wfItems(res, 'Attachments', 'result');
  }

  /** Processes the logged-in user is allowed to start. */
  async getAvailableProcesses() {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAvailableProcessAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId), userId: this.userCode,
    }));
    return this._wfItems(res, 'AvailableProcesses', 'result');
  }

  /** Active version of a process — works without the FluiggersWidget. */
  async getWorkflowVersionSoap(processId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getWorkFlowProcessVersionAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId), processId,
    }));
    return Number(this._wfScalar(res, 'result', 'return'));
  }

  /** `documentId` of the form bound to a process. */
  async getProcessFormId(processId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getProcessFormIdAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId), processId,
    }));
    return Number(this._wfScalar(res, 'result', 'return'));
  }

  /** Flow diagram of a process (URL or base64, depending on the server). */
  async getProcessImage(processId) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getProcessImageAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      userId: this.userCode, processId,
    }));
    return this._wfScalar(res, 'Image', 'result');
  }

  /** Users eligible to receive the task at a given state of a running instance. */
  async getAvailableUsers(processInstanceId, state, threadSequence = 0) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAvailableUsersAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processInstanceId: Number(processInstanceId), state: Number(state),
      threadSequence: Number(threadSequence),
    }));
    return this._wfItems(res, 'AvailableUsers', 'result').map((v) => (v && v.$value !== undefined) ? v.$value : v);
  }

  /** Users eligible to receive the first task when starting a process. */
  async getAvailableUsersStart(processId, state, threadSequence = 0) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.getAvailableUsersStartAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processId, state: Number(state), threadSequence: Number(threadSequence),
    }));
    return this._wfItems(res, 'AvailableUsers', 'result').map((v) => (v && v.$value !== undefined) ? v.$value : v);
  }

  /** Free-text process search. */
  async searchProcess(content, favorite = false) {
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.searchProcessAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      colleagueId: this.userCode, content, favorite: !!favorite,
    }));
    return this._wfItems(res, 'searchResults', 'result');
  }

  /** Cancels/closes a running instance. Requires `confirm: true`. */
  async cancelProcessInstance(processInstanceId, cancelText = '', opts = {}) {
    if (opts.confirm !== true) {
      throw new Error('cancelProcessInstance requires { confirm: true } (cancels the instance).');
    }
    const wf = await this._soapClient('/webdesk/WorkflowEngineService?wsdl');
    const [res] = await retry(() => wf.cancelInstanceAsync({
      username: this.user, password: this.pass, companyId: Number(this.companyId),
      processInstanceId: Number(processInstanceId), userId: this.userCode, cancelText,
    }));
    return this._wfScalar(res, 'result', 'return');
  }

  // ---------- Process definitions over the v2 REST API ----------
  // These endpoints accept the same session cookie as everything else — no OAuth needed.

  /**
   * Downloads a process definition as `.ecm30.xml`.
   * @param {string} processId
   * @param {number} [version] Specific version; omitted means the current one.
   */
  async exportProcessXml(processId, version) {
    const p = version
      ? `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${Number(version)}/export/xml`
      : `/process-management/api/v2/processes/${encodeURIComponent(processId)}/export/xml`;
    const { status, text } = await this._restRaw(p, { accept: 'application/xml' });
    if (status !== 200) throw new Error(`exportProcessXml(${processId}) HTTP ${status}: ${text.slice(0, 300)}`);
    return text;
  }

  /**
   * Uploads (deploys) a process definition. The server performs
   * `createWorkFlowProcessVersion -> importProcess -> [release]` internally, so this single
   * call replaces the three SOAP ones. Requires `confirm: true`.
   *
   * The route encodes the intent:
   *   `POST /v2/processes/import/xml?processId=X` -> new process
   *   `POST /v2/processes/{processId}/import/xml` -> new version of an existing process
   */
  async importProcessXml(processId, xml, opts = {}) {
    if (opts.confirm !== true) throw new Error('importProcessXml requires { confirm: true } (structural deploy).');
    const qs = new URLSearchParams();
    if (opts.release === true) qs.set('release', 'true');
    if (opts.formId != null) qs.set('formId', String(opts.formId));
    if (opts.isNew === true) qs.set('processId', processId);
    const q = qs.toString();
    const p = opts.isNew === true
      ? `/process-management/api/v2/processes/import/xml${q ? '?' + q : ''}`
      : `/process-management/api/v2/processes/${encodeURIComponent(processId)}/import/xml${q ? '?' + q : ''}`;
    const { status, text } = await this._restRaw(p, {
      method: 'POST', body: xml, contentType: 'application/xml', accept: 'application/json',
    });
    if (status < 200 || status >= 300) {
      throw new Error(`importProcessXml(${processId}) HTTP ${status}: ${text.slice(0, 600)}`);
    }
    // Fluig answers 200 with `ok=false` in the body instead of returning an error status.
    if (/ok=false/i.test(text)) {
      throw new Error(`importProcessXml(${processId}): server returned ok=false -> ${text.slice(0, 400)}`);
    }
    try { return JSON.parse(text); } catch { return { _status: status, _raw: text }; }
  }

  /**
   * Escapes text for XML element content the same way Fluig itself serialises it: beyond
   * `&<>` it also escapes quotes and CR. Quotes would not strictly need escaping inside
   * element content, but matching the server byte for byte is what makes an
   * export -> patch -> import round trip verifiable.
   */
  _xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/\r/g, '&#xd;');
  }

  /** Reverses `_xmlEscape`, including numeric character references. */
  _xmlUnescape(s) {
    return String(s)
      .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /**
   * Reads process events, with their source, from the definition XML — the authoritative
   * copy. Needs neither the FluiggersWidget nor direct access to `event_proces`.
   *
   * @returns {Promise<Array<{eventId: string, version: number|undefined, code: string}>>}
   */
  async getProcessEventsFromXml(processId, version) {
    const xml = await this.exportProcessXml(processId, version);
    const out = [];
    const re = /<WorkflowProcessEvent>([\s\S]*?)<\/WorkflowProcessEvent>/g;
    let m;
    while ((m = re.exec(xml))) {
      const block = m[1];
      const id = (block.match(/<eventId>([\s\S]*?)<\/eventId>/) || [])[1];
      const ver = (block.match(/<version>([\s\S]*?)<\/version>/) || [])[1];
      const desc = (block.match(/<eventDescription>([\s\S]*?)<\/eventDescription>/) || [])[1];
      if (id) {
        out.push({
          eventId: id.trim(),
          version: ver ? Number(ver) : undefined,
          code: this._xmlUnescape(desc || ''),
        });
      }
    }
    return out;
  }

  /**
   * Writes a process event through the supported path: export the definition XML, replace
   * (or insert) the event's `<eventDescription>`, and re-import. That produces a NEW,
   * revertible version instead of an in-place UPDATE, and it goes through server-side
   * validation. Requires `confirm: true`; `dryRun: true` validates the patch without sending.
   */
  async setProcessEventViaXml(processId, eventId, code, opts = {}) {
    if (opts.dryRun !== true && opts.confirm !== true) {
      throw new Error('setProcessEventViaXml requires { confirm: true } (changes the process definition).');
    }
    const xml = await this.exportProcessXml(processId, opts.version);
    const esc = this._xmlEscape(code);
    const blockRe = new RegExp(
      '<WorkflowProcessEvent>(?:(?!</WorkflowProcessEvent>)[\\s\\S])*?<eventId>\\s*' +
      eventId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '\\s*</eventId>[\\s\\S]*?</WorkflowProcessEvent>',
    );
    const found = xml.match(blockRe);
    let next;
    let action;
    if (found) {
      // Replacement via FUNCTION, never via string: Fluig event code is full of `$`
      // (jQuery), and String.replace would read `$&`, `$'` and "$`" as capture references,
      // silently corrupting the script on its way to the server.
      let hit = false;
      const patched = found[0].replace(/<eventDescription>[\s\S]*?<\/eventDescription>/, () => {
        hit = true;
        return `<eventDescription>${esc}</eventDescription>`;
      });
      if (!hit) {
        throw new Error(`setProcessEventViaXml: block for ${eventId} has no <eventDescription> — aborted.`);
      }
      next = xml.replace(found[0], () => patched);
      action = 'updated';
    } else {
      // The event does not exist yet: build the block reusing companyId/version from the XML.
      const companyId = (xml.match(/<companyId>([^<]+)<\/companyId>/) || [])[1];
      const version = (xml.match(/<processDefinitionVersionPK>[\s\S]*?<version>([^<]+)<\/version>/) || [])[1];
      if (!companyId || !version) {
        throw new Error('setProcessEventViaXml: could not find companyId/version in the XML to create the event.');
      }
      const block = '  <WorkflowProcessEvent>\n' +
        '    <workflowProcessEventPK>\n' +
        `      <companyId>${companyId}</companyId>\n` +
        `      <processId>${processId}</processId>\n` +
        `      <version>${version}</version>\n` +
        `      <eventId>${eventId}</eventId>\n` +
        '    </workflowProcessEventPK>\n' +
        `    <eventDescription>${esc}</eventDescription>\n` +
        '  </WorkflowProcessEvent>\n';
      const lastIdx = xml.lastIndexOf('</WorkflowProcessEvent>');
      if (lastIdx !== -1) {
        const cut = lastIdx + '</WorkflowProcessEvent>'.length;
        next = xml.slice(0, cut) + '\n' + block + xml.slice(cut);
      } else {
        const close = xml.lastIndexOf('</list>');
        if (close === -1) throw new Error('setProcessEventViaXml: XML has no </list> — unexpected format.');
        next = xml.slice(0, close) + block + xml.slice(close);
      }
      action = 'created';
    }
    if (opts.dryRun === true) return { processId, eventId, action, dryRun: true, bytes: next.length };
    const res = await this.importProcessXml(processId, next, {
      confirm: true, release: opts.release === true, formId: opts.formId,
    });
    return { processId, eventId, action, released: opts.release === true, result: res };
  }

  /** Versions of a process (number, bound form, whether it is still being edited). */
  async listProcessVersions(processId) {
    const j = await this._rest(
      `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions`,
    );
    return j?.items ?? j;
  }

  /**
   * Withdraws a process version — the inverse of release, and the way to roll a bad deploy
   * back. Also mandatory before deleting a released version, which the server refuses.
   * Requires `confirm: true`.
   *
   * @param {string|number} [version] Omitted means `latest`.
   */
  async withdrawProcessVersion(processId, version, opts = {}) {
    if (opts.confirm !== true) throw new Error('withdrawProcessVersion requires { confirm: true }.');
    const seg = version == null ? 'latest' : String(Number(version));
    const p = `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${seg}/withdraw`;
    const { status, text } = await this._restRaw(p, { method: 'POST', accept: 'application/json' });
    if (status < 200 || status >= 300) {
      throw new Error(`withdrawProcessVersion HTTP ${status}: ${text.slice(0, 300)}`);
    }
    return { processId, version: seg, withdrawn: true };
  }

  /**
   * Deletes a process version. Withdraw it first if it is released.
   *
   * DESTRUCTIVE: deleting the LAST version removes the entire process definition — the next
   * GET answers with `BPMProcessDefinitionNotFoundException`. Requires `confirm: true`.
   */
  async deleteProcessVersion(processId, version, opts = {}) {
    if (opts.confirm !== true) throw new Error('deleteProcessVersion requires { confirm: true }.');
    const seg = version == null ? 'latest' : String(Number(version));
    const p = `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${seg}`;
    const { status, text } = await this._restRaw(p, { method: 'DELETE', accept: 'application/json' });
    if (status < 200 || status >= 300) {
      throw new Error(`deleteProcessVersion HTTP ${status}: ${text.slice(0, 300)}`);
    }
    return { processId, version: seg, deleted: true };
  }

  /**
   * Replaces the SVG diagram of a process version. Required after changing the topology in
   * the XML, otherwise the published drawing no longer matches the flow.
   */
  async setProcessDiagram(processId, processVersion, svg, opts = {}) {
    if (opts.confirm !== true) throw new Error('setProcessDiagram requires { confirm: true }.');
    const p = `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${Number(processVersion)}/diagram`;
    const { status, text } = await this._restRaw(p, {
      method: 'PUT', body: svg, contentType: 'application/svg+xml', accept: 'application/json',
    });
    if (status < 200 || status >= 300) {
      throw new Error(`setProcessDiagram HTTP ${status}: ${text.slice(0, 400)}`);
    }
    try { return JSON.parse(text); } catch { return { _status: status, _raw: text }; }
  }

  /** Configured user replacements — who answers for whom, and for how long. */
  async getUserReplacements({ limit } = {}) {
    const q = limit ? `?limit=${Number(limit)}` : '';
    const j = await this._rest(`/process-management/api/v2/user-replacements${q}`);
    return j?.items ?? j;
  }
}
