import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Store } from './store.mjs';
import { Models } from './models.mjs';
import { Capabilities } from './capabilities.mjs';
import { Attachments } from './attachments.mjs';
import { Approvals } from './approvals.mjs';
import { McpHub } from './mcp.mjs';
import { ToolRegistry } from './tools.mjs';
import { Secrets } from './secrets.mjs';
import { Connectors } from './connectors/index.mjs';
import { Skills } from './skills.mjs';
import { Studio } from './studio.mjs';
import { AGENTS, Brain, COMMANDS } from './brain.mjs';
import { CATALOG, TRANSLATION_LANGUAGES, catalogStatus, downloadEntry, entryPaths, translationEntry } from './catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
async function body(req, limit = 1_200_000) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request exceeds size limit'); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
// Synthetic or public research fixtures that ship with the app, attachable in one click.
const SAMPLES = { 'team-meeting.wav': 'team-meeting.wav', 'remote-work-policy.pdf': 'remote-work-policy.pdf', 'vendor-onboarding.docx': 'vendor-onboarding.docx', 'meeting-recording.wav': 'meeting-recording.wav', 'voice-question.wav': 'voice-question.wav', 'invoice.png': 'invoice.png', 'business-sales.csv': 'business-sales.csv', 'meeting-notes.md': 'meeting-notes.md', 'competitor-notes.md': 'competitor-notes.md', 'neural_sample_2.bin': 'bci/neural_sample_2.bin' };
const contentTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

export async function createApp({ directory = join(root, '.local'), port = 0, mcpTransport, fetchImpl } = {}) {
  const store = new Store(directory), models = new Models(directory);
  const capabilities = new Capabilities(directory, { models, getSdk: () => models.getSDK(), onEvent: (event, data) => store.log(event, data) });
  const attachments = new Attachments(store, directory), approvals = new Approvals(store), mcp = new McpHub(store, { createTransport: mcpTransport });
  const appSettings = () => store.list('app-settings')[0] || { offline: false };
  const connectors = new Connectors(store, new Secrets(directory), { fetchImpl, origin: () => origin });
  const skills = new Skills(store, directory); await skills.load();
  const studio = new Studio({ store, directory, models, capabilities });
  const tools = new ToolRegistry({ store, directory, capabilities, attachments, mcp, models, connectors, skills, studio, offline: () => appSettings().offline });
  // New documents join the vault in the background once the embedding model is installed.
  // Only when QVAC is already running in this session; otherwise the first vault search indexes.
  const indexVault = () => models.sdk && studio.cached('EMBEDDINGGEMMA_300M_Q8_0').then(ok => ok && studio.indexDocuments()).catch(e => store.log('vault.index-failed', { error: String(e.message).slice(0, 200) }));
  const brain = new Brain({ store, models, tools, attachments, approvals });
  const token = randomBytes(32).toString('hex'); let origin, configuring = false, closing = false, activeChat = null;
  const pendingRequests = new Set();
  const assertIdle = () => { if (activeChat || models.busy || capabilities.busy || configuring) throw new Error('The copilot is busy. Stop the current message or wait for it to finish.'); };

  // Conversations
  if (!store.list('conversation').length) store.put('conversation', { title: 'New chat', archived: false });
  let activeConversationId = store.list('ui-settings')[0]?.conversationId;
  const selectConversation = id => { activeConversationId = id; store.put('ui-settings', { id: 'active-conversation', conversationId: id }); };
  if (!store.list('conversation').some(c => c.id === activeConversationId && !c.archived)) selectConversation(store.list('conversation').find(c => !c.archived)?.id || store.put('conversation', { title: 'New chat', archived: false }).id);

  // Restore model choices. Earlier versions saved { provider, model, endpoint, device }.
  const saved = store.list('settings')[0]?.config;
  const brainChoice = config => config.catalogId ? { catalogId: config.catalogId, device: config.device } : { model: config.model, device: config.device };
  if ((saved?.catalogId || saved?.model) && (!saved.provider || saved.provider === 'qvac')) await models.configure(brainChoice({ device: process.platform === 'darwin' ? 'gpu' : 'cpu', ...saved })).catch(e => store.log('model.restore-failed', { error: e.message }));
  for (const item of store.list('capability-settings')) await capabilities.configure(item.config).catch(e => store.log('capability.restore-failed', { capability: item.config.capability, error: e.message }));
  mcp.start().catch(() => {});

  const capabilityFiles = new Set(capabilities.info().capabilities.flatMap(c => Object.entries(c.config || {}).filter(([key]) => key.endsWith('Path')).map(([, value]) => value)));
  const modelEntries = await readdir(join(root, 'models')).catch(() => []);
  const availableModels = modelEntries.filter(f => f.endsWith('.gguf') && modelEntries.includes(f + '.receipt.json') && !/-(0000[2-9]|000[1-9]\d|00[1-9]\d\d)-of-\d{5}\.gguf$/.test(f) && !capabilityFiles.has(join(root, 'models', f)) && !/laya|supertonic|craft|latin_g2/i.test(f))
    .map(name => ({ name, path: join(root, 'models', name) }));

  // Model catalog: downloads run in the background; state reports their progress.
  const catalogEntries = () => [...CATALOG, ...Object.keys(TRANSLATION_LANGUAGES).flatMap(lang => [translationEntry(lang, 'to'), translationEntry(lang, 'from')])];
  const downloads = new Map();
  const downloadedKeys = () => new Set(store.list('model-download').map(d => d.key));
  const catalog = async () => (await catalogStatus(await models.getSDK(), catalogEntries(), downloadedKeys())).map(e => ({ ...e, download: downloads.get(e.id) || null }));
  function startDownload(id) {
    const entry = catalogEntries().find(e => e.id === id);
    if (!entry) throw new Error('Unknown catalog entry');
    if (downloads.get(id)?.status === 'downloading') return;
    const controller = new AbortController(), job = { status: 'downloading', percentage: 0, file: '', controller };
    downloads.set(id, job); store.log('catalog.download-started', { id });
    models.getSDK().then(sdk => downloadEntry(sdk, entry, { signal: controller.signal, downloaded: downloadedKeys(), onProgress: p => Object.assign(job, { percentage: Math.round(p.percentage), file: p.file }) }))
      .then(async keys => {
        const have = downloadedKeys(); for (const key of keys) if (!have.has(key)) store.put('model-download', { key, entryId: id });
        if (entry.role === 'capability') await configureCapability(entry);
        Object.assign(job, { status: 'done', percentage: 100 }); store.log('catalog.download-finished', { id });
      })
      .catch(e => { Object.assign(job, { status: controller.signal.aborted ? 'cancelled' : 'failed', error: String(e.message).slice(0, 300) }); store.log('catalog.download-failed', { id, error: job.error }); });
  }
  async function configureCapability(entry) {
    const config = { capability: entry.capability, ...(await entryPaths(await models.getSDK(), entry)), ...(entry.options || {}) };
    while (capabilities.busy) await new Promise(r => setTimeout(r, 500));
    const result = await capabilities.configure(config);
    store.put('capability-settings', { id: `cap-${entry.capability}`, config: result.capabilities.find(c => c.id === entry.capability).config });
    store.log('capability.configured', { capability: entry.capability, from: 'catalog' });
  }
  const downloadInfo = () => Object.fromEntries([...downloads].map(([id, { controller, ...job }]) => [id, job]));

  const state = () => {
    const counts = store.count('message', 'conversationId');
    return {
      activeConversationId, busy: Boolean(activeChat),
      conversations: store.list('conversation').map(c => ({ ...c, messageCount: counts[c.id] || 0 })),
      messages: store.list('message').filter(m => m.conversationId === activeConversationId).slice(0, 100).reverse(),
      attachments: attachments.list(activeConversationId).map(({ metadata, ...a }) => ({ ...a, seconds: metadata?.seconds ?? null })),
      agents: AGENTS.map(({ instruction, ...a }) => a), commands: Object.entries(COMMANDS).map(([name, c]) => ({ name, help: c.help })),
      flows: tools.flows(), tools: tools.definitions().map(({ name, description, source, server, connectorName, approval }) => ({ name, description, source, server: server || connectorName, approval })),
      connectors: connectors.info(), skills: skills.info(), offline: appSettings().offline,
      downloads: downloadInfo(), model: { ...models.info(), availableModels }, capabilities: capabilities.info().capabilities, mcp: mcp.info(), approvals: approvals.list()
    };
  };

  const server = http.createServer(async (req, res) => {
    if (closing) return json(res, { error: 'Application is shutting down' }, 503);
    let finishRequest; const pending = new Promise(r => { finishRequest = r; }); pendingRequests.add(pending);
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(origin).host) return json(res, { error: 'Invalid host' }, 403);
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/oauth/callback') {
        // Reached by the provider's redirect, so no bearer token: the one-time state value is the credential.
        let message;
        try { message = `${await connectors.oauthCallback(url.searchParams)} is connected. You can close this tab and return to QVAC UI.`; }
        catch (e) { message = e.message; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>QVAC UI</title><body style="font:16px system-ui;background:#0c1015;color:#e6eaee;display:grid;place-items:center;height:100vh;margin:0"><p>${message.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])}</p></body>`);
      }
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET') return json(res, { error: 'Method not allowed' }, 405);
        const filename = resolve(root, 'dist', '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
        if (!filename.startsWith(resolve(root, 'dist') + '/')) return json(res, { error: 'Not found' }, 404);
        try { const bytes = await readFile(filename); res.setHeader('Content-Type', contentTypes[extname(filename)] || 'application/octet-stream'); res.end(bytes); } catch { json(res, { error: 'Not found. Build the frontend first.' }, 404); }
        return;
      }
      if (req.headers.origin && req.headers.origin !== origin) return json(res, { error: 'Cross-origin request blocked' }, 403);
      const supplied = Buffer.from((req.headers.authorization || '').replace(/^Bearer /, ''));
      if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) return json(res, { error: 'Unauthorized' }, 401);

      if (req.method === 'GET' && url.pathname === '/api/state') return json(res, state());
      if (req.method === 'GET' && url.pathname === '/api/audit') return json(res, { valid: store.verify(), events: store.audit() });
      if (req.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
        const record = store.get('audio', url.pathname.split('/').pop());
        res.writeHead(200, { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' }); return res.end(await readFile(record.mediaId ? join(directory, 'media', record.mediaId + '.wav') : join(directory, 'audio', record.id + '.wav')));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/media/')) {
        const record = store.get('media', url.pathname.split('/').pop());
        res.writeHead(200, { 'Content-Type': record.ext === 'png' ? 'image/png' : 'audio/wav', 'Cache-Control': 'no-store' }); return res.end(await readFile(join(directory, 'media', `${record.id}.${record.ext}`)));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/exports/')) {
        const record = store.get('export', url.pathname.split('/').pop());
        res.writeHead(200, { 'Content-Type': { md: 'text/markdown', csv: 'text/csv', txt: 'text/plain' }[record.format] + '; charset=utf-8', 'Content-Disposition': `attachment; filename="${record.name.replace(/"/g, '')}"`, 'Cache-Control': 'no-store' });
        return res.end(await readFile(join(directory, 'exports', `${record.id}.${record.format}`)));
      }
      if (req.method === 'GET' && url.pathname === '/api/vault') return json(res, studio.vaultInfo());
      if (req.method !== 'POST') return json(res, { error: 'Not found' }, 404);
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, { error: 'JSON required' }, 415);
      const input = await body(req, url.pathname === '/api/attachments' ? 180 * 1024 * 1024 : 1_200_000);

      if (url.pathname === '/api/chat') {
        assertIdle();
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Message timed out after 10 minutes')), 600000);
        activeChat = controller;
        res.on('close', () => { if (!res.writableEnded) controller.abort(new Error('Client disconnected')); });
        const stream = brain.chat({ ...input, conversationId: input.conversationId || activeConversationId }, { signal: controller.signal });
        try {
          const first = await stream.next();
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          for (let item = first; !item.done; item = await stream.next()) if (!res.destroyed) res.write(`event: ${item.value.event}\ndata: ${JSON.stringify(item.value.data)}\n\n`);
        } finally { clearTimeout(timer); activeChat = null; if (res.headersSent) res.end(); }
        return;
      }
      if (url.pathname === '/api/catalog') {
        const p = z.object({ action: z.enum(['list', 'download', 'cancel']), id: z.string().max(40).optional() }).strict().parse(input);
        if (p.action === 'download') startDownload(p.id);
        if (p.action === 'cancel') downloads.get(p.id)?.controller.abort(new Error('Download cancelled'));
        return json(res, { entries: await catalog(), downloads: downloadInfo() });
      }
      if (url.pathname === '/api/connectors') {
        const p = z.object({ action: z.enum(['save', 'enable', 'disable', 'remove', 'test', 'oauth-start']), id: z.string().max(40), values: z.record(z.string(), z.string().max(4000)).optional() }).strict().parse(input);
        if (p.action === 'save') await connectors.save(p.id, p.values || {}, true);
        if (p.action === 'enable' || p.action === 'disable') await connectors.save(p.id, {}, p.action === 'enable');
        if (p.action === 'remove') connectors.remove(p.id);
        if (p.action === 'oauth-start') return json(res, await connectors.oauthStart(p.id));
        if (p.action === 'test') { if (appSettings().offline) throw new Error('Offline mode is on'); return json(res, await connectors.test(p.id)); }
        return json(res, { connectors: connectors.info() });
      }
      if (url.pathname === '/api/skills') {
        const p = z.object({ action: z.enum(['save', 'enable', 'disable', 'delete', 'read']), name: z.string().max(64).optional(), source: z.string().max(40000).optional() }).strict().parse(input);
        if (p.action === 'save') await skills.save(p.source || '');
        if (p.action === 'enable' || p.action === 'disable') skills.setEnabled(p.name, p.action === 'enable');
        if (p.action === 'delete') await skills.remove(p.name);
        if (p.action === 'read') { const k = skills.items.find(x => x.name === p.name); if (!k) throw new Error('Unknown skill'); return json(res, k); }
        return json(res, { skills: skills.info() });
      }
      if (url.pathname === '/api/settings/app') {
        const p = z.object({ offline: z.boolean() }).strict().parse(input);
        store.put('app-settings', { ...appSettings(), ...p, id: 'app' }); store.log('app.settings', p);
        return json(res, appSettings());
      }
      if (url.pathname === '/api/cancel') { const cancelled = Boolean(activeChat); activeChat?.abort(new Error('Stopped by user')); return json(res, { cancelled }); }
      if (url.pathname === '/api/approvals') { const p = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']), digest: z.string().length(64) }).strict().parse(input); return json(res, approvals.decide(p.id, p.decision, p.digest)); }
      if (url.pathname === '/api/attachments') { const record = await attachments.add({ ...input, conversationId: input.conversationId || activeConversationId }); if (record.kind === 'document') indexVault(); return json(res, record); }
      if (url.pathname === '/api/vault') { z.object({ action: z.literal('index') }).strict().parse(input); return json(res, await studio.indexDocuments()); }
      if (url.pathname === '/api/samples') {
        const p = z.object({ name: z.enum(Object.keys(SAMPLES)), conversationId: z.string().optional() }).strict().parse(input);
        const bytes = await readFile(join(root, 'fixtures', SAMPLES[p.name]));
        const record = await attachments.add({ conversationId: p.conversationId || activeConversationId, name: p.name, base64: bytes.toString('base64') }); if (record.kind === 'document') indexVault(); return json(res, record);
      }
      if (url.pathname === '/api/conversations') {
        const p = z.object({ action: z.enum(['create', 'select', 'rename', 'archive', 'restore']), id: z.string().optional(), title: z.string().trim().min(1).max(100).optional() }).strict().parse(input);
        if (activeChat && p.action !== 'rename') throw new Error('Wait for the current message to finish before switching chats');
        if (p.action === 'create') { const c = store.put('conversation', { title: p.title || 'New chat', archived: false }); selectConversation(c.id); return json(res, c); }
        if (!p.id) throw new Error('Chat ID required');
        const c = store.get('conversation', p.id);
        if (p.action === 'select') { if (c.archived) throw new Error('Restore the chat first'); selectConversation(c.id); }
        if (p.action === 'rename') { if (!p.title) throw new Error('Chat title required'); store.put('conversation', { ...c, title: p.title }); }
        if (p.action === 'archive' || p.action === 'restore') {
          store.put('conversation', { ...c, archived: p.action === 'archive' });
          if (p.action === 'archive' && activeConversationId === c.id) selectConversation((store.list('conversation').find(x => !x.archived) || store.put('conversation', { title: 'New chat', archived: false })).id);
        }
        store.log('chat.managed', { action: p.action, conversationId: c.id }); return json(res, { activeConversationId });
      }
      if (url.pathname === '/api/settings/model') {
        assertIdle(); configuring = true;
        try { const result = await models.configure(input); store.put('settings', { id: 'model-settings', config: brainChoice(models.config) }); store.log('model.configured', brainChoice(models.config)); return json(res, result); }
        finally { configuring = false; }
      }
      if (url.pathname === '/api/settings/capability') {
        assertIdle(); configuring = true;
        try { const result = await capabilities.configure(input); store.put('capability-settings', { id: `cap-${input.capability}`, config: result.capabilities.find(c => c.id === input.capability).config }); store.log('capability.configured', { capability: input.capability }); return json(res, result); }
        finally { configuring = false; }
      }
      if (url.pathname === '/api/mcp') {
        const p = z.object({ action: z.enum(['add', 'update', 'remove', 'reconnect']), id: z.string().optional(), server: z.unknown().optional(), patch: z.unknown().optional() }).strict().parse(input);
        if (p.action === 'add') return json(res, await mcp.add(p.server));
        if (!p.id) throw new Error('Server ID required');
        if (p.action === 'update') return json(res, await mcp.update(p.id, p.patch));
        if (p.action === 'remove') return json(res, await mcp.remove(p.id));
        await mcp.connect(store.get('mcp-server', p.id)); return json(res, mcp.info());
      }
      if (url.pathname === '/api/flows') { const p = z.object({ action: z.literal('delete'), name: z.string().max(40) }).strict().parse(input); tools.deleteFlow(p.name); return json(res, { flows: tools.flows() }); }
      return json(res, { error: 'Unknown operation' }, 404);
    } catch (e) { if (!res.headersSent) json(res, { error: e instanceof z.ZodError ? e.issues.map(i => i.message).join('; ') : e.message }, 400); else res.end(); }
    finally { pendingRequests.delete(pending); finishRequest(); }
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r)); origin = `http://127.0.0.1:${server.address().port}`;
  return { server, store, models, capabilities, attachments, approvals, mcp, tools, brain, studio, connectors, skills, origin, token, url: `${origin}/#${token}`, close: async () => {
    closing = true; const stopped = new Promise(r => server.close(r)); activeChat?.abort(new Error('Application shutdown')); for (const job of downloads.values()) job.controller.abort(); server.closeAllConnections();
    const force = setTimeout(() => { models.sdk?.close().catch(() => {}); }, 5000);
    try { await capabilities.close(); await Promise.allSettled([...pendingRequests]); await mcp.close(); await models.close(); await stopped; }
    finally { clearTimeout(force); store.close(); }
  } };
}
