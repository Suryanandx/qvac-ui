// End-to-end check of QVAC UI with real local QVAC models, through the same
// authenticated HTTP API the interface uses. Runs in a throwaway workspace
// (sharing the downloaded model cache) and writes evidence to
// verification/native-harness.json. Needs provisioned weights; downloads nothing.
// Usage: node scripts/test-native-harness.mjs [scenario-name-filter]
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { CATALOG, entryPaths } from '../server/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)), only = process.argv[2]?.toLowerCase();
process.env.QVAC_UI_KEYCHAIN = '0';
const directory = await mkdtemp(join(tmpdir(), 'qvac-native-harness-'));
const app = await createApp({ directory });
const auth = { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' };
const post = async (path, body) => { const res = await fetch(app.origin + path, { method: 'POST', headers: auth, body: JSON.stringify(body) }); const value = await res.json(); if (!res.ok) throw new Error(value.error); return value; };

async function chat(body, { approve = false } = {}) {
  const res = await fetch(app.origin + '/api/chat', { method: 'POST', headers: auth, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error);
  const reader = res.body.getReader(), decoder = new TextDecoder(), events = []; let buffer = '';
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n'); buffer = frames.pop();
    for (const frame of frames) {
      const event = { event: frame.match(/^event: (.*)$/m)[1], data: JSON.parse(frame.match(/^data: (.*)$/m)[1]) };
      events.push(event);
      if (event.event === 'approval') await post('/api/approvals', { id: event.data.id, decision: approve ? 'approve' : 'reject', digest: event.data.digest });
    }
  }
  return { events, message: events.at(-1).data, user: events.findLast(e => e.event === 'user' || e.event === 'start').data.user };
}

const results = [];
async function run(name, setup, check) {
  if (only && !name.toLowerCase().includes(only)) return;
  const conversation = await post('/api/conversations', { action: 'create', title: `Harness · ${name}` });
  const started = performance.now();
  try {
    const { request, options } = await setup(conversation.id);
    const out = await chat({ conversationId: conversation.id, ...request }, options);
    const tools = out.message.parts.filter(p => p.type === 'tool').map(p => `${p.name}:${p.status}`);
    const failures = check(out).filter(([ok]) => !ok).map(([, label]) => label);
    results.push({ name, passed: !failures.length && !out.message.error, failures, error: out.message.error, tools, answer: out.message.content.slice(0, 700), user: out.user.content.slice(0, 200), elapsedMs: Math.round(performance.now() - started) });
  } catch (e) { results.push({ name, passed: false, error: e.message, elapsedMs: Math.round(performance.now() - started) }); }
  const r = results.at(-1); console.log(`${r.passed ? 'PASS' : 'FAIL'} ${name} (${(r.elapsedMs / 1000).toFixed(1)} s) ${r.tools?.join(', ') || ''} ${r.failures?.join('; ') || r.error || ''}`);
}
const sample = (conversationId, name) => post('/api/samples', { conversationId, name });
const used = (out, tool) => out.message.parts.some(p => p.name === tool && p.status === 'done');
const display = (out, tool) => out.message.parts.filter(p => p.name === tool).map(p => p.display || '').join('\n');
const has = (text, ...needles) => needles.every(n => text.replace(/,/g, '').toLowerCase().includes(n.replace(/,/g, '').toLowerCase()));
const all = out => [out.message.content, ...out.message.parts.map(p => p.display || '')].join('\n');

try {
  await app.models.configure({ catalogId: process.env.QVAC_TEST_BRAIN || 'brain-vision', device: process.platform === 'darwin' ? 'gpu' : 'cpu' });
  // Configure each tool from the QVAC registry cache, or from older local files in models/ when present.
  const sdk = await app.models.getSDK(), local = { transcribe: { modelPath: 'ggml-tiny.en.bin' }, tts: { modelPath: 'supertonic-q4_0.gguf' }, ocr: { modelPath: 'latin_g2.gguf', detectorPath: 'craft_mlt_25k.gguf' }, bci: { modelPath: 'ggml-bci-windowed.bin', embedderPath: 'bci-embedder.bin' }, decide: { modelPath: 'laya-typed-decisions-Q8_0.gguf' } };
  for (const entry of CATALOG.filter(e => e.role === 'capability')) {
    const paths = await entryPaths(sdk, entry).catch(() => Object.fromEntries(Object.entries(local[entry.capability]).map(([k, f]) => [k, join(root, 'models', f)])));
    await app.capabilities.configure({ capability: entry.capability, ...paths, ...(entry.options || {}) }).catch(e => console.log(`skip ${entry.capability}: ${e.message}`));
  }

  await run('Meeting notes with speakers', async id => { await sample(id, 'team-meeting.wav'); return { request: { text: 'Write meeting notes for this recording.', agent: 'meeting' } }; },
    out => [[used(out, 'meeting_notes'), 'meeting_notes ran'], [/Speaker 2/.test(display(out, 'meeting_notes')), 'two speakers labelled'], [has(all(out), 'november'), 'launch date captured'], [/Download\(/.test(display(out, 'meeting_notes')), 'markdown export']]);
  await run('Document intake (vision fields)', async id => { await sample(id, 'invoice.png'); return { request: { text: 'Extract vendor, invoice number, subtotal, tax and total from this invoice.', agent: 'analyst' } }; },
    out => [[used(out, 'extract_fields'), 'extract_fields ran'], [has(display(out, 'extract_fields'), '1,296'), 'total 1,296'], [has(display(out, 'extract_fields'), 'northstar'), 'vendor']]);
  await run('OCR invoice question', async id => { await sample(id, 'invoice.png'); return { request: { text: '/ocr' } }; },
    out => [[used(out, 'read_image_text'), 'used OCR'], [has(all(out), '1,296'), 'total 1,296']]);
  await run('Look at an image', async id => { await sample(id, 'invoice.png'); return { request: { text: 'What is in this image? Describe it.' } }; },
    out => [[used(out, 'look_at_image'), 'vision tool ran'], [/invoice/i.test(all(out)), 'recognized an invoice']]);
  await run('CSV totals by region', async id => { await sample(id, 'business-sales.csv'); return { request: { text: 'What is total revenue, and how does it split by region?' } }; },
    out => [[used(out, 'analyze_table'), 'used analyze_table'], [has(out.message.content, '180,810'), 'exact total'], [display(out, 'analyze_table').includes('by region'), 'chart by region']]);
  await run('PDF summary', async id => { await sample(id, 'remote-work-policy.pdf'); return { request: { text: 'How many remote days does this policy allow, and what stipend is offered?' } }; },
    out => [[/three|3/i.test(out.message.content), 'three days'], [has(all(out), '300'), 'stipend']]);
  await run('Word document', async id => { await sample(id, 'vendor-onboarding.docx'); return { request: { text: 'Who must complete the security review according to this checklist?' } }; },
    out => [[/\bIT\b/.test(all(out)), 'IT named']]);
  await run('Private vault search', async id => { await sample(id, 'meeting-notes.md'); return { request: { text: 'Search the vault: who is preparing the revenue report?' } }; },
    out => [[used(out, 'search_vault'), 'vault searched'], [/priya/i.test(all(out)), 'found Priya']]);
  await run('Translate to Spanish', async () => ({ request: { text: 'Translate into Spanish: "The quarterly report is ready. Please review the budget before Friday."' } }),
    out => [[used(out, 'translate_text'), 'translated'], [/informe|presupuesto|viernes/i.test(all(out)), 'Spanish output']]);
  await run('Skill: invoice check', async id => { await sample(id, 'invoice.png'); return { request: { text: '/skill invoice-check' } }; },
    out => [[used(out, 'use_skill'), 'skill loaded'], [used(out, 'extract_fields') || used(out, 'read_image_text') || used(out, 'look_at_image'), 'skill steps followed']]);
  await run('BCI decode then speak', async id => { await sample(id, 'neural_sample_2.bin'); return { request: { text: 'Decode this brain recording, then read the sentence aloud.' } }; },
    out => [[used(out, 'decode_brain_signals'), 'decoded'], [used(out, 'speak'), 'spoke'], [/controversial/i.test(display(out, 'speak')), 'spoke the decoded text']]);
  await run('Voice round trip', async id => { const voice = await sample(id, 'voice-question.wav'); return { request: { voiceAttachmentId: voice.id, speak: true } }; },
    out => [[/sales report/i.test(out.user.content), 'transcribed question'], [used(out, 'speak'), 'spoken reply'], [out.message.content.length > 20, 'answered']]);
  await run('Image classification', async id => { await sample(id, 'invoice.png'); return { request: { text: '/classify' } }; },
    out => [[used(out, 'classify_image'), 'classified'], [/report/i.test(display(out, 'classify_image')), 'labels report']]);
  await run('Typed decision', async () => ({ request: { text: 'Use the decision model: invoice INV-2026-1042 for $1,296 matches the purchase order and was delivered. Should finance approve, hold, or reject it?' } }),
    out => [[used(out, 'decide'), 'used decide']]);
  await run('Create a flow', async () => ({ request: { text: 'Create a flow called read-aloud that reads the text in an image with OCR and then speaks it.' } }),
    out => [[used(out, 'create_flow'), 'created'], [app.tools.flows().some(f => f.name === 'read-aloud' && f.steps.at(-1) === 'speak'), 'saved ending with speak']]);
  await run('Research via Wikipedia connector', async () => { await post('/api/connectors', { action: 'enable', id: 'wikipedia' }); return { request: { text: 'Using Wikipedia, when was Ada Lovelace born?', agent: 'researcher' } }; },
    out => [[out.message.parts.some(p => p.name?.startsWith('wikipedia_') && p.status === 'done'), 'wikipedia tool ran'], [/1815/.test(all(out)), 'birth year']]);
  await run('Generation without models explains how to install', async () => ({ request: { text: 'Generate an image of a red bicycle.' } }),
    out => [[out.message.parts.some(p => p.name === 'generate_image'), 'tried generate_image'], [/download|install|settings/i.test(all(out)), 'explains download']]);
  const notesFile = join(directory, 'notes.json');
  await post('/api/mcp', { action: 'add', server: { transport: 'stdio', name: 'notes', command: process.execPath, args: [join(root, 'scripts', 'notes-mcp-server.mjs')], env: { NOTES_FILE: notesFile } } });
  await run('MCP tool with approval', async () => ({ request: { text: 'Save a note: call the Acme team about the renewal on Monday.' }, options: { approve: true } }),
    out => [[out.events.some(e => e.event === 'approval'), 'asked for approval'], [used(out, 'notes__add_note'), 'MCP call ran']]);
  if (!only || 'mcp'.includes(only)) { const notes = JSON.parse(await readFile(notesFile, 'utf8').catch(() => '[]')); const r = results.find(x => x.name === 'MCP tool with approval'); if (r && !notes.some(n => /acme/i.test(n.text))) { r.passed = false; r.failures.push('note written'); } }
  await run('Offline mode blocks connectors', async () => { await post('/api/settings/app', { offline: true }); return { request: { text: 'Using Wikipedia, who was Grace Hopper?' } }; },
    out => [[!out.message.parts.some(p => p.name?.startsWith('wikipedia_')), 'no connector call while offline']]);
} finally {
  await post('/api/settings/app', { offline: false }).catch(() => {});
  const summary = { ranAt: new Date().toISOString(), brain: app.models.config?.label, host: `${process.platform} ${process.arch}`, passed: results.filter(r => r.passed).length, total: results.length, results };
  if (!only) await writeFile(join(root, 'verification', 'native-harness.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`\n${summary.passed}/${summary.total} passed${only ? '' : ' · verification/native-harness.json'}`);
  await app.close(); await rm(directory, { recursive: true, force: true });
  process.exit(summary.passed === summary.total ? 0 : 1);
}
