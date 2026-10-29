// Pure-function tests for the use-case pipelines and skills. No model weights needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chunkText, decodeWav, encodeWav16, parseSpeakers, resample } from '../server/studio.mjs';
import { parseSkill, Skills } from '../server/skills.mjs';
import { docxText, pdfText } from '../server/attachments.mjs';
import { CATALOG } from '../server/catalog.mjs';

test('speaker turns parse both time formats and merge adjacent turns', () => {
  const turns = parseSpeakers('Speaker 0: 00:00:00.160 - 00:00:04.560\nSpeaker 1: 00:00:05.440 - 00:00:10.880\nSpeaker 1: 00:00:11.000 - 00:00:12.000\nSpeaker 0: 1.5s - 1.6s\nnoise');
  assert.deepEqual(turns.map(t => [t.speaker, t.start, t.end]), [[1, .16, 4.56], [2, 5.44, 12]]);
  assert.equal(parseSpeakers('Speaker 2: 0.40s - 3.12s')[0].speaker, 3);
});

test('WAV round trip resamples to 16 kHz mono', () => {
  const tone = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 10) * .5);
  const wav = encodeWav16(tone, 48000);
  const { samples, rate } = decodeWav(wav);
  assert.equal(rate, 48000); assert.equal(samples.length, 4800);
  assert.ok(Math.abs(samples[100] - tone[100]) < 1e-3);
  assert.equal(resample(samples, 48000, 16000).length, 1600);
});

test('text chunks overlap and cover the whole document', () => {
  const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkText(text, 300, 60);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every(c => c.length <= 300));
  assert.ok(chunks.at(-1).includes('word399') && chunks[0].startsWith('word0'));
});

test('skills parse the Agent Skills format and every built-in skill is valid', async () => {
  const skill = parseSkill('---\nname: demo-skill\ndescription: Does a demo thing when the user asks for a demo.\nlicense: MIT\n---\n\n# Demo\n1. Step');
  assert.deepEqual([skill.name, skill.license], ['demo-skill', 'MIT']);
  assert.throws(() => parseSkill('no frontmatter'), /frontmatter/);
  assert.throws(() => parseSkill('---\nname: Bad Name\ndescription: A description that is long enough.\n---\nbody'));
  const directory = await mkdtemp(join(tmpdir(), 'qvac-skills-'));
  try {
    const records = [];
    const store = { list: kind => records.filter(r => r.kind === kind), put: (kind, body) => { records.push({ kind, ...body }); return body; }, log: () => {} };
    const skills = new Skills(store, directory);
    const all = await skills.load();
    assert.ok(all.length >= 30, `built-in skills: ${all.length}`);
    const tools = ['meeting_notes', 'extract_fields', 'analyze_table', 'transcribe_audio', 'look_at_image', 'translate_text', 'speak', 'search_vault', 'search_files', 'show_ui', 'decide', 'save_document', 'tool_search', 'generate_image', 'generate_music', 'read_image_text', 'decode_brain_signals'];
    for (const s of all) assert.ok(tools.some(t => s.body.includes(t)), `${s.name} names at least one tool`);
    await skills.save('---\nname: my-flow\ndescription: My own workflow for weekly reports.\n---\nDo the thing.');
    assert.ok(skills.get('my-flow'));
    skills.setEnabled('my-flow', false);
    assert.equal(skills.get('my-flow'), undefined);
    await assert.rejects(skills.remove('meeting-minutes'), /built-in/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('PDF and Word attachments become text', async () => {
  assert.match(await pdfText(await readFile(new URL('../fixtures/remote-work-policy.pdf', import.meta.url))), /three days per week/);
  assert.match(await docxText(await readFile(new URL('../fixtures/vendor-onboarding.docx', import.meta.url))), /Security review/);
});

test('catalog entries are unique and reference pinned sources', () => {
  const ids = CATALOG.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of CATALOG) for (const asset of Object.values(e.assets)) {
    if (typeof asset === 'string') assert.match(asset, /^[A-Z0-9_]+$/);
    else { assert.match(asset.url, /^https:\/\/huggingface\.co\/.+\/resolve\/[0-9a-f]{40}\//); assert.match(asset.sha256, /^[0-9a-f]{64}$/); }
  }
});
