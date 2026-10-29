// Adapter contract tests with an injected SDK. These do NOT establish native inference/model accuracy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Capabilities, capabilityRunSchema, decodeUpload, validateNeural, validateImage, encodeWav } from '../server/capabilities.mjs';

const uuid = () => randomUUID();
const wav = () => ({ name: 'speech.wav', base64: encodeWav([0, 125, -125, 0], 16000).base64 });
const neural = () => { const bytes = Buffer.alloc(24); bytes.writeUInt32LE(2, 0); bytes.writeUInt32LE(2, 4); [1, 2, 3, 4].forEach((v, i) => bytes.writeFloatLE(v, 8 + i * 4)); return { name: 'session.bin', base64: bytes.toString('base64') }; };
const image = () => ({ name: 'image.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=' });
function promise(value, requestId = uuid()) { return Object.assign(Promise.resolve(value), { requestId }); }
async function fixture(t, overrides = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'qvac-capabilities-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const weights = join(directory, 'weights.gguf'); await writeFile(weights, 'GGUFfake-test-weights');
  const embedder = join(directory, 'embedder.bin'); await writeFile(embedder, 'EICBfake-test-weights');
  const calls = [];
  const sdk = {
    loadModel: input => { calls.push(['load', input]); return promise(`model-${calls.length}`); },
    unloadModel: async input => { calls.push(['unload', input]); },
    cancel: async input => { calls.push(['cancel', input]); },
    transcribe: input => { calls.push(['transcribe', input]); return promise([{ text: 'Hello there', startMs: 0, endMs: 2 }]); },
    textToSpeech: input => { calls.push(['tts', input]); return { requestId: uuid(), buffer: Promise.resolve([0, 1000, -1000]), sampleRate: Promise.resolve(24000), done: Promise.resolve(true) }; },
    bciTranscribe: input => { calls.push(['bci', input]); return promise([{ text: 'Research transcript', startMs: 0, endMs: 2 }]); },
    ocr: input => { calls.push(['ocr', input]); return { blocks: Promise.resolve([{ text: 'Invoice 12', confidence: .9, bbox: [1, 2, 3, 4] }]) }; },
    classify: input => { calls.push(['classify', input]); return Promise.resolve([{ label: 'report', confidence: .9 }]); },
    decide: input => { calls.push(['decide', input]); return promise({ answers: { refund: { type: 'noul', noul: .8 } } }); },
    ...overrides
  };
  const models = { config: { provider: 'qvac', model: weights }, async *generate(history, { signal }) { signal.throwIfAborted(); calls.push(['chat', history]); yield 'A short local response.'; } };
  const capabilities = new Capabilities(directory, { getSdk: () => sdk, models });
  return { directory, weights, embedder, calls, capabilities, sdk, models };
}

test('strict schemas reject arbitrary configuration, traversal payloads and incomplete operations', async t => {
  const { capabilities, weights } = await fixture(t);
  await assert.rejects(capabilities.configure({ capability: 'tts', modelPath: weights, modelConfig: { referenceAudioSrc: 'https://external.test' } }));
  await assert.rejects(capabilities.configure({ capability: 'tts', modelPath: 'https://external.test/model.gguf' }), /absolute local/);
  await assert.rejects(capabilities.configure({ capability: 'ocr', modelPath: weights }), /detector/);
  await assert.rejects(capabilities.configure({ capability: 'bci', modelPath: weights }), /embedder/);
  assert.throws(() => capabilityRunSchema.parse({ requestId: uuid(), capability: 'bci', upload: neural() }), /dayIndex/);
  assert.throws(() => capabilityRunSchema.parse({ requestId: uuid(), capability: 'tts', text: 'Hi', outputPath: '/tmp/evil' }));
  await assert.rejects(capabilities.run({ requestId: uuid(), capability: 'transcribe', upload: wav() }), /Configure local/);
});

test('upload validation checks actual bytes, bounded format dimensions and finite neural samples', () => {
  assert.equal(decodeUpload(wav(), 'transcribe').metadata.sampleRate, 16000);
  assert.equal(decodeUpload(image(), 'ocr').metadata.width, 1);
  assert.equal(decodeUpload(neural(), 'bci').metadata.timesteps, 2);
  assert.throws(() => decodeUpload({ name: 'wrong.wav', base64: Buffer.from('not audio').toString('base64') }, 'voice'), /WAV/);
  assert.throws(() => decodeUpload({ ...wav(), base64: wav().base64 + '!!' }, 'transcribe'), /base64/);
  const bytes = Buffer.from(neural().base64, 'base64'); bytes.writeFloatLE(NaN, 8); assert.throws(() => validateNeural(bytes), /finite/);
  assert.throws(() => validateNeural(Buffer.alloc(8)), /header/);
  const oversized = Buffer.from(image().base64, 'base64'); oversized.writeUInt32BE(9999, 16); assert.throws(() => validateImage(oversized), /16 megapixels/);
});

test('STT uses private uploaded files, real SDK signature and deletes input after success', async t => {
  const { capabilities, weights, calls, directory, sdk } = await fixture(t);
  await capabilities.configure({ capability: 'transcribe', modelPath: weights });
  sdk.transcribe = input => { calls.push(['transcribe', input]); return Object.assign(readFile(input.audioChunk).then(bytes => { assert.equal(bytes.toString('ascii', 0, 4), 'RIFF'); return [{ text: 'Recognized words', startMs: 0, endMs: 1 }]; }), { requestId: uuid() }); };
  const result = await capabilities.run({ requestId: uuid(), capability: 'transcribe', upload: { ...wav(), name: '../../escape.wav' } });
  assert.equal(result.result.text, 'Recognized words');
  assert.equal(result.provenance.input.name, 'escape.wav');
  assert.equal(result.provenance.input.sha256.length, 64);
  assert.equal(calls[0][1].modelType, 'whispercpp-transcription');
  assert.equal(calls[0][1].modelSrc, weights);
  assert.equal(calls.at(-1)[0], 'unload');
  assert.deepEqual(await readdir(join(directory, 'capability-inputs')), []);
});

test('speech, BCI, OCR, classification and typed decisions use pinned SDK contracts', async t => {
  const { capabilities, weights, embedder, calls } = await fixture(t);
  for (const capability of ['tts', 'bci', 'ocr', 'classify', 'decide']) await capabilities.configure({ capability, modelPath: weights, ...(capability === 'bci' ? { embedderPath: embedder } : {}), ...(capability === 'ocr' ? { detectorPath: weights } : {}) });
  const speech = await capabilities.run({ requestId: uuid(), capability: 'tts', text: 'Hi' });
  assert.equal(speech.result.audio.sampleRate, 24000);
  assert.equal(Buffer.from(speech.result.audio.base64, 'base64').readInt16LE(46), 1000);
  const bci = await capabilities.run({ requestId: uuid(), capability: 'bci', upload: neural(), dayIndex: 7 });
  assert.equal(bci.result.dayIndex, 7);
  const bciLoad = calls.find(([kind, args]) => kind === 'load' && args.modelType === 'bci-whispercpp-transcription')[1];
  assert.deepEqual(bciLoad.modelConfig.bciConfig, { day_idx: 7 }); assert.equal(bciLoad.modelConfig.embedderModelSrc, embedder);
  const ocr = await capabilities.run({ requestId: uuid(), capability: 'ocr', upload: image() }); assert.equal(ocr.result.text, 'Invoice 12');
  const classification = await capabilities.run({ requestId: uuid(), capability: 'classify', upload: image() }); assert.equal(classification.result.classifications[0].label, 'report');
  const decision = await capabilities.run({ requestId: uuid(), capability: 'decide', text: 'Refund this duplicate charge', questions: { refund: { type: 'noul', instructions: 'User requests a refund.' } } });
  assert.equal(decision.result.actionsExecuted, false); assert.equal(decision.provenance.toolsExecuted, false);
  assert.equal(calls.filter(([kind]) => kind === 'load').length, calls.filter(([kind]) => kind === 'unload').length);
});

test('the old composed voice capability is gone; voice runs through the Brain', async t => {
  const { capabilities } = await fixture(t);
  assert.throws(() => capabilityRunSchema.parse({ requestId: uuid(), capability: 'voice', upload: wav() }));
  assert.ok(!capabilities.info().capabilities.some(c => c.id === 'voice'));
});

test('request cancellation targets SDK requestId and retains lock until native cleanup finishes', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const stalled = Object.assign(new Promise(resolve => { release = resolve; }), { requestId: 'sdk-stt-request' });
  const { capabilities, weights, calls, directory } = await fixture(t, { transcribe: () => { began(); return stalled; } });
  await capabilities.configure({ capability: 'transcribe', modelPath: weights });
  const requestId = uuid();
  const running = capabilities.run({ requestId, capability: 'transcribe', upload: wav() });
  await started;
  await assert.rejects(capabilities.run({ requestId: uuid(), capability: 'transcribe', upload: wav() }), /already active/);
  assert.equal(capabilities.cancel(requestId).cancelled, true);
  await assert.rejects(running, /cancelled/);
  assert.equal(capabilities.busy, true);
  assert.deepEqual(calls.find(([kind]) => kind === 'cancel')[1], { requestId: 'sdk-stt-request' });
  release([]); await capabilities.close(); assert.equal(capabilities.busy, false);
  assert.deepEqual(await readdir(join(directory, 'capability-inputs')), []);
});

test('OCR cancellation uses the isolated loaded model fallback and model failures remove uploads', async t => {
  let release, began;
  const started = new Promise(resolve => { began = resolve; });
  const blocks = new Promise(resolve => { release = resolve; });
  const { capabilities, weights, calls, directory, sdk } = await fixture(t, { ocr: () => { began(); return { blocks }; } });
  await capabilities.configure({ capability: 'ocr', modelPath: weights, detectorPath: weights });
  const requestId = uuid(), running = capabilities.run({ requestId, capability: 'ocr', upload: image() });
  await started; capabilities.cancel(requestId); await assert.rejects(running, /cancelled/);
  assert.deepEqual(calls.find(([kind]) => kind === 'cancel')[1], { modelId: calls.find(([kind]) => kind === 'load') ? 'model-1' : '' });
  release([]); await capabilities.close();
  sdk.loadModel = () => Promise.reject(new Error('Native backend unavailable'));
  await assert.rejects(capabilities.run({ requestId: uuid(), capability: 'ocr', upload: image() }), /Native backend unavailable/);
  assert.deepEqual(await readdir(join(directory, 'capability-inputs')), []);
});

test('timeout rejects the caller but does not release a still-running native operation', async t => {
  let release;
  const pending = Object.assign(new Promise(resolve => { release = resolve; }), { requestId: 'timeout-native-id' });
  const { capabilities, weights, calls } = await fixture(t, { transcribe: () => pending });
  await capabilities.configure({ capability: 'transcribe', modelPath: weights });
  await assert.rejects(capabilities.run({ requestId: uuid(), capability: 'transcribe', upload: wav(), timeoutMs: 1000 }), /timed out/);
  assert.equal(capabilities.busy, true);
  assert.deepEqual(calls.find(([kind]) => kind === 'cancel')[1], { requestId: 'timeout-native-id' });
  release([]); await capabilities.close(); assert.equal(capabilities.busy, false);
});
