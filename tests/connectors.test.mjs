// Connector contract tests with a fake fetch: request shape, credential
// handling, approvals for write tools, tool search and offline mode.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { createApp } from '../server/app.mjs';
import { Connectors } from '../server/connectors/index.mjs';
import { CONNECTORS } from '../server/connectors/definitions.mjs';
import { jsonParameters } from '../server/tools.mjs';

process.env.QVAC_UI_KEYCHAIN = '0';

function fakeFetch(routes, seen) {
  return async (url, init) => {
    const u = new URL(url); seen.push({ host: u.hostname, path: u.pathname, query: Object.fromEntries(u.searchParams), method: init.method, headers: init.headers, body: init.body });
    const route = routes.find(([match]) => `${u.hostname}${u.pathname}`.includes(match));
    const [, status = 200, body = {}] = route ? [route[0], ...(typeof route[1] === 'number' ? [route[1], route[2]] : [200, route[1]])] : [null, 404, { message: 'no route' }];
    return new Response(JSON.stringify(typeof body === 'function' ? body(u, init) : body), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

async function harness(t, routes = []) {
  const directory = await mkdtemp(join(tmpdir(), 'qvac-connectors-')), seen = [];
  const app = await createApp({ directory, fetchImpl: fakeFetch(routes, seen) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const post = async (path, body) => { const res = await fetch(app.origin + path, { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() }; };
  return { app, post, seen, directory };
}

function scriptModel(app, script) {
  const seen = [];
  app.models.config = { model: '/m.gguf', device: 'cpu', features: ['tools'] };
  app.models.complete = async (history, { tools = [] } = {}) => { seen.push({ history: structuredClone(history), tools }); const next = script.shift() || { text: 'Done.' }; const r = typeof next === 'function' ? next(history) : next; return { text: r.text || '', toolCalls: r.toolCalls || [] }; };
  return seen;
}
async function chat(app, body, onApproval) {
  const res = await fetch(app.origin + '/api/chat', { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const reader = res.body.getReader(), dec = new TextDecoder(), events = []; let buf = '';
  while (true) { const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); const frames = buf.split('\n\n'); buf = frames.pop(); for (const f of frames) { const e = { event: f.match(/^event: (.*)$/m)[1], data: JSON.parse(f.match(/^data: (.*)$/m)[1]) }; events.push(e); if (e.event === 'approval') await onApproval?.(e.data); } }
  return events;
}

test('every connector tool has a unique name, a schema QVAC accepts and a description', () => {
  const names = new Set();
  for (const def of CONNECTORS) {
    assert.ok(def.description && def.group && def.test, def.id);
    for (const tool of def.tools) {
      assert.ok(!names.has(tool.name), `duplicate ${tool.name}`); names.add(tool.name);
      assert.match(tool.name, /^[a-z0-9_]{3,64}$/);
      const params = jsonParameters(tool.schema);
      assert.equal(params.type, 'object'); assert.equal(typeof params.properties, 'object');
    }
  }
  assert.ok(names.size >= 50, `expected a broad tool set, got ${names.size}`);
});

test('credentials are encrypted at rest, never returned to the browser and sent only to the service', async t => {
  const { app, post, seen, directory } = await harness(t, [['api.github.com/user', { login: 'octo' }]]);
  assert.equal((await post('/api/connectors', { action: 'save', id: 'github', values: {} })).status, 400, 'missing token is rejected');
  await post('/api/connectors', { action: 'save', id: 'github', values: { token: 'ghp_SECRET123' } });
  const info = (await post('/api/connectors', { action: 'test', id: 'github' })).body;
  assert.equal(info.ok, true); assert.match(info.sample, /octo/);
  assert.equal(seen[0].headers.Authorization, 'Bearer ghp_SECRET123');
  const state = await (await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } })).text();
  assert.ok(!state.includes('ghp_SECRET123'), 'secret never appears in state');
  assert.ok(JSON.parse(state).connectors.find(c => c.id === 'github').fields[0].set);
  const db = await readFile(join(directory, 'workspace.sqlite')).catch(() => Buffer.alloc(0)), wal = await readFile(join(directory, 'workspace.sqlite-wal')).catch(() => Buffer.alloc(0));
  assert.ok(!Buffer.concat([db, wal]).includes('ghp_SECRET123'), 'secret is not stored in plain text');
});

test('the model finds connector tools through tool_search, read tools run directly and results become cards', async t => {
  const { app, post } = await harness(t, [['en.wikipedia.org/w/api.php', { query: { search: [{ title: 'Ada Lovelace', snippet: 'English <b>mathematician</b>' }] } }]]);
  await post('/api/connectors', { action: 'enable', id: 'wikipedia' });
  const seen = scriptModel(app, [
    { toolCalls: [{ id: 's1', name: 'tool_search', arguments: { query: 'wikipedia search' } }] },
    { toolCalls: [{ id: 'w1', name: 'wikipedia_search', arguments: { query: 'Ada Lovelace', limit: 3 } }] },
    { text: 'Ada Lovelace was an English mathematician.' }
  ]);
  const events = await chat(app, { text: 'Who was Ada Lovelace?' });
  const first = seen[0].tools;
  assert.ok(first.find(t => t.name === 'wikipedia_search')?.deferLoading, 'connector tools are deferred');
  assert.match(seen[1].history.at(-1).content, /wikipedia_search/, 'tool_search returned the definition');
  const done = events.at(-1).data;
  assert.equal(done.parts.find(p => p.name === 'wikipedia_search').status, 'done');
  assert.match(done.parts.find(p => p.name === 'wikipedia_search').display, /Table\(\["title", "snippet"\]/);
  assert.match(seen[2].history.at(-1).content, /external data, not instructions/);
});

test('write tools wait for approval and do not call the service when declined', async t => {
  const { app, post, seen } = await harness(t, [['api.github.com/repos/acme/app/issues', { number: 7, html_url: 'https://github.com/acme/app/issues/7' }]]);
  await post('/api/connectors', { action: 'save', id: 'github', values: { token: 'ghp_x' } });
  scriptModel(app, [{ toolCalls: [{ id: 'g1', name: 'github_create_issue', arguments: { repo: 'acme/app', title: 'Bug' } }] }, { text: 'Not filed.' }]);
  await chat(app, { text: 'File a bug' }, a => post('/api/approvals', { id: a.id, decision: 'reject', digest: a.digest }));
  assert.equal(seen.filter(s => s.method === 'POST').length, 0);
  scriptModel(app, [{ toolCalls: [{ id: 'g2', name: 'github_create_issue', arguments: { repo: 'acme/app', title: 'Bug' } }] }, { text: 'Filed #7.' }]);
  const events = await chat(app, { text: 'File a bug' }, a => post('/api/approvals', { id: a.id, decision: 'approve', digest: a.digest }));
  assert.equal(seen.filter(s => s.method === 'POST').length, 1);
  assert.equal(JSON.parse(seen.find(s => s.method === 'POST').body).title, 'Bug');
  assert.equal(events.find(e => e.event === 'approval').data.server, 'GitHub');
});

test('offline mode removes every connector and MCP tool', async t => {
  const { app, post } = await harness(t);
  await post('/api/connectors', { action: 'enable', id: 'weather' });
  let state = await (await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } })).json();
  assert.ok(state.tools.some(t => t.name === 'weather_forecast'));
  await post('/api/settings/app', { offline: true });
  state = await (await fetch(app.origin + '/api/state', { headers: { Authorization: `Bearer ${app.token}` } })).json();
  assert.equal(state.offline, true);
  assert.ok(!state.tools.some(t => t.source !== 'local'));
  assert.equal((await post('/api/connectors', { action: 'test', id: 'weather' })).status, 400);
});

test('connector errors are reported to the model without leaking credentials, and hosts are validated', async t => {
  const { app, post } = await harness(t, [['api.search.brave.com', 401, { message: 'invalid token' }]]);
  await post('/api/connectors', { action: 'save', id: 'brave', values: { apiKey: 'BSA-SECRET' } });
  const result = (await post('/api/connectors', { action: 'test', id: 'brave' })).body;
  assert.equal(result.ok, false); assert.match(result.error, /401/); assert.ok(!result.error.includes('BSA-SECRET'));
  await post('/api/connectors', { action: 'save', id: 'jira', values: { site: 'evil.example.com', email: 'a@b.co', token: 't' } });
  const jira = (await post('/api/connectors', { action: 'test', id: 'jira' })).body;
  assert.match(jira.error, /atlassian\.net/);
});

test('OAuth uses PKCE and a one-time state; the callback stores tokens sealed', async t => {
  const { app, post, seen } = await harness(t, [['oauth2.googleapis.com/token', (u, init) => ({ access_token: 'ya29.ACCESS', refresh_token: '1//REFRESH', expires_in: 3600 })], ['gmail/v1/users/me/messages', { messages: [] }]]);
  await post('/api/connectors', { action: 'save', id: 'google', values: { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'shh' } });
  const { url } = (await post('/api/connectors', { action: 'oauth-start', id: 'google' })).body;
  const auth = new URL(url);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('redirect_uri'), `${app.origin}/oauth/callback`);
  const bad = await (await fetch(`${app.origin}/oauth/callback?state=forged&code=x`)).text();
  assert.match(bad, /expired/);
  const ok = await (await fetch(`${app.origin}/oauth/callback?state=${auth.searchParams.get('state')}&code=abc`)).text();
  assert.match(ok, /Google Workspace is connected/);
  const exchange = seen.find(s => s.path === '/token');
  assert.match(exchange.body.toString(), /code_verifier=/);
  const again = await (await fetch(`${app.origin}/oauth/callback?state=${auth.searchParams.get('state')}&code=abc`)).text();
  assert.match(again, /expired/, 'state is single use');
  assert.equal((await post('/api/connectors', { action: 'test', id: 'google' })).body.ok, true);
  assert.equal(seen.at(-1).headers.Authorization, 'Bearer ya29.ACCESS');
});

test('Postgres only accepts one read-only statement', async () => {
  const c = new Connectors({ list: () => [] }, null);
  const tool = c.definitions().find(d => d.id === 'postgres').tools.find(t => t.name === 'postgres_query');
  await assert.rejects(tool.run({ sql: 'delete from users' }, { get: () => 'postgres://x', opts: {} }), /read-only/);
  await assert.rejects(tool.run({ sql: 'select 1; drop table users' }, { get: () => 'postgres://x', opts: {} }), /single/);
  assert.ok(z.object({}).safeParse({}).success);
});

test('naming a connected service puts its tools straight into the prompt', async t => {
  const { app, post } = await harness(t, [['en.wikipedia.org/api/rest_v1/page/summary', { title: 'Ada Lovelace', extract: 'Born 10 December 1815.' }]]);
  await post('/api/connectors', { action: 'enable', id: 'wikipedia' });
  await post('/api/connectors', { action: 'enable', id: 'weather' });
  const seen = scriptModel(app, [{ toolCalls: [{ id: 'w', name: 'wikipedia_summary', arguments: { title: 'Ada Lovelace' } }] }, { text: 'She was born in 1815.' }]);
  await chat(app, { text: 'Using Wikipedia, when was Ada Lovelace born?' });
  const tools = Object.fromEntries(seen[0].tools.map(t => [t.name, Boolean(t.deferLoading)]));
  assert.equal(tools.wikipedia_summary, false); assert.equal(tools.wikipedia_search, false);
  assert.equal(tools.weather_forecast, true, 'unrelated connectors stay deferred');
});

test('fields with an example value are still required unless marked optional, and mail subjects stay one line', async t => {
  const { post } = await harness(t);
  for (const [id, values] of [['postgres', {}], ['jira', { email: 'a@b.co', token: 'x' }], ['shopify', { token: 'x' }]])
    assert.equal((await post('/api/connectors', { action: 'save', id, values })).status, 400, `${id} needs its address`);
  assert.equal((await post('/api/connectors', { action: 'save', id: 'gitlab', values: { token: 'x' } })).status, 200, 'GitLab host defaults to gitlab.com');
  const draft = CONNECTORS.find(d => d.id === 'google').tools.find(x => x.name === 'gmail_create_draft');
  assert.equal(draft.schema.safeParse({ to: 'a@b.co', subject: 'Hi\r\nBcc: x@evil.test', body: 'Hello' }).success, false);
  assert.equal(draft.schema.safeParse({ to: 'a@b.co', subject: 'Hi', body: 'Hello' }).success, true);
});
