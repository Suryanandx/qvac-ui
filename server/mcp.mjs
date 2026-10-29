import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';

const slug = z.string().trim().regex(/^[a-z][a-z0-9-]{0,23}$/, 'Use a short lowercase name: letters, digits and dashes');
export const mcpServerSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('stdio'), name: slug, command: z.string().trim().min(1).max(500), args: z.array(z.string().max(1000)).max(40).default([]), env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(4000)).default({}) }).strict(),
  z.object({ transport: z.literal('http'), name: slug, url: z.string().url().max(2000), headers: z.record(z.string().max(100), z.string().max(4000)).default({}) }).strict()
]);
export const MAX_MCP_TOOLS = 24;
const toolName = (server, tool) => `${server.replace(/-/g, '_')}__${tool.replace(/[^a-zA-Z0-9_]/g, '_')}`.slice(0, 64);

/** Normalize an MCP inputSchema to the object-with-properties shape QVAC tool templates expect. */
export function toolParameters(schema) {
  const properties = schema?.type === 'object' && schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  return { type: 'object', properties, ...(Array.isArray(schema?.required) ? { required: schema.required.filter(k => k in properties) } : {}) };
}

/** Text the model sees for an MCP result. Non-text parts are summarized, not passed through. */
export function resultText(result) {
  const parts = (result?.content || []).map(p => p.type === 'text' ? p.text : p.type === 'resource' ? (p.resource?.text ?? `[resource ${p.resource?.uri}]`) : `[${p.type}${p.mimeType ? ' ' + p.mimeType : ''}]`);
  if (result?.structuredContent && !parts.length) parts.push(JSON.stringify(result.structuredContent));
  return parts.join('\n').trim() || '(empty result)';
}

/**
 * Connections to user-configured MCP servers. Only the user adds servers (in
 * Settings); the model can call their tools, and every call needs approval
 * unless the user marked that server as trusted.
 */
export class McpHub {
  constructor(store, { createTransport } = {}) {
    this.store = store; this.connections = new Map();
    this.createTransport = createTransport || (server => server.transport === 'stdio'
      ? new StdioClientTransport({ command: server.command, args: server.args, env: { PATH: process.env.PATH, HOME: process.env.HOME, ...server.env }, stderr: 'pipe' })
      : new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers: server.headers } }));
  }
  servers() { return this.store.list('mcp-server').reverse(); }
  info() {
    return this.servers().map(({ env, headers, ...s }) => {
      const c = this.connections.get(s.id);
      return { ...s, envKeys: Object.keys(env || {}), headerKeys: Object.keys(headers || {}), status: c?.status || (s.enabled ? 'disconnected' : 'disabled'), error: c?.error || null, tools: (c?.tools || []).map(t => ({ name: t.name, description: t.description })) };
    });
  }
  async start() { await Promise.allSettled(this.servers().filter(s => s.enabled).map(s => this.connect(s))); }
  async add(input) {
    const config = mcpServerSchema.parse(input);
    if (this.servers().some(s => s.name === config.name)) throw new Error(`An MCP server named ${config.name} already exists`);
    const server = this.store.put('mcp-server', { ...config, enabled: true, trusted: false });
    this.store.log('mcp.added', { id: server.id, name: server.name, transport: server.transport });
    await this.connect(server);
    return this.info();
  }
  async update(id, patch) {
    const server = this.store.get('mcp-server', id), next = this.store.put('mcp-server', { ...server, ...z.object({ enabled: z.boolean(), trusted: z.boolean() }).partial().strict().parse(patch) });
    this.store.log('mcp.updated', { id, enabled: next.enabled, trusted: next.trusted });
    await this.disconnect(id);
    if (next.enabled) await this.connect(next);
    return this.info();
  }
  async remove(id) {
    const server = this.store.get('mcp-server', id);
    await this.disconnect(id); this.store.remove('mcp-server', id);
    this.store.log('mcp.removed', { id, name: server.name });
    return this.info();
  }
  async connect(server) {
    await this.disconnect(server.id);
    const entry = { status: 'connecting', tools: [], error: null };
    this.connections.set(server.id, entry);
    try {
      const client = new Client({ name: 'qvac-ui', version: '0.2.0' });
      await client.connect(this.createTransport(server), { timeout: 20000 });
      const { tools } = await client.listTools(undefined, { timeout: 20000 });
      Object.assign(entry, { client, status: 'connected', tools: tools.slice(0, MAX_MCP_TOOLS) });
      this.store.log('mcp.connected', { id: server.id, name: server.name, tools: entry.tools.map(t => t.name) });
    } catch (e) {
      Object.assign(entry, { status: 'error', error: String(e.message || e).slice(0, 300) });
      this.store.log('mcp.failed', { id: server.id, name: server.name, error: entry.error });
    }
  }
  async disconnect(id) {
    const c = this.connections.get(id); this.connections.delete(id);
    await c?.client?.close().catch(() => {});
  }
  /** Tool definitions for the Brain, namespaced by server. */
  tools() {
    const list = [];
    for (const server of this.servers()) {
      const c = this.connections.get(server.id);
      if (c?.status !== 'connected') continue;
      for (const tool of c.tools) list.push({
        name: toolName(server.name, tool.name), source: 'mcp', server: server.name, approval: !server.trusted,
        description: `[MCP ${server.name}] ${(tool.description || tool.name).slice(0, 400)}`,
        parameters: toolParameters(tool.inputSchema),
        call: (args, { signal }) => c.client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 60000 })
      });
    }
    return list.slice(0, MAX_MCP_TOOLS);
  }
  async close() { await Promise.allSettled([...this.connections.keys()].map(id => this.disconnect(id))); }
}
