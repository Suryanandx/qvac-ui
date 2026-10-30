// Native pipelines behind the use-case tools: meeting notes with speakers,
// field extraction, translation, the private vault, generated media and
// saved documents. Each pipeline loads its QVAC models, runs, and unloads,
// serialized so only one heavy job uses memory at a time.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { AFRICAN_LANGUAGES, CATALOG, TRANSLATION_LANGUAGES, resolveAsset } from './catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Decode PCM16 WAV (any rate, mono/stereo) to mono Float32 samples. */
export function decodeWav(bytes) {
  let fmt, data;
  for (let p = 12; p + 8 <= bytes.length;) {
    const id = bytes.toString('ascii', p, p + 4), size = bytes.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: bytes.readUInt16LE(p + 10), rate: bytes.readUInt32LE(p + 12), bits: bytes.readUInt16LE(p + 22) };
    if (id === 'data') data = bytes.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size % 2);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error('Expected a PCM16 WAV file');
  const frames = Math.floor(data.length / (2 * fmt.channels)), out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) { let sum = 0; for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2); out[i] = sum / fmt.channels / 32768; }
  return { samples: out, rate: fmt.rate };
}
export function resample(samples, from, to = 16000) {
  if (from === to) return samples;
  const length = Math.floor(samples.length * to / from), out = new Float32Array(length);
  for (let i = 0; i < length; i++) { const p = i * from / to, a = Math.floor(p), f = p - a; out[i] = (samples[a] || 0) * (1 - f) + (samples[a + 1] || 0) * f; }
  return out;
}
export function encodeWav16(samples, rate = 16000) {
  const bytes = Buffer.alloc(44 + samples.length * 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return bytes;
}
/**
 * Parse Sortformer output lines, "Speaker 0: 00:00:05.440 - 00:00:10.880" (or "0.40s - 3.12s"),
 * and merge adjacent turns of one speaker.
 */
export function parseSpeakers(text) {
  const seconds = t => t.includes(':') ? t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0) : Number(t);
  const segs = [];
  for (const line of String(text).split('\n')) { const m = line.match(/Speaker (\d+):\s*([\d:.]+)s?\s*-\s*([\d:.]+)s?/); if (m) segs.push({ speaker: Number(m[1]) + 1, start: seconds(m[2]), end: seconds(m[3]) }); }
  segs.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const s of segs) { const last = merged.at(-1); if (last && last.speaker === s.speaker && s.start - last.end < 1.0) last.end = Math.max(last.end, s.end); else merged.push({ ...s }); }
  return merged.filter(s => s.end - s.start >= 0.4);
}
export function chunkText(text, size = 900, overlap = 120) {
  const clean = String(text).replace(/\s+\n/g, '\n').trim(), chunks = [];
  for (let start = 0; start < clean.length; start += size - overlap) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) { const cut = clean.lastIndexOf(' ', end); if (cut > start + size / 2) end = cut; }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = end - (size - overlap);
  }
  return chunks.filter(Boolean);
}
const cosine = (a, b) => { let dot = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return dot / (Math.sqrt(na * nb) || 1); };

export const meetingSchema = z.object({
  summary: z.string().max(1500), decisions: z.array(z.string().max(400)).max(15),
  actionItems: z.array(z.object({ owner: z.string().max(80), task: z.string().max(300), due: z.string().max(80) })).max(25),
  openQuestions: z.array(z.string().max(300)).max(10)
});

export class Studio {
  constructor({ store, directory, models, capabilities }) {
    this.store = store; this.models = models; this.capabilities = capabilities;
    this.work = join(directory, 'capability-inputs'); this.media = join(directory, 'media'); this.exports = join(directory, 'exports');
    this.queue = Promise.resolve();
  }
  /** Run native work one job at a time. */
  exclusive(fn) { const run = this.queue.then(fn, fn); this.queue = run.catch(() => {}); return run; }
  async sdk() { return this.models.getSDK(); }
  async cached(constant) {
    const sdk = await this.sdk(), meta = sdk[constant];
    if (!meta?.src) return false;
    const info = await sdk.getModelInfo({ name: meta.name }).catch(() => null);
    return Boolean(info?.cacheFiles?.length && info.cacheFiles.every(f => f.isCached));
  }
  async entryInstalled(id) {
    const entry = CATALOG.find(e => e.id === id);
    for (const asset of Object.values(entry.assets)) {
      if (typeof asset !== 'string') return false;
      if (!(await this.cached(asset)) && !(asset === 'QWEN3_4B_Q4_K_M' && (await this.localQwen()))) return false;
    }
    return true;
  }
  /** Installed state for catalog entries that may be pinned URLs (recorded as downloads) or registry constants. */
  async installed(id) {
    const entry = CATALOG.find(e => e.id === id);
    for (const asset of Object.values(entry.assets)) {
      if (typeof asset === 'string') { if (!(await this.cached(asset))) return false; }
      else if (!this.store.list('model-download').some(d => d.key === asset.file)) return false;
    }
    return true;
  }
  src(id, slot = 'modelSrc') { return resolveAsset(this.sdkModule, CATALOG.find(e => e.id === id).assets[slot]).src; }
  /** A one-shot completion on a specialist model (QVAC Psy), loaded and unloaded around the call. */
  async specialist(id, history, { signal, maxTokens = 800, projection = false } = {}) {
    this.sdkModule = await this.sdk();
    return this.exclusive(() => this.withModel({ modelSrc: this.src(id), modelType: 'llamacpp-completion', modelConfig: { ctx_size: 4096, device: 'gpu', gpu_layers: 99, ...(projection ? { projectionModelSrc: this.src(id, 'projectionModelSrc') } : {}) } }, async (s, modelId) => {
      const run = s.completion({ modelId, history, stream: true, captureThinking: true, generationParams: { temp: .2, predict: maxTokens } });
      let text = ''; for await (const e of run.events) { signal?.throwIfAborted(); if (e.type === 'contentDelta') text += e.text; }
      await run.final; return text.replace(/<\/?think>/g, '').trim();
    }, signal));
  }
  async medical(question, signal) {
    const id = (await this.installed('medpsy-4b')) ? 'medpsy-4b' : (await this.installed('medpsy')) ? 'medpsy' : null;
    if (!id) throw new Error('Download "QVAC MedPsy" in Settings → Models to ask the medical model');
    return { model: CATALOG.find(e => e.id === id).label, answer: await this.specialist(id, [{ role: 'system', content: 'You are a careful medical information assistant. Give clear, evidence-based educational information, mention when to see a clinician or seek emergency care, and do not diagnose.' }, { role: 'user', content: question }], { signal, maxTokens: 900 }) };
  }
  async lookLite(imagePath, question, signal) {
    if (!(await this.installed('visionpsy'))) throw new Error('This brain cannot see images. Use "Qwen3.5 4B · vision" or download "QVAC VisionPsy" in Settings → Models.');
    return this.specialist('visionpsy', [{ role: 'user', content: question, attachments: [{ path: imagePath }] }], { signal, maxTokens: 500, projection: true });
  }
  async localQwen() { try { await readFile(join(root, 'models', 'Qwen3-4B-Q4_K_M.gguf.receipt.json')); return join(root, 'models', 'Qwen3-4B-Q4_K_M.gguf'); } catch { return null; } }
  async withModel(params, fn, signal) {
    const sdk = await this.sdk();
    signal?.throwIfAborted();
    const loading = sdk.loadModel({ modelFitPolicy: 'off', ...params });
    const cancel = () => sdk.cancel({ requestId: loading.requestId }).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    let modelId;
    try { modelId = await loading; signal?.throwIfAborted(); return await fn(sdk, modelId); }
    finally { signal?.removeEventListener('abort', cancel); if (modelId) await sdk.unloadModel({ modelId }).catch(() => {}); }
  }
  async tempWav(samples) { await mkdir(this.work, { recursive: true, mode: 0o700 }); const path = join(this.work, `${randomUUID()}.wav`); await writeFile(path, encodeWav16(samples), { mode: 0o600 }); return path; }

  /** Transcribe with Whisper small + Silero VAD when installed, else the configured speech model. */
  async transcribeFile(path, signal) {
    const sdk = await this.sdk();
    if (await this.cached('WHISPER_SMALL_Q8_0')) {
      const vad = (await this.cached('VAD_SILERO_5_1_2')) ? { vadModelSrc: sdk.VAD_SILERO_5_1_2, vad_params: { threshold: .5, min_speech_duration_ms: 250, min_silence_duration_ms: 400, speech_pad_ms: 120 } } : {};
      return this.withModel({ modelSrc: sdk.WHISPER_SMALL_Q8_0, modelType: 'whispercpp-transcription', modelConfig: { language: 'auto', n_threads: 6, ...vad, contextParams: { use_gpu: false } } },
        async (s, modelId) => { const segments = await s.transcribe({ modelId, audioChunk: path, metadata: true }); return { text: segments.map(x => x.text).join('').trim(), segments: segments.map(x => ({ start: x.startMs / 1000, end: x.endMs / 1000, text: x.text.trim() })), model: 'Whisper small' }; }, signal);
    }
    if (this.capabilities?.info().capabilities.find(c => c.id === 'transcribe')?.configured) {
      const { result } = await this.capabilities.run({ requestId: randomUUID(), capability: 'transcribe', upload: { name: 'audio.wav', base64: (await readFile(path)).toString('base64') } }, { signal });
      return { text: result.text.trim(), segments: result.segments.map(x => ({ start: x.startMs / 1000, end: x.endMs / 1000, text: x.text.trim() })), model: 'configured speech model' };
    }
    throw new Error('Install "Whisper small" in Settings → Models, or configure a speech model');
  }

  /** Meeting notes: speaker turns (Sortformer) → per-turn Whisper → structured notes from the brain. */
  async meeting(attachment, filePath, signal, onStep = () => {}) {
    return this.exclusive(async () => {
      const { samples, rate } = decodeWav(await readFile(filePath)), mono16 = resample(samples, rate, 16000);
      const wav16 = await this.tempWav(mono16), temps = [wav16];
      try {
        let turns = null;
        if (await this.cached('PARAKEET_SORTFORMER_4SPK_V2_1_Q8_0')) {
          onStep('Finding speakers');
          const sdk = await this.sdk();
          const raw = await this.withModel({ modelSrc: sdk.PARAKEET_SORTFORMER_4SPK_V2_1_Q8_0, modelType: 'parakeet-transcription' }, (s, modelId) => s.transcribe({ modelId, audioChunk: wav16 }), signal);
          turns = parseSpeakers(typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(r => r.text ?? r).join('\n') : String(raw));
        }
        onStep('Transcribing');
        let lines;
        if (turns?.length > 1) {
          const sdk = await this.sdk(), small = await this.cached('WHISPER_SMALL_Q8_0');
          if (!small) throw new Error('Install "Whisper small" in Settings → Models for meeting notes');
          lines = await this.withModel({ modelSrc: sdk.WHISPER_SMALL_Q8_0, modelType: 'whispercpp-transcription', modelConfig: { language: 'auto', n_threads: 6, contextParams: { use_gpu: false } } }, async (s, modelId) => {
            const out = [];
            for (const t of turns) {
              signal?.throwIfAborted();
              const slice = mono16.subarray(Math.floor(t.start * 16000), Math.ceil(t.end * 16000));
              if (slice.length < 16000 * .4) continue;
              const path = await this.tempWav(slice); temps.push(path);
              const segs = await s.transcribe({ modelId, audioChunk: path, metadata: true });
              const text = segs.map(x => x.text).join('').replace(/\[(?:blank_audio|silence|music|noise)\]/gi, '').trim();
              if (text) out.push({ speaker: `Speaker ${t.speaker}`, start: t.start, end: t.end, text });
            }
            return out;
          }, signal);
        } else {
          const t = await this.transcribeFile(wav16, signal);
          lines = t.segments.filter(s => s.text).map(s => ({ speaker: null, ...s }));
        }
        if (!lines.length) throw new Error('No speech was recognized in this recording');
        const transcript = lines.map(l => `${l.speaker ? l.speaker + ': ' : ''}${l.text}`).join('\n');
        onStep('Writing notes');
        const notes = await this.models.structured([
          { role: 'system', content: 'You write accurate meeting notes from a transcript. Only use facts stated in the transcript. Use "unspecified" for missing owners or due dates. Speaker labels are anonymous; if someone states their name, you may use it.' },
          { role: 'user', content: `Transcript of ${attachment.name}:\n${transcript.slice(0, 24000)}` }
        ], meetingSchema, { signal, maxTokens: 1500 });
        return { lines, transcript, notes, speakers: new Set(lines.map(l => l.speaker).filter(Boolean)).size, seconds: mono16.length / 16000 };
      } finally { await Promise.all(temps.map(p => rm(p, { force: true }))); }
    });
  }

  /** Extract named fields from an image (vision brain, else OCR text) or text document. */
  async extract({ fields, imagePath, text, signal }) {
    const shape = Object.fromEntries(fields.map(f => [f.replace(/[^\w]/g, '_').slice(0, 40), z.string().max(2000).nullable()]));
    const schema = z.object(shape);
    const prompt = `Extract these fields: ${Object.keys(shape).join(', ')}. Copy values exactly as written. Use null when a field is not present. For lists (like line items) write one item per line.`;
    const history = imagePath && this.models.vision
      ? [{ role: 'user', content: prompt, attachments: [{ path: imagePath }] }]
      : [{ role: 'system', content: 'You extract structured fields from documents. Never guess.' }, { role: 'user', content: `${prompt}\n\nDocument:\n${String(text || '').slice(0, 16000)}` }];
    return this.models.structured(history, schema, { signal, maxTokens: 1200 });
  }

  /** Bergamot translation (pivoting through English); African languages use QVAC TranslatePsy-AfriSLM. */
  async translate(text, from, to, signal) {
    if (from === to) return text;
    if (AFRICAN_LANGUAGES[from] || AFRICAN_LANGUAGES[to]) {
      if (from !== 'en' && to !== 'en') return this.translate(await this.translate(text, from, 'en', signal), 'en', to, signal);
      if (!(await this.installed('translatepsy-afri'))) throw new Error('Download "QVAC TranslatePsy AfriSLM" in Settings → Models for African languages');
      const name = c => AFRICAN_LANGUAGES[c] || TRANSLATION_LANGUAGES[c] || 'English', src = name(from), dst = name(to);
      // The strict prompt from the model card (EMNLP 2026 paper).
      return this.specialist('translatepsy-afri', [
        { role: 'system', content: `You are a professional ${src} to ${dst} translator. Your goal is to accurately convey the meaning and nuances of the original ${src} text while adhering to ${dst} grammar, vocabulary, and cultural sensitivities. Produce only the ${dst} translation, without any additional explanations or commentary. ` },
        { role: 'user', content: `Please translate the following ${src} text into ${dst}: ${text}.\n\nTranslation:` }
      ], { signal, maxTokens: Math.min(2000, text.length * 2 + 100) });
    }
    if (from !== 'en' && to !== 'en') return this.translate(await this.translate(text, from, 'en', signal), 'en', to, signal);
    const constant = `BERGAMOT_${from.toUpperCase()}_${to.toUpperCase()}`;
    const sdk = await this.sdk();
    if (!sdk[constant]) throw new Error(`No ${from}→${to} translation model exists in QVAC's catalog`);
    if (!(await this.cached(constant))) throw new Error(`Download the ${from}→${to} translation pair in Settings → Models first`);
    const paragraphs = text.split(/\n{2,}/);
    return this.exclusive(() => this.withModel({ modelSrc: sdk[constant], modelConfig: { engine: 'Bergamot', from, to } }, async (s, modelId) => {
      const out = [];
      for (const p of paragraphs) out.push(p.trim() ? await s.translate({ modelId, text: p, modelType: 'nmtcpp-translation', stream: false }).text : p);
      return out.join('\n\n');
    }, signal));
  }

  /** Private vault: EmbeddingGemma vectors stored in the workspace SQLite, cosine search in process. */
  async embed(texts, signal) {
    const sdk = await this.sdk();
    if (!(await this.cached('EMBEDDINGGEMMA_300M_Q8_0'))) throw new Error('Install "EmbeddingGemma 300M" in Settings → Models to use the vault');
    return this.withModel({ modelSrc: sdk.EMBEDDINGGEMMA_300M_Q8_0, modelType: 'llamacpp-embedding' }, async (s, modelId) => {
      const out = [];
      for (let i = 0; i < texts.length; i += 16) { signal?.throwIfAborted(); const r = await s.embed({ modelId, text: texts.slice(i, i + 16) }); out.push(...(r.embeddings || r.embedding || [])); }
      return out;
    }, signal);
  }
  vaultInfo() {
    const chunks = this.store.list('vault-chunk'), docs = new Map();
    for (const c of chunks) docs.set(c.documentId, { documentId: c.documentId, name: c.name, chunks: (docs.get(c.documentId)?.chunks || 0) + 1 });
    return { documents: [...docs.values()], chunks: chunks.length, pending: this.store.list('document').filter(d => !docs.has(d.id)).length };
  }
  async indexDocuments(signal) {
    return this.exclusive(async () => {
      const done = new Set(this.store.list('vault-chunk').map(c => c.documentId)), todo = this.store.list('document').filter(d => !done.has(d.id));
      let added = 0;
      for (const doc of todo) {
        const chunks = chunkText(doc.content).slice(0, 400);
        if (!chunks.length) continue;
        const vectors = await this.embed(chunks.map(c => `title: ${doc.name} | text: ${c}`), signal);
        this.store.transaction(() => chunks.forEach((text, i) => this.store.put('vault-chunk', { documentId: doc.id, name: doc.name, chunk: i + 1, text, vector: Buffer.from(new Float32Array(vectors[i]).buffer).toString('base64') })));
        added += chunks.length;
      }
      this.store.log('vault.indexed', { documents: todo.length, chunks: added });
      return { documents: todo.length, chunks: added };
    });
  }
  async searchVault(query, k = 5, signal) {
    await this.indexDocuments(signal);
    const chunks = this.store.list('vault-chunk');
    if (!chunks.length) return [];
    const [q] = await this.exclusive(() => this.embed([`task: search result | query: ${query}`], signal));
    return chunks.map(c => ({ ...c, score: cosine(q, new Float32Array(new Uint8Array(Buffer.from(c.vector, 'base64')).buffer)) }))
      .sort((a, b) => b.score - a.score).slice(0, k).map(({ vector, ...c }) => c);
  }

  /** Heavy generators: the brain is unloaded first so two large models never share memory. */
  async generateImage(prompt, { width = 768, height = 768, steps = 20 } = {}, signal, onStep = () => {}) {
    if (!(await this.entryInstalled('image'))) throw new Error('Image generation is not installed. Download "FLUX.2 klein 4B" in Settings → Models (about 2.6 GB).');
    if (totalmem() < 15 * 1024 ** 3) throw new Error('Image generation needs at least 16 GB of memory');
    return this.exclusive(async () => {
      await this.models.unload();
      const sdk = await this.sdk(), llm = (await this.cached('QWEN3_4B_Q4_K_M')) ? sdk.QWEN3_4B_Q4_K_M : await this.localQwen();
      const png = await this.withModel({ modelSrc: sdk.FLUX_2_KLEIN_4B_Q4_0, modelType: 'sdcpp-generation', modelConfig: { device: 'gpu', threads: 4, llmModelSrc: llm, vaeModelSrc: sdk.FLUX_2_KLEIN_4B_VAE } }, async (s, modelId) => {
        const run = s.diffusion({ modelId, prompt, width, height, steps, guidance: 3.5, cfg_scale: 1, seed: -1 });
        for await (const p of run.progressStream) { signal?.throwIfAborted(); onStep(`Step ${p.step}/${p.totalSteps}`); }
        return (await run.outputs)[0];
      }, signal);
      return this.saveMedia(Buffer.from(png), 'png', { prompt, width, height });
    });
  }
  async generateMusic(description, seconds, signal, onStep = () => {}) {
    if (!(await this.entryInstalled('music'))) throw new Error('Music generation is not installed. Download "ACE-Step 1.5 turbo" in Settings → Models (about 3.3 GB).');
    return this.exclusive(async () => {
      await this.models.unload();
      const sdk = await this.sdk();
      const audio = await this.withModel({ modelType: 'audiogen', modelConfig: { textEncModelSrc: sdk.AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0, lmModelSrc: sdk.AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0, ditModelSrc: sdk.AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M, vaeModelSrc: sdk.AUDIOGEN_VAE_BF16, useGPU: true, inferenceSteps: 8 } }, async (s, modelId) => {
        const run = s.audioGen({ modelId, caption: description, lyrics: '[Instrumental]', seed: -1, duration: seconds });
        for await (const p of run.progressStream) { signal?.throwIfAborted(); if (p.total) onStep(`Step ${p.step}/${p.total}`); }
        return run.audio;
      }, signal);
      const pcm = Buffer.from(audio.pcm.buffer ?? audio.pcm), bytes = Buffer.alloc(44 + pcm.length), byteRate = audio.sampleRate * audio.channels * audio.bitsPerSample / 8;
      bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(audio.channels, 22);
      bytes.writeUInt32LE(audio.sampleRate, 24); bytes.writeUInt32LE(byteRate, 28); bytes.writeUInt16LE(audio.channels * audio.bitsPerSample / 8, 32); bytes.writeUInt16LE(audio.bitsPerSample, 34); bytes.write('data', 36); bytes.writeUInt32LE(pcm.length, 40); pcm.copy(bytes, 44);
      return { ...(await this.saveMedia(bytes, 'wav', { description })), seconds: pcm.length / byteRate };
    });
  }
  async saveMedia(bytes, ext, meta) {
    await mkdir(this.media, { recursive: true, mode: 0o700 });
    const record = this.store.put('media', { ext, bytes: bytes.length, ...meta });
    await writeFile(join(this.media, `${record.id}.${ext}`), bytes, { mode: 0o600 });
    return record;
  }
  /** Save text the user can download (Markdown, CSV or plain text). */
  async saveExport(title, format, content) {
    await mkdir(this.exports, { recursive: true, mode: 0o700 });
    const safe = title.replace(/[^\w .-]+/g, '').trim().slice(0, 60) || 'export';
    const record = this.store.put('export', { title, format, name: `${safe}.${format}`, bytes: Buffer.byteLength(content) });
    await writeFile(join(this.exports, `${record.id}.${format}`), content, { mode: 0o600 });
    this.store.log('export.saved', { id: record.id, format });
    return record;
  }
}
