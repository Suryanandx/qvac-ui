import { mkdir, open, realpath, stat, writeFile, unlink } from 'node:fs/promises';
import { statSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, basename, dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { totalmem } from 'node:os';
import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 128 * 1024 * 1024;
const kinds = ['transcribe', 'tts', 'bci', 'ocr', 'classify', 'decide'];
const require = createRequire(import.meta.url);
const descriptions = {
  transcribe: ['Transcription / STT', 'whispercpp-transcription', 'Local Whisper GGML/GGUF weights. PCM16 WAV, mono/stereo, 8–48 kHz, at most 120 seconds.'],
  tts: ['Text to speech', 'tts-ggml', 'Local Parler or Supertonic GGUF with embedded voice assets. No voice cloning.'],
  bci: ['BCI transcription', 'bci-whispercpp-transcription', 'Research recordings only: local BCI Whisper and embedder weights, matching session day index. Not medical interpretation.'],
  ocr: ['Optical character recognition', 'ggml-ocr', 'Local EasyOCR recognizer plus CRAFT detector, or DocTR recognizer plus DBNet detector. PNG/JPEG up to 16 megapixels.'],
  classify: ['Image classification', 'ggml-classification', 'Local GGUF classifier. Labels come from its weights; the bundled MobileNet model uses food/report/other.'],
  decide: ['Decision support', 'llamacpp-decision', 'Local LAYA decision checkpoint, typed questions and supplied context. Results are advisory and never execute tools.']
};
export const capabilityConfigSchema = z.object({
  capability: z.enum(kinds), modelPath: z.string().min(1).max(2048), detectorPath: z.string().min(1).max(2048).optional(),
  embedderPath: z.string().min(1).max(2048).optional(), ttsEngine: z.enum(['parler', 'supertonic']).optional(), pipeline: z.enum(['easyocr', 'doctr']).optional()
}).strict();
const question = z.discriminatedUnion('type', [
  z.object({ type: z.literal('choice'), instructions: z.string().min(1).max(1200), criteria: z.array(z.string().min(1).max(160)).min(2).max(12) }).strict(),
  z.object({ type: z.literal('score'), instructions: z.string().min(1).max(1200), criteria: z.array(z.string().min(1).max(160)).min(2).max(12) }).strict(),
  z.object({ type: z.literal('noul'), instructions: z.string().min(1).max(1200) }).strict()
]);
export const capabilityRunSchema = z.object({
  requestId: z.string().uuid(), capability: z.enum(kinds),
  upload: z.object({ name: z.string().min(1).max(200), base64: z.string().min(4).max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4) }).strict().optional(),
  text: z.string().min(1).max(8000).optional(), dayIndex: z.number().int().min(0).max(10000).optional(),
  questions: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/), question).refine(v => Object.keys(v).length > 0 && Object.keys(v).length <= 8, 'Provide 1–8 questions').optional(),
  timeoutMs: z.number().int().min(1000).max(300000).default(120000)
}).strict().superRefine((v, ctx) => {
  const fail = message => ctx.addIssue({ code: 'custom', message });
  if (['transcribe', 'bci', 'ocr', 'classify'].includes(v.capability) && !v.upload) fail('This capability requires an uploaded file');
  if (['tts', 'decide'].includes(v.capability) && !v.text?.trim()) fail('This capability requires text');
  if (v.capability === 'tts' && v.text?.length > 1500) fail('Speech text is limited to 1500 characters');
  if (v.capability === 'bci' && v.dayIndex === undefined) fail('BCI requires the recording session dayIndex');
  if (v.capability === 'decide' && !v.questions) fail('Decision support requires typed questions');
  if (!['transcribe', 'bci', 'ocr', 'classify'].includes(v.capability) && v.upload) fail('This capability does not accept uploads');
  if (v.capability !== 'bci' && v.dayIndex !== undefined) fail('dayIndex is only valid for BCI');
  if (v.capability !== 'decide' && v.questions !== undefined) fail('questions are only valid for decision support');
});

export function validateWav(bytes) {
  if (bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE' || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('Upload must be a complete PCM16 WAV file');
  let format, dataLength = 0;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', p, p + 4), size = bytes.readUInt32LE(p + 4), start = p + 8;
    if (size > bytes.length - start) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') {
      if (size < 16 || format) throw new Error('Invalid WAV format chunk');
      format = { encoding: bytes.readUInt16LE(start), channels: bytes.readUInt16LE(start + 2), sampleRate: bytes.readUInt32LE(start + 4), byteRate: bytes.readUInt32LE(start + 8), blockAlign: bytes.readUInt16LE(start + 12), bits: bytes.readUInt16LE(start + 14) };
    }
    if (id === 'data') dataLength += size;
    p = start + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.bits !== 16 || ![1, 2].includes(format.channels) || format.sampleRate < 8000 || format.sampleRate > 48000 || format.blockAlign !== format.channels * 2 || format.byteRate !== format.sampleRate * format.blockAlign || !dataLength || dataLength % format.blockAlign) throw new Error('Use PCM16 WAV, mono/stereo, 8–48 kHz');
  const seconds = dataLength / format.byteRate;
  if (seconds > 3600) throw new Error('Audio is limited to 60 minutes');
  return { extension: '.wav', mime: 'audio/wav', ...format, seconds };
}

export function validateNeural(bytes) {
  if (bytes.length < 12) throw new Error('BCI recording lacks the 8-byte header and signal data');
  const timesteps = bytes.readUInt32LE(0), channels = bytes.readUInt32LE(4);
  if (timesteps < 1 || timesteps > 2900 || channels < 1 || channels > 4096 || bytes.length !== 8 + timesteps * channels * 4) throw new Error('Invalid BCI layout: uint32LE timesteps/channels followed by exact row-major float32 samples; at most 2900 timesteps');
  for (let p = 8; p < bytes.length; p += 4) if (!Number.isFinite(bytes.readFloatLE(p))) throw new Error('BCI samples must be finite float32 values');
  return { extension: '.bin', mime: 'application/octet-stream', timesteps, channels };
}

export function validateImage(bytes) {
  let width, height, extension;
  if (bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR' && bytes.readUInt32BE(8) === 13) {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); extension = '.png';
    let end = false;
    for (let p = 8; p + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(p); if (length > bytes.length - p - 12) throw new Error('Truncated PNG');
      if (bytes.toString('ascii', p + 4, p + 8) === 'IEND') { end = length === 0 && p + 12 === bytes.length; break; }
      p += length + 12;
    }
    if (!end) throw new Error('Incomplete PNG');
  } else if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) {
    extension = '.jpg';
    for (let p = 2; p + 4 <= bytes.length;) {
      if (bytes[p++] !== 255) throw new Error('Invalid JPEG marker');
      while (bytes[p] === 255) p++;
      const marker = bytes[p++]; if (marker === 218 || marker === 217) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (p + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(p); if (size < 2 || p + size > bytes.length) throw new Error('Truncated JPEG');
      if ([192, 193, 194].includes(marker) && size >= 8) { height = bytes.readUInt16BE(p + 3); width = bytes.readUInt16BE(p + 5); break; }
      p += size;
    }
  }
  if (!extension || !width || !height || width > 8192 || height > 8192 || width * height > 16_000_000) throw new Error('Use a PNG/JPEG image of at most 16 megapixels and 8192 pixels per side');
  return { extension, mime: extension === '.png' ? 'image/png' : 'image/jpeg', width, height };
}

export function decodeUpload(upload, capability) {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.base64)) throw new Error('Upload must contain canonical base64 bytes');
  const bytes = Buffer.from(upload.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES || bytes.toString('base64') !== upload.base64) throw new Error('Invalid upload or file exceeds 128 MiB');
  const metadata = capability === 'bci' ? validateNeural(bytes) : ['ocr', 'classify'].includes(capability) ? validateImage(bytes) : validateWav(bytes);
  return { bytes, metadata, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export function encodeWav(samples, rate) {
  if (!Number.isInteger(rate) || rate < 8000 || rate > 96000 || !samples?.length || samples.length > rate * 120) throw new Error('TTS returned invalid or excessive audio');
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) { if (!Number.isFinite(samples[i])) throw new Error('TTS returned non-finite PCM'); bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i]))), 44 + i * 2); }
  return { base64: bytes.toString('base64'), mime: 'audio/wav', sampleRate: rate, seconds: samples.length / rate };
}

async function localWeights(value, ggufOnly = false, embedder = false) {
  if (!isAbsolute(value) || /\0/.test(value)) throw new Error('Models must use absolute local filesystem paths');
  const path = await realpath(value), info = await stat(path);
  if (!info.isFile() || info.size < 8) throw new Error('Model path must be a nonempty regular file');
  const file = await open(path, 'r');
  try { const bytes = Buffer.alloc(4); await file.read(bytes, 0, 4, 0); if (!(embedder ? ['EICB'] : ggufOnly ? ['GGUF'] : ['GGUF', 'ggml', 'lmgg', 'ggmf', 'fmgg', 'ggjt', 'tjgg']).includes(bytes.toString('ascii'))) throw new Error(embedder ? 'Expected BCI embedder weights with EICB magic (uint32LE 0x42434945)' : 'Expected GGUF or supported GGML model weights'); }
  finally { await file.close(); }
  return { path, name: basename(path), bytes: info.size, modifiedAt: info.mtime.toISOString(), ...(embedder ? { role: 'embedder' } : {}) };
}

/** No backend action accepts arbitrary SDK configuration, remote model sources, or filesystem output paths. */
export class Capabilities {
  constructor(directory, { models, getSdk = () => import('@qvac/sdk'), onEvent = () => {} } = {}) {
    this.directory = join(directory, 'capability-inputs'); this.models = models; this.getSdk = getSdk; this.onEvent = onEvent; this.configs = {}; this.active = null;
    // This small classifier ships as a local asset inside the pinned addon package; no registry/download request.
    try {
      const path = realpathSync(join(dirname(require.resolve('@qvac/classification-ggml')), 'weights', 'mobilenetv3_3class_v3_fp16.gguf')), info = statSync(path);
      if (info.isFile()) this.configs.classify = { config: { capability: 'classify', modelPath: path }, artifacts: [{ path, name: basename(path), bytes: info.size, modifiedAt: info.mtime.toISOString() }], bundled: true };
    } catch { /* Incomplete SDK installs remain explicitly unconfigured. */ }
  }
  get busy() { return Boolean(this.active); }
  info() {
    return { busy: this.busy, activeRequestId: this.active?.requestId || null, status: this.active?.status || 'idle', capabilities: [
      ...kinds.map(id => ({ id, label: descriptions[id][0], modelType: descriptions[id][1], requirements: descriptions[id][2], configured: Boolean(this.configs[id]), bundled: Boolean(this.configs[id]?.bundled), cancellation: ['ocr', 'classify'].includes(id) ? 'discard-result-and-await-native-cleanup' : 'cooperative-request-cancellation', config: this.configs[id]?.config || null }))
    ] };
  }
  async configure(input) {
    if (this.busy) throw new Error('Wait for the capability run to finish before changing models');
    const config = capabilityConfigSchema.parse(input), id = config.capability;
    if ((config.detectorPath || config.pipeline) && id !== 'ocr') throw new Error('Detector and pipeline settings only apply to OCR');
    if (config.embedderPath && id !== 'bci') throw new Error('Embedder settings only apply to BCI');
    if (config.ttsEngine && id !== 'tts') throw new Error('TTS engine only applies to speech synthesis');
    if (id === 'ocr' && !config.detectorPath) throw new Error('OCR requires a local detector model path');
    if (id === 'bci' && !config.embedderPath) throw new Error('BCI requires a local neural embedder model path');
    const main = await localWeights(config.modelPath, !['transcribe', 'bci'].includes(id)); config.modelPath = main.path;
    const artifacts = [main];
    for (const field of ['detectorPath', 'embedderPath']) if (config[field]) { const weight = await localWeights(config[field], field === 'detectorPath', field === 'embedderPath'); config[field] = weight.path; artifacts.push(weight); }
    if (id === 'tts') config.ttsEngine ||= 'parler';
    if (id === 'ocr') config.pipeline ||= 'easyocr';
    if (artifacts.reduce((sum, a) => sum + a.bytes, 0) * 2 + 512 * 1024 ** 2 > totalmem() * .5) throw new Error('Weights exceed the prototype memory budget; use smaller models');
    this.configs[id] = { config, artifacts }; return this.info();
  }
  cancel(requestId) {
    if (this.active?.requestId !== requestId) return { cancelled: false };
    this.active.status = 'cancelling'; this.active.controller.abort(new Error('Capability run cancelled')); return { cancelled: true, requestId };
  }
  async run(input, { signal } = {}) {
    const request = capabilityRunSchema.parse(input);
    if (this.busy) throw new Error('A capability run is already active');
    if (this.models?.busy) throw new Error('Wait for the current chat response before running a capability');
    if (!this.configs[request.capability]) throw new Error(`Configure local ${request.capability} weights first; no models are downloaded automatically`);
    const upload = request.upload ? decodeUpload(request.upload, request.capability) : null;
    const controller = new AbortController(), active = { requestId: request.requestId, controller, status: 'running' }; this.active = active;
    const cancel = () => controller.abort(signal.reason || new Error('Request disconnected'));
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const timer = setTimeout(() => { active.status = 'cancelling'; controller.abort(new Error('Capability run timed out')); }, request.timeoutMs);
    const task = this.execute(request, upload, controller.signal).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (this.active === active) this.active = null; });
    active.task = task;
    // Return promptly on cancellation; keep the serialization lock until native execution and cleanup really finish.
    let rejectAbort;
    const aborted = new Promise((_, reject) => { rejectAbort = () => reject(controller.signal.reason); controller.signal.addEventListener('abort', rejectAbort, { once: true }); if (controller.signal.aborted) rejectAbort(); });
    try { return await Promise.race([task, aborted]); }
    finally { controller.signal.removeEventListener('abort', rejectAbort); }
  }
  async execute(request, upload, signal) {
    let path;
    const startedAt = new Date().toISOString(), started = performance.now(), steps = [];
    try {
      signal.throwIfAborted();
      const sdk = await this.getSdk(); signal.throwIfAborted();
      if (upload) { await mkdir(this.directory, { recursive: true, mode: 0o700 }); path = join(this.directory, randomUUID() + upload.metadata.extension); await writeFile(path, upload.bytes, { mode: 0o600, flag: 'wx' }); }
      const use = async (id, operation) => {
        signal.throwIfAborted();
        const configured = this.configs[id], c = configured.config;
        // Recheck after configuration so a deleted/replaced file produces an explicit local-model error.
        const artifacts = [];
        for (const artifact of configured.artifacts) { const current = await localWeights(artifact.path, !['transcribe', 'bci'].includes(id), artifact.role === 'embedder'); if (current.bytes !== artifact.bytes || current.modifiedAt !== artifact.modifiedAt) throw new Error('Model file changed; configure it again before inference'); artifacts.push(current); }
        const modelConfig = id === 'transcribe' ? { language: 'auto', n_threads: 4, contextParams: { use_gpu: false } }
          : id === 'bci' ? { whisperConfig: { language: 'en', n_threads: 4, temperature: 0 }, bciConfig: { day_idx: request.dayIndex }, contextParams: { use_gpu: false }, embedderModelSrc: c.embedderPath }
          : id === 'ocr' ? { pipelineType: c.pipeline, detectorModelSrc: c.detectorPath, langList: ['en'], recognizerBatchSize: 1 }
          : id === 'tts' ? { ttsEngine: c.ttsEngine, voice: c.ttsEngine === 'parler' ? 'Laura' : 'F1', seed: 42, ...(c.ttsEngine === 'supertonic' ? { language: 'en', ttsNumInferenceSteps: 5 } : {}) }
          : id === 'decide' ? { device: 'cpu', gpu_layers: 0, threads: 4 } : {};
        let modelId, operationId; const requestIds = [];
        const cancel = () => { if (operationId || modelId) Promise.resolve(sdk.cancel(operationId ? { requestId: operationId } : { modelId })).catch(() => {}); };
        signal.addEventListener('abort', cancel);
        const track = run => { operationId = run?.requestId; if (operationId) requestIds.push(operationId); if (signal.aborted) cancel(); return run; };
        try {
          const loading = track(sdk.loadModel({ modelSrc: c.modelPath, modelType: descriptions[id][1], modelConfig, modelFitPolicy: 'off' }));
          modelId = await loading; operationId = null; signal.throwIfAborted();
          const result = await operation(sdk, modelId, track); signal.throwIfAborted();
          steps.push({ capability: id, modelType: descriptions[id][1], requestIds, artifacts: artifacts.map(({ path: _path, ...a }) => a), ...(id === 'bci' ? { dayIndex: request.dayIndex } : {}), ...(id === 'tts' ? { engine: c.ttsEngine } : {}), ...(id === 'ocr' ? { pipeline: c.pipeline } : {}) });
          return result;
        } finally {
          signal.removeEventListener('abort', cancel);
          if (modelId) await sdk.unloadModel({ modelId });
        }
      };
      const transcribe = () => use('transcribe', async (sdk, modelId, track) => {
        const call = track(sdk.transcribe({ modelId, audioChunk: path, metadata: true })); const segments = await call;
        return { text: segments.map(s => s.text).join('').trim(), segments };
      });
      const speak = text => use('tts', async (sdk, modelId, track) => {
        const call = track(sdk.textToSpeech({ modelId, text, inputType: 'text', stream: false }));
        const [samples, rate, done] = await Promise.all([call.buffer, call.sampleRate, call.done]);
        if (done === false) throw new Error('Speech synthesis ended before completion');
        return { text, audio: encodeWav(samples, rate) };
      });
      let result;
      if (request.capability === 'transcribe') result = await transcribe();
      else if (request.capability === 'tts') result = await speak(request.text);
      else if (request.capability === 'bci') result = await use('bci', async (sdk, modelId, track) => { const segments = await track(sdk.bciTranscribe({ modelId, neuralData: path, metadata: true })); return { text: segments.map(s => s.text).join('').trim(), segments, dayIndex: request.dayIndex }; });
      else if (request.capability === 'ocr') result = await use('ocr', async (sdk, modelId, track) => { const blocks = await track(sdk.ocr({ modelId, image: path, options: { paragraph: false }, stream: false })).blocks; return { text: blocks.map(b => b.text).join('\n'), blocks }; });
      else if (request.capability === 'classify') result = await use('classify', async (sdk, modelId, track) => ({ classifications: await track(sdk.classify({ modelId, image: upload.bytes, topK: 5 })) }));
      else if (request.capability === 'decide') result = await use('decide', async (sdk, modelId, track) => ({ decision: await track(sdk.decide({ modelId, state: request.text, questions: request.questions, maxLen: 2048, headMaxLen: 512 })), advisory: true, actionsExecuted: false }));
      signal.throwIfAborted();
      const provenance = { provider: 'qvac-local', sdkContract: '@qvac/sdk@0.22.0', requestId: request.requestId, capability: request.capability, startedAt, completedAt: new Date().toISOString(), elapsedMs: Math.round(performance.now() - started), steps,
        ...(upload ? { input: { name: basename(request.upload.name), sha256: upload.sha256, bytes: upload.bytes.length, ...upload.metadata } } : { input: { textSha256: createHash('sha256').update(request.text).digest('hex'), characters: request.text.length } }),
        ...(request.questions ? { questionsSha256: createHash('sha256').update(JSON.stringify(request.questions)).digest('hex'), questionIds: Object.keys(request.questions) } : {}),
        advisoryOnly: true, toolsExecuted: false, networkModelDownloads: false };
      this.onEvent('capability.completed', provenance);
      return { requestId: request.requestId, capability: request.capability, result, provenance };
    } catch (error) { this.onEvent('capability.failed', { requestId: request.requestId, capability: request.capability, cancelled: signal.aborted, error: String(error.message).slice(0, 500) }); throw error; }
    finally { if (path) await unlink(path).catch(() => {}); }
  }
  async close() { if (this.active) { this.cancel(this.active.requestId); await this.active.task.catch(() => {}); } }
}
