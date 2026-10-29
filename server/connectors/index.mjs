import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { CONNECTORS, POSTGRES } from './definitions.mjs';
import { request, ConnectorError } from './http.mjs';

const OAUTH = {
  google: { authorize: () => 'https://accounts.google.com/o/oauth2/v2/auth', token: () => 'https://oauth2.googleapis.com/token',
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly', extra: { access_type: 'offline', prompt: 'consent' } },
  microsoft: { authorize: f => `https://login.microsoftonline.com/${encodeURIComponent(f.tenant || 'common')}/oauth2/v2.0/authorize`, token: f => `https://login.microsoftonline.com/${encodeURIComponent(f.tenant || 'common')}/oauth2/v2.0/token`,
    scope: 'offline_access User.Read Mail.ReadWrite Calendars.Read Files.Read', extra: {} }
};

/** Read-only SQL: one SELECT/WITH/EXPLAIN statement inside a read-only transaction with a timeout. */
async function postgresQuery(url, sql, signal) {
  if (!/^\s*(select|with|explain)\b/i.test(sql) || /;\s*\S/.test(sql)) throw new ConnectorError('Only a single read-only SELECT, WITH or EXPLAIN statement is allowed');
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, statement_timeout: 15000, connectionTimeoutMillis: 10000 });
  const abort = () => client.end().catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query({ text: sql.replace(/;\s*$/, ''), rowMode: 'array' });
    return { columns: result.fields.map(f => f.name), rows: result.rows.slice(0, 200), rowCount: result.rowCount, truncated: result.rows.length > 200 };
  } finally { await client.query('ROLLBACK').catch(() => {}); signal?.removeEventListener('abort', abort); await client.end().catch(() => {}); }
}

const ALL = [...CONNECTORS, { ...POSTGRES, test: c => c.call('postgres_query', { sql: 'select 1 as ok' }), tools: [
  { name: 'postgres_tables', description: 'List tables and their columns in the connected Postgres database.', schema: z.object({ schema: z.string().regex(/^\w+$/).default('public') }),
    run: async ({ schema }, c) => postgresQuery(c.get('url'), `select table_name, string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position) as columns from information_schema.columns where table_schema = '${schema}' group by table_name order by table_name`, c.opts.signal) },
  { name: 'postgres_query', description: 'Run one read-only SQL query (SELECT/WITH) and return up to 200 rows.', schema: z.object({ sql: z.string().trim().min(1).max(5000) }),
    run: async ({ sql }, c) => postgresQuery(c.get('url'), sql, c.opts.signal) }
] }];

/**
 * Built-in connectors: credentials are sealed with Secrets and never leave the
 * server. Read tools run directly; write tools need the user's approval.
 * Offline mode removes every connector tool.
 */
export class Connectors {
  constructor(store, secrets, { fetchImpl, origin = () => '' } = {}) { this.store = store; this.secrets = secrets; this.fetchImpl = fetchImpl; this.origin = origin; this.oauthStates = new Map(); this.cache = new Map(); }
  definitions() { return ALL; }
  record(id) { return this.store.list('connector').find(r => r.connectorId === id); }
  info() {
    return ALL.map(def => {
      const rec = this.record(def.id);
      return { id: def.id, name: def.name, group: def.group, description: def.description, oauth: def.oauth || null, keyless: !def.fields.length,
        fields: def.fields.map(f => ({ ...f, set: Boolean(rec?.secretKeys?.includes(f.key) || rec?.fields?.[f.key]), value: f.secret ? undefined : rec?.fields?.[f.key] || '' })),
        enabled: Boolean(rec?.enabled), authorized: def.oauth ? Boolean(rec?.authorized) : true, lastTest: rec?.lastTest || null,
        tools: def.tools.map(t => ({ name: t.name, description: t.description, write: Boolean(t.write) })) };
    });
  }
  async save(id, values, enabled = true) {
    const def = ALL.find(d => d.id === id);
    if (!def) throw new Error('Unknown connector');
    const rec = this.record(id) || {}, secret = rec.sealed ? await this.secrets.open(rec.sealed) : {}, fields = { ...(rec.fields || {}) };
    for (const field of def.fields) {
      const value = values?.[field.key];
      if (value === undefined || value === '') continue;
      if (typeof value !== 'string' || value.length > 4000) throw new Error(`${field.label} is invalid`);
      if (field.secret) secret[field.key] = value.trim(); else fields[field.key] = value.trim();
    }
    const missing = def.fields.filter(f => !f.placeholder && !fields[f.key] && !secret[f.key] && !(def.oauth && f.key === 'tenant'));
    if (enabled && missing.length) throw new Error(`Missing: ${missing.map(f => f.label).join(', ')}`);
    this.cache.delete(id);
    this.store.put('connector', { ...rec, connectorId: id, enabled, fields, secretKeys: Object.keys(secret), sealed: await this.secrets.seal(secret) });
    this.store.log('connector.saved', { id, enabled, fields: Object.keys(fields), secrets: Object.keys(secret).length });
  }
  remove(id) { const rec = this.record(id); if (rec) { this.store.remove('connector', rec.id); this.cache.delete(id); this.store.log('connector.removed', { id }); } }
  async values(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    const rec = this.record(id), values = { ...(rec?.fields || {}), ...(rec?.sealed ? await this.secrets.open(rec.sealed) : {}) };
    this.cache.set(id, values); return values;
  }
  async client(def, signal) {
    const values = await this.values(def.id);
    const client = {
      opts: { signal, fetchImpl: this.fetchImpl },
      get: key => { const v = values[key]; if (!v && def.fields.find(f => f.key === key && !f.placeholder)) throw new ConnectorError(`${def.name} is missing ${key}`); return v; },
      token: () => { if (!values.oauth?.access_token) throw new ConnectorError(`Sign in to ${def.name} in Settings → Connectors`); return values.oauth.access_token; },
      call: async (name, args) => { const tool = def.tools.find(t => t.name === name); return tool.run(tool.schema.parse(args), client); },
      gql: (query, variables) => def.gql(client, query, variables)
    };
    if (def.oauth && values.oauth?.refresh_token && Date.now() > (values.oauth.expires_at || 0) - 60000) await this.refresh(def, values, signal);
    return client;
  }
  async test(id, signal) {
    const def = ALL.find(d => d.id === id), started = Date.now();
    let lastTest;
    try { const sample = await def.test(await this.client(def, signal)); lastTest = { ok: true, at: new Date().toISOString(), ms: Date.now() - started, sample: JSON.stringify(sample).slice(0, 300) }; }
    catch (e) { lastTest = { ok: false, at: new Date().toISOString(), error: String(e.message).slice(0, 300) }; }
    const rec = this.record(id); if (rec) this.store.put('connector', { ...rec, lastTest });
    this.store.log('connector.tested', { id, ok: lastTest.ok });
    return lastTest;
  }

  /** Tool specs for the Brain. Each connector's tools are deferred behind tool search to keep prompts small. */
  tools() {
    const out = [];
    for (const def of ALL) {
      const rec = this.record(def.id);
      if (!rec?.enabled || (def.oauth && !rec.authorized)) continue;
      for (const tool of def.tools) out.push({ name: tool.name, description: `[${def.name}] ${tool.description}`, schema: tool.schema, source: 'connector', connector: def.id, connectorName: def.name, approval: Boolean(tool.write), write: Boolean(tool.write),
        run: async (args, { signal }) => tool.run(args, await this.client(def, signal)) });
    }
    return out;
  }

  // OAuth 2.0 authorization code flow with PKCE and a loopback redirect.
  async oauthStart(id) {
    const def = ALL.find(d => d.id === id && d.oauth), values = await this.values(id), provider = OAUTH[def?.oauth];
    if (!def || !values.clientId) throw new Error('Save the OAuth client ID first');
    const state = randomBytes(16).toString('hex'), verifier = randomBytes(32).toString('base64url');
    this.oauthStates.set(state, { id, verifier, expires: Date.now() + 600000 });
    const u = new URL(provider.authorize(values));
    for (const [k, v] of Object.entries({ client_id: values.clientId, redirect_uri: `${this.origin()}/oauth/callback`, response_type: 'code', scope: provider.scope, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...provider.extra })) u.searchParams.set(k, v);
    return { url: u.href };
  }
  async oauthCallback(params) {
    const pending = this.oauthStates.get(params.get('state') || '');
    this.oauthStates.delete(params.get('state') || '');
    if (!pending || pending.expires < Date.now()) throw new Error('This sign-in link expired. Start again from Settings.');
    if (params.get('error')) throw new Error(`Sign-in was not completed: ${params.get('error')}`);
    const def = ALL.find(d => d.id === pending.id), values = await this.values(def.id), provider = OAUTH[def.oauth];
    const token = await request('POST', provider.token(values), { fetchImpl: this.fetchImpl, form: { grant_type: 'authorization_code', code: params.get('code'), redirect_uri: `${this.origin()}/oauth/callback`, client_id: values.clientId, code_verifier: pending.verifier, ...(values.clientSecret ? { client_secret: values.clientSecret } : {}) } });
    await this.storeToken(def, values, token);
    return def.name;
  }
  async refresh(def, values, signal) {
    const token = await request('POST', OAUTH[def.oauth].token(values), { signal, fetchImpl: this.fetchImpl, form: { grant_type: 'refresh_token', refresh_token: values.oauth.refresh_token, client_id: values.clientId, ...(values.clientSecret ? { client_secret: values.clientSecret } : {}) } });
    await this.storeToken(def, values, { refresh_token: values.oauth.refresh_token, ...token });
  }
  async storeToken(def, values, token) {
    const rec = this.record(def.id), secret = rec?.sealed ? await this.secrets.open(rec.sealed) : {};
    secret.oauth = { access_token: token.access_token, refresh_token: token.refresh_token, expires_at: Date.now() + (token.expires_in || 3600) * 1000 };
    this.cache.delete(def.id);
    this.store.put('connector', { ...rec, authorized: true, secretKeys: Object.keys(secret).filter(k => k !== 'oauth'), sealed: await this.secrets.seal(secret) });
    this.store.log('connector.authorized', { id: def.id });
  }
}
