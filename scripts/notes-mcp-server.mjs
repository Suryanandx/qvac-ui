// A tiny local MCP server for trying the copilot's MCP support without
// downloading anything. Add it in Settings → MCP servers:
//   command: node   arguments: <absolute path to this file>
// Notes are stored in NOTES_FILE (default: .local/mcp-notes.json).
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const file = process.env.NOTES_FILE || fileURLToPath(new URL('../.local/mcp-notes.json', import.meta.url));
const load = async () => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return []; } };
const server = new McpServer({ name: 'notes', version: '1.0.0' });

server.registerTool('add_note', { description: 'Save a short note', inputSchema: { text: z.string().min(1).max(2000) } }, async ({ text }) => {
  const notes = await load(); notes.push({ text, at: new Date().toISOString() });
  await writeFile(file, JSON.stringify(notes, null, 2), { mode: 0o600 });
  return { content: [{ type: 'text', text: `Saved note #${notes.length}.` }] };
});
server.registerTool('list_notes', { description: 'List saved notes', inputSchema: {} }, async () => {
  const notes = await load();
  return { content: [{ type: 'text', text: notes.length ? notes.map((n, i) => `${i + 1}. ${n.text} (${n.at})`).join('\n') : 'No notes yet.' }] };
});

await server.connect(new StdioServerTransport());
