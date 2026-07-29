/**
 * Tool registry.
 *
 * Kept separate from the MCP wiring so it can be inspected and tested without a transport
 * or a live server. Each entry is data plus a `run(client, args)` function; nothing here
 * touches the network until `run` is called.
 *
 * `write: true` marks a tool that changes business state on the server — those are the ones
 * hidden when `FLUIG_READONLY` is set, and every one of them also demands `confirm: true`
 * at the client layer.
 */

/** Rows returned inline by query tools. Bigger result sets should be narrowed by the SQL. */
const MAX_ROWS = 200;

const S = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = (description) => ({ type: 'string', description });
const num = (description) => ({ type: 'number', description });
const bool = (description) => ({ type: 'boolean', description });
const arr = (items, description) => ({ type: 'array', items, description });

const CONFIRM = bool('Must be true to actually perform the operation.');

export const TOOLS = [
  // ---------- Session ----------
  {
    name: 'fluig_ping',
    description: 'Check authentication and session against the configured Fluig server.',
    inputSchema: S(),
    write: false,
    run: async (client) => (await client.ping()) ? 'OK - authenticated.' : 'FAILED.',
  },

  // ---------- Datasets ----------
  {
    name: 'fluig_dataset_list',
    description: 'List datasets on the server (id + type). Optional substring filter over id and description.',
    inputSchema: S({ filter: str('Substring to filter by (optional).') }),
    write: false,
    run: async (client, { filter }) => {
      const all = await client.listDatasets();
      const f = (filter || '').toLowerCase();
      const datasets = all
        .filter((d) => !f || `${d.datasetId} ${d.datasetDescription || ''}`.toLowerCase().includes(f))
        .map((d) => ({ id: d.datasetId, type: d.type }));
      return { total: all.length, matched: datasets.length, datasets };
    },
  },
  {
    name: 'fluig_dataset_get',
    description: 'Return the source code of a CUSTOM dataset.',
    inputSchema: S({ datasetId: str('Id of the custom dataset.') }, ['datasetId']),
    write: false,
    run: async (client, { datasetId }) => {
      const ds = await client.getCustomDataset(datasetId);
      return ds.datasetImpl !== undefined ? ds.datasetImpl : ds;
    },
  },
  {
    name: 'fluig_dataset_run',
    description: 'Run a dataset (form-backed or custom) and return its rows.',
    inputSchema: S({
      name: str('Dataset name.'),
      fields: arr({ type: 'string' }, 'Columns to return (optional).'),
      limit: num('Maximum rows to show (optional).'),
    }, ['name']),
    write: false,
    run: async (client, { name, fields = [], limit = 0 }) => {
      const { columns, values } = await client.runDataset(name, { fields });
      return { columns, total: values.length, values: limit > 0 ? values.slice(0, limit) : values };
    },
  },
  {
    name: 'fluig_dataset_structure',
    description: 'Return a dataset\'s structure (columns and types) WITHOUT running it — useful to learn the schema before composing a query.',
    inputSchema: S({ datasetId: str('Dataset id.') }, ['datasetId']),
    write: false,
    run: async (client, { datasetId }) => client.getDatasetStructure(datasetId),
  },
  {
    name: 'fluig_dataset_save',
    description: 'Create or update a CUSTOM dataset. The code runs on the server under Rhino, so it must be ES5 (no let/const, arrow functions or template literals).',
    inputSchema: S({
      datasetId: str('Dataset id.'),
      code: str('JavaScript source (a createDataset function), ES5/Rhino.'),
      description: str('Description (optional).'),
    }, ['datasetId', 'code']),
    write: true,
    run: async (client, { datasetId, code, description }) => client.saveDataset(datasetId, code, description),
  },
  {
    name: 'fluig_dataset_delete',
    description: 'DESTRUCTIVE. Delete a CUSTOM dataset from the server. Also how this server cleans up its own throwaway datasets.',
    inputSchema: S({ datasetId: str('Dataset id to delete.'), confirm: CONFIRM }, ['datasetId', 'confirm']),
    write: true,
    run: async (client, { datasetId, confirm }) => {
      const result = await client.deleteDataset(datasetId, { confirm: !!confirm });
      return { datasetId, deleted: true, result };
    },
  },

  // ---------- Forms ----------
  {
    name: 'fluig_form_list',
    description: 'List forms (documentId, version, description, dataset). Optional substring filter.',
    inputSchema: S({ filter: str('Substring to filter by (optional).') }),
    write: false,
    run: async (client, { filter }) => {
      const forms = await client.listForms();
      const f = (filter || '').toLowerCase();
      return forms
        .filter((x) => !f || `${x.documentId} ${x.documentDescription || ''} ${x.datasetName || ''}`.toLowerCase().includes(f))
        .map((x) => ({
          documentId: x.documentId,
          version: x.version,
          description: x.documentDescription,
          dataset: x.datasetName,
        }));
    },
  },
  {
    name: 'fluig_form_events',
    description: 'Return a form\'s customisation events (displayFields, validateForm, enableFields, ...) with their source.',
    inputSchema: S({ documentId: num('Form documentId.') }, ['documentId']),
    write: false,
    run: async (client, { documentId }) => {
      const events = await client.getFormEvents(documentId);
      return events.map((e) => ({ eventId: e.eventId, code: e.eventDescription }));
    },
  },
  {
    name: 'fluig_form_files',
    description: 'List the file names (HTML/JS/CSS/images) that make up a form.',
    inputSchema: S({ documentId: num('Form documentId.') }, ['documentId']),
    write: false,
    run: async (client, { documentId }) => client.getFormFileNames(documentId),
  },
  {
    name: 'fluig_form_file',
    description: 'Return the text content of one file of a form.',
    inputSchema: S({
      documentId: num('Form documentId.'),
      version: num('Form version.'),
      fileName: str('File name.'),
    }, ['documentId', 'version', 'fileName']),
    write: false,
    run: async (client, { documentId, version, fileName }) => {
      const b64 = await client.getFormFileBase64(documentId, version, fileName);
      return b64 ? Buffer.from(b64, 'base64').toString('utf8') : '(empty)';
    },
  },
  {
    name: 'fluig_form_full',
    description: 'Read a whole form: metadata, every file and every event. Do this before editing or publishing.',
    inputSchema: S({ documentId: num('Form documentId.'), version: num('Form version.') }, ['documentId', 'version']),
    write: false,
    run: async (client, { documentId, version }) => {
      const f = await client.getFormFull(documentId, version);
      return {
        meta: {
          documentId,
          datasetName: f.meta.datasetName,
          description: f.meta.documentDescription,
        },
        files: f.files.map((x) => x.fileName),
        events: f.events.map((e) => e.eventId),
      };
    },
  },
  {
    name: 'fluig_form_save',
    description: 'Publish a form as a new (revertible) version. The API REPLACES the whole set, so send ALL files and events — read it with fluig_form_full first and change only what you need.',
    inputSchema: S({
      documentId: num('Form documentId.'),
      datasetName: str('Name of the form dataset.'),
      cardDescription: str('Form description.'),
      descriptionField: str('Descriptor field (may be empty).'),
      files: arr({ type: 'object' }, '[{fileName, content}] — ALL files.'),
      events: arr({ type: 'object' }, '[{eventId, eventDescription}] — ALL events.'),
      versionOption: str('0 = keep version, 2 = new version (default 2).'),
    }, ['documentId', 'datasetName', 'cardDescription', 'files']),
    write: true,
    run: async (client, { documentId, ...rest }) =>
      client.saveForm(documentId, { ...rest, versionOption: rest.versionOption || '2' }),
  },

  // ---------- Global events ----------
  {
    name: 'fluig_globalevent_list',
    description: 'List the server\'s global events.',
    inputSchema: S(),
    write: false,
    run: async (client) => {
      const events = await client.listGlobalEvents();
      return Array.isArray(events)
        ? events.map((e) => ({ eventId: e.globalEventPK?.eventId, code: e.eventDescription }))
        : events;
    },
  },
  {
    name: 'fluig_globalevent_save',
    description: 'Create or update a global event.',
    inputSchema: S({ eventId: str('Global event id.'), code: str('JavaScript source.') }, ['eventId', 'code']),
    write: true,
    run: async (client, { eventId, code }) => client.saveGlobalEvent(eventId, code),
  },

  // ---------- Database passthrough ----------
  {
    name: 'fluig_db_query',
    description: 'Run a SELECT against the Fluig database through a throwaway dataset. Read-only (SELECT/WITH only). Reaches any table, including event_proces, DEF_PROCES and the FDN_* metadata.',
    inputSchema: S({ sql: str('SELECT ... (SELECT/WITH only).') }, ['sql']),
    write: false,
    run: async (client, { sql }) => {
      const r = await client.dbQuery(sql);
      return { columns: r.columns, total: r.values.length, values: r.values.slice(0, MAX_ROWS) };
    },
  },
  {
    name: 'fluig_rm_db_query',
    description: 'Run a SELECT directly against the TOTVS RM database, when Fluig has a datasource for it. Read-only (SELECT/WITH only).',
    inputSchema: S({ sql: str('SELECT ... (SELECT/WITH only).') }, ['sql']),
    write: false,
    run: async (client, { sql }) => {
      const r = await client.rmDbQuery(sql);
      return { columns: r.columns, total: r.values.length, values: r.values.slice(0, MAX_ROWS) };
    },
  },
  {
    name: 'fluig_rm_query',
    description: 'Query TOTVS RM through the stored-SQL bridge dataset: a registered statement code plus branch (CODCOLIGADA) and application (CODAPLICACAO). Read-only. The columns the statement returns must be declared.',
    inputSchema: S({
      statementCode: str('RM statement code, e.g. "WS.247".'),
      fields: arr({ type: 'string' }, 'Columns the statement returns.'),
      branch: str('CODCOLIGADA (default "0").'),
      application: str('CODAPLICACAO (default "G").'),
      params: { type: 'object', description: 'Extra statement parameters as {NAME: value}.' },
    }, ['statementCode', 'fields']),
    write: false,
    run: async (client, { statementCode, fields, branch, application, params }) => {
      const r = await client.rmQuery(statementCode, fields, branch || '0', application || 'G', params || {});
      return { columns: r.columns, total: r.values.length, values: r.values.slice(0, MAX_ROWS) };
    },
  },
  {
    name: 'fluig_rm_db_exec',
    description: 'WRITE. Run INSERT/UPDATE/DELETE against the TOTVS RM database. Note that the RM datasource is often configured read-only, in which case the supported write path is the RM DataServer API instead.',
    inputSchema: S({ sql: str('INSERT/UPDATE/DELETE statement.'), confirm: CONFIRM }, ['sql', 'confirm']),
    write: true,
    run: async (client, { sql, confirm }) => {
      const r = await client.rmDbExec(sql, { confirm: !!confirm });
      return { columns: r.columns, values: r.values };
    },
  },

  // ---------- Process definitions: read ----------
  {
    name: 'fluig_process_export_xml',
    description: 'Download a process definition as .ecm30.xml. It contains everything: activities (ProcessState), transitions (ProcessLink), fields and the source of every process event.',
    inputSchema: S({
      processId: str('Process id.'),
      version: num('Specific version (optional; defaults to the current one).'),
    }, ['processId']),
    write: false,
    run: async (client, { processId, version }) => client.exportProcessXml(processId, version),
  },
  {
    name: 'fluig_process_events_xml',
    description: 'Read process events (beforeStateEntry, afterTaskCreate, afterProcessFinish, ...) with their source, straight from the definition XML. This is the authoritative copy — no add-on widget and no database access needed.',
    inputSchema: S({
      processId: str('Process id.'),
      version: num('Specific version (optional).'),
    }, ['processId']),
    write: false,
    run: async (client, { processId, version }) => {
      const events = await client.getProcessEventsFromXml(processId, version);
      return { processId, total: events.length, events };
    },
  },
  {
    name: 'fluig_process_versions',
    description: 'List the versions of a process (number, bound form, whether it is still in edition). Use before withdrawing or deleting a version.',
    inputSchema: S({ processId: str('Process id.') }, ['processId']),
    write: false,
    run: async (client, { processId }) => {
      const versions = await client.listProcessVersions(processId);
      return { processId, total: Array.isArray(versions) ? versions.length : undefined, versions };
    },
  },
  {
    name: 'fluig_process_version',
    description: 'Active version of a process (SOAP).',
    inputSchema: S({ processId: str('Process id.') }, ['processId']),
    write: false,
    run: async (client, { processId }) => client.getWorkflowVersionSoap(processId),
  },
  {
    name: 'fluig_process_formid',
    description: 'Return the documentId of the form bound to a process.',
    inputSchema: S({ processId: str('Process id.') }, ['processId']),
    write: false,
    run: async (client, { processId }) => client.getProcessFormId(processId),
  },
  {
    name: 'fluig_process_image',
    description: 'Return the flow diagram of a process (URL or base64, depending on the server).',
    inputSchema: S({ processId: str('Process id.') }, ['processId']),
    write: false,
    run: async (client, { processId }) => client.getProcessImage(processId),
  },
  {
    name: 'fluig_process_search',
    description: 'Search processes by text. Set favorite=true to return only the user\'s favourites.',
    inputSchema: S({ content: str('Search text.'), favorite: bool('Favourites only (optional).') }, ['content']),
    write: false,
    run: async (client, { content, favorite }) => client.searchProcess(content, !!favorite),
  },
  {
    name: 'fluig_process_available',
    description: 'List the processes the logged-in user is allowed to start.',
    inputSchema: S(),
    write: false,
    run: async (client) => client.getAvailableProcesses(),
  },
  {
    name: 'fluig_deploy_list',
    description: 'List the processes available for export/deploy (SOAP WorkflowEngineService). Useful to validate a deploy with a round trip.',
    inputSchema: S(),
    write: false,
    run: async (client) => client.listDeployableProcesses(),
  },
  {
    name: 'fluig_process_event_get',
    description: 'Read the source of a process event from the event_proces table. Legacy path — prefer fluig_process_events_xml, which reads the authoritative definition.',
    inputSchema: S({
      processCode: str('Fragment of COD_DEF_PROCES.'),
      eventName: str('Event name, e.g. "beforeTaskSave" or "servicetask71".'),
      version: num('NUM_VERS.'),
    }, ['processCode', 'eventName', 'version']),
    write: false,
    run: async (client, { processCode, eventName, version }) =>
      (await client.getProcessEventCode(processCode, eventName, version)) || '(not found)',
  },

  // ---------- Process definitions: write ----------
  {
    name: 'fluig_process_event_set_xml',
    description: 'WRITE. Set the source of a process event through the supported path: export the definition XML, patch the event, re-import. Produces a NEW, revertible version and passes server-side validation. Try dryRun=true first.',
    inputSchema: S({
      processId: str('Process id.'),
      eventId: str('Event name, e.g. "beforeStateEntry", "afterTaskCreate", "afterProcessFinish".'),
      code: str('COMPLETE source of the event (function name(...) { ... }).'),
      version: num('Source version to export (optional).'),
      release: bool('Publish the new version in the same call (default false).'),
      dryRun: bool('Validate the patch without sending anything.'),
      confirm: CONFIRM,
    }, ['processId', 'eventId', 'code']),
    write: true,
    run: async (client, { processId, eventId, code, version, release, dryRun, confirm }) =>
      client.setProcessEventViaXml(processId, eventId, code, {
        confirm: !!confirm, version, release: !!release, dryRun: !!dryRun,
      }),
  },
  {
    name: 'fluig_process_import_xml',
    description: 'WRITE, STRUCTURAL. Deploy a process definition (.ecm30.xml) over the v2 REST API. One call replaces the SOAP sequence createWorkFlowProcessVersion -> importProcess -> releaseProcess. Validate with a round trip (export, then import unchanged) before trusting it.',
    inputSchema: S({
      processId: str('Process id.'),
      xml: str('Contents of the .ecm30.xml (root <list><ProcessDefinition>).'),
      release: bool('Publish the version in the same call.'),
      isNew: bool('true creates a new process; false (default) adds a version to an existing one.'),
      formId: num('documentId of the form to bind (optional).'),
      confirm: CONFIRM,
    }, ['processId', 'xml']),
    write: true,
    run: async (client, { processId, xml, release, isNew, formId, confirm }) =>
      client.importProcessXml(processId, xml, {
        confirm: !!confirm, release: !!release, isNew: !!isNew, formId,
      }),
  },
  {
    name: 'fluig_deploy_process',
    description: 'WRITE, STRUCTURAL. Deploy a process definition over SOAP WorkflowEngineService (importProcess + releaseProcess). Alternative to fluig_process_import_xml for servers that do not expose the v2 REST route.',
    inputSchema: S({
      xmlPath: str('Path to a .ecm30.xml file (alternative to xml).'),
      xml: str('Inline .ecm30.xml content (alternative to xmlPath).'),
      processId: str('Process id (optional; taken from the XML when omitted).'),
      isNew: bool('true = new process; false (default) = new version of an existing one.'),
      overWrite: bool('Overwrite (default true).'),
      svgPath: str('Optional path to the .processimage.svg.'),
      confirm: CONFIRM,
    }, ['confirm']),
    write: true,
    run: async (client, { xmlPath, xml, processId, isNew = false, overWrite = true, svgPath, confirm }) => {
      const { readFileSync } = await import('node:fs');
      const processDefXml = xml || (xmlPath ? readFileSync(xmlPath, 'utf8') : null);
      if (!processDefXml) throw new Error('Pass either xml (inline) or xmlPath.');
      const svgXml = svgPath ? readFileSync(svgPath, 'utf8') : undefined;
      return client.deployProcess(processDefXml, { processId, isNew, overWrite, svgXml, confirm: !!confirm });
    },
  },
  {
    name: 'fluig_process_version_withdraw',
    description: 'WRITE. Withdraw a process version — the inverse of release, and how a bad deploy is rolled back. Also mandatory before deleting a released version.',
    inputSchema: S({
      processId: str('Process id.'),
      version: num('Version (optional; omitted means latest).'),
      confirm: CONFIRM,
    }, ['processId']),
    write: true,
    run: async (client, { processId, version, confirm }) =>
      client.withdrawProcessVersion(processId, version, { confirm: !!confirm }),
  },
  {
    name: 'fluig_process_version_delete',
    description: 'DESTRUCTIVE. Delete a process version (withdraw it first if released). Deleting the LAST version removes the entire process definition.',
    inputSchema: S({
      processId: str('Process id.'),
      version: num('Version (optional; omitted means latest).'),
      confirm: CONFIRM,
    }, ['processId']),
    write: true,
    run: async (client, { processId, version, confirm }) =>
      client.deleteProcessVersion(processId, version, { confirm: !!confirm }),
  },
  {
    name: 'fluig_process_diagram_set',
    description: 'WRITE. Replace the SVG diagram of a process version. Required after changing the topology in the XML, otherwise the published drawing no longer matches the flow.',
    inputSchema: S({
      processId: str('Process id.'),
      processVersion: num('Process version.'),
      svg: str('SVG content of the diagram.'),
      confirm: CONFIRM,
    }, ['processId', 'processVersion', 'svg']),
    write: true,
    run: async (client, { processId, processVersion, svg, confirm }) =>
      client.setProcessDiagram(processId, processVersion, svg, { confirm: !!confirm }),
  },
  {
    name: 'fluig_process_event_set',
    description: 'DEPRECATED, WRITE. Patch a process event in place in the event_proces table, keeping a backup of the previous source. Bypasses server-side validation and does not create a new version — prefer fluig_process_event_set_xml.',
    inputSchema: S({
      processCode: str('COD_DEF_PROCES.'),
      eventName: str('Event name.'),
      version: num('NUM_VERS.'),
      code: str('New source.'),
      confirm: CONFIRM,
    }, ['processCode', 'eventName', 'version', 'code', 'confirm']),
    write: true,
    run: async (client, { processCode, eventName, version, code, confirm }) =>
      client.setProcessEvent(processCode, eventName, version, code, { confirm: !!confirm }),
  },

  // ---------- Process instances: read ----------
  {
    name: 'fluig_process_states',
    description: 'List the valid target states (choosedState) from an instance\'s current state.',
    inputSchema: S({
      processId: str('Process id.'),
      processInstanceId: num('Instance number.'),
    }, ['processId', 'processInstanceId']),
    write: false,
    run: async (client, { processId, processInstanceId }) =>
      client.getAvailableStates(processId, processInstanceId),
  },
  {
    name: 'fluig_process_states_detail',
    description: 'Target states with name and type from the current state — richer than fluig_process_states.',
    inputSchema: S({
      processId: str('Process id.'),
      processInstanceId: num('Instance number.'),
      threadSequence: num('threadSequence (optional, default 0).'),
    }, ['processId', 'processInstanceId']),
    write: false,
    run: async (client, { processId, processInstanceId, threadSequence }) =>
      client.getAvailableStatesDetail(processId, processInstanceId, threadSequence || 0),
  },
  {
    name: 'fluig_process_active_states',
    description: 'List the states an instance currently sits on.',
    inputSchema: S({ processInstanceId: num('Instance number.') }, ['processInstanceId']),
    write: false,
    run: async (client, { processInstanceId }) => client.getActiveStates(processInstanceId),
  },
  {
    name: 'fluig_process_actual_thread',
    description: 'Return the current thread of a given state sequence of an instance.',
    inputSchema: S({
      processInstanceId: num('Instance number.'),
      stateSequence: num('State sequence.'),
    }, ['processInstanceId', 'stateSequence']),
    write: false,
    run: async (client, { processInstanceId, stateSequence }) =>
      client.getActualThread(processInstanceId, stateSequence),
  },
  {
    name: 'fluig_process_card_get',
    description: 'Read the WHOLE card of a running instance as {field: value}. Do this before fluig_process_move, because moving REPLACES the card.',
    inputSchema: S({ processInstanceId: num('Instance number.') }, ['processInstanceId']),
    write: false,
    run: async (client, { processInstanceId }) => client.getInstanceCardData(processInstanceId),
  },
  {
    name: 'fluig_process_card_value',
    description: 'Read a single card field of a running instance.',
    inputSchema: S({
      processInstanceId: num('Instance number.'),
      cardFieldName: str('Form field name.'),
    }, ['processInstanceId', 'cardFieldName']),
    write: false,
    run: async (client, { processInstanceId, cardFieldName }) =>
      client.getCardValue(processInstanceId, cardFieldName),
  },
  {
    name: 'fluig_process_history',
    description: 'Full movement history of an instance: who moved it, when, from and to which activity, with comments.',
    inputSchema: S({ processInstanceId: num('Instance number.') }, ['processInstanceId']),
    write: false,
    run: async (client, { processInstanceId }) => client.getProcessHistories(processInstanceId),
  },
  {
    name: 'fluig_process_attachments',
    description: 'List the attachments of an instance.',
    inputSchema: S({ processInstanceId: num('Instance number.') }, ['processInstanceId']),
    write: false,
    run: async (client, { processInstanceId }) => client.getProcessAttachments(processInstanceId),
  },
  {
    name: 'fluig_process_available_users',
    description: 'Users eligible to receive the task at a given state of a running instance.',
    inputSchema: S({
      processInstanceId: num('Instance number.'),
      state: num('State number.'),
      threadSequence: num('threadSequence (optional, default 0).'),
    }, ['processInstanceId', 'state']),
    write: false,
    run: async (client, { processInstanceId, state, threadSequence }) =>
      client.getAvailableUsers(processInstanceId, state, threadSequence || 0),
  },
  {
    name: 'fluig_process_available_users_start',
    description: 'Users eligible to receive the first task when starting a process.',
    inputSchema: S({
      processId: str('Process id.'),
      state: num('Initial state number.'),
      threadSequence: num('threadSequence (optional, default 0).'),
    }, ['processId', 'state']),
    write: false,
    run: async (client, { processId, state, threadSequence }) =>
      client.getAvailableUsersStart(processId, state, threadSequence || 0),
  },
  {
    name: 'fluig_user_replacements',
    description: 'List configured user replacements — who answers for whom, and for how long. Explains why a task landed on someone else.',
    inputSchema: S({ limit: num('Maximum records (optional).') }),
    write: false,
    run: async (client, { limit }) => {
      const replacements = await client.getUserReplacements({ limit });
      return { total: Array.isArray(replacements) ? replacements.length : undefined, replacements };
    },
  },

  // ---------- Process instances: write ----------
  {
    name: 'fluig_process_start',
    description: 'WRITE. Start a process instance. cardData holds the form fields; choosedState is the target state when the start activity completes. The configured user needs the start role.',
    inputSchema: S({
      processId: str('Process id.'),
      choosedState: num('Target state (number of the next node or gateway).'),
      cardData: { type: 'object', description: '{field: value} — send ALL fields; the API replaces the card, it does not merge.' },
      colleagueIds: arr({ type: 'string' }, 'Next assignees (optional).'),
      comments: str('Comment (optional).'),
      completeTask: bool('true (default) completes and moves; false parks on the start activity.'),
    }, ['processId', 'choosedState']),
    write: true,
    run: async (client, { processId, choosedState, cardData, colleagueIds, comments, completeTask }) =>
      client.startProcess(processId, {
        choosedState,
        cardData: cardData || {},
        colleagueIds: colleagueIds || [],
        comments: comments || '',
        completeTask: completeTask !== false,
      }),
  },
  {
    name: 'fluig_process_move',
    description: 'WRITE. Save and move an existing instance. cardData REPLACES the card — send every field that must survive or it is wiped. Call fluig_process_take first if the task belongs to a pool.',
    inputSchema: S({
      processInstanceId: num('Instance number.'),
      choosedState: num('Target state (number of the next node or gateway).'),
      cardData: { type: 'object', description: '{field: value} — ALL fields (replaces the card).' },
      colleagueIds: arr({ type: 'string' }, 'Next assignees (optional).'),
      comments: str('Comment (optional).'),
      managerMode: bool('Move as process manager (requires the manager role).'),
    }, ['processInstanceId', 'choosedState']),
    write: true,
    run: async (client, { processInstanceId, choosedState, cardData, colleagueIds, comments, managerMode }) =>
      client.saveAndSendTask(processInstanceId, {
        choosedState,
        cardData: cardData || {},
        colleagueIds: colleagueIds || [],
        comments: comments || '',
        managerMode: !!managerMode,
      }),
  },
  {
    name: 'fluig_process_take',
    description: 'WRITE. Take ownership of a task — required for pool/role tasks before moving them.',
    inputSchema: S({ processInstanceId: num('Instance number.') }, ['processInstanceId']),
    write: true,
    run: async (client, { processInstanceId }) => client.takeProcessTask(processInstanceId),
  },
  {
    name: 'fluig_process_cancel',
    description: 'WRITE. Cancel/close a running instance.',
    inputSchema: S({
      processInstanceId: num('Instance number.'),
      cancelText: str('Reason for cancelling.'),
      confirm: CONFIRM,
    }, ['processInstanceId', 'cancelText', 'confirm']),
    write: true,
    run: async (client, { processInstanceId, cancelText, confirm }) =>
      client.cancelProcessInstance(processInstanceId, cancelText || '', { confirm: !!confirm }),
  },

  // ---------- Optional FluiggersWidget add-on ----------
  {
    name: 'fluig_workflow_check',
    description: 'Check whether the optional FluiggersWidget add-on is installed. Not required: the fluig_process_*_xml tools cover process events on a stock server.',
    inputSchema: S(),
    write: false,
    run: async (client) => (await client.hasFluiggersWidget())
      ? 'FluiggersWidget INSTALLED - the fluig_workflow_events_* tools are available.'
      : 'FluiggersWidget NOT installed - use fluig_process_events_xml / fluig_process_event_set_xml instead.',
  },
  {
    name: 'fluig_workflow_events_get',
    description: 'Read a process\'s events through the FluiggersWidget add-on. Requires the widget; fluig_process_events_xml does not.',
    inputSchema: S({ processId: str('Process id.'), version: num('Process version.') }, ['processId', 'version']),
    write: false,
    run: async (client, { processId, version }) => client.getWorkflowEvents(processId, version),
  },
  {
    name: 'fluig_workflow_events_update',
    description: 'WRITE. Set a process\'s events through the FluiggersWidget add-on. Requires the widget; fluig_process_event_set_xml does not and is versioned.',
    inputSchema: S({
      processId: str('Process id.'),
      version: num('Process version.'),
      events: arr({ type: 'object' }, '[{name, contents}]'),
    }, ['processId', 'version', 'events']),
    write: true,
    run: async (client, { processId, version, events }) =>
      client.updateWorkflowEvents(processId, version, events),
  },

  // ---------- Escape hatches ----------
  {
    name: 'fluig_rest_get',
    description: 'Escape hatch: authenticated GET against any path of the Fluig API.',
    inputSchema: S({ path: str('Path, e.g. /ecm/api/rest/ecm/dataset/loadDataset?datasetId=x') }, ['path']),
    write: false,
    run: async (client, { path }) => client.restGet(path),
  },
  {
    name: 'fluig_rest_post',
    description: 'Escape hatch: authenticated POST against any path. body is a JSON string; set form=true for x-www-form-urlencoded.',
    inputSchema: S({
      path: str('Path.'),
      body: str('Body (JSON string).'),
      form: bool('Send as x-www-form-urlencoded.'),
    }, ['path']),
    write: true,
    run: async (client, { path, body, form }) => client.restPost(path, body, !!form),
  },
];

/**
 * Tools to expose for a given configuration.
 * @param {{readOnly?: boolean}} [options]
 */
export function selectTools({ readOnly = false } = {}) {
  return readOnly ? TOOLS.filter((t) => !t.write) : TOOLS;
}

/** The MCP-visible shape of a tool: metadata only, no handler. */
export function toolManifest(tool) {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}
