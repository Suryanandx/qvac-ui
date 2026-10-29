import { stat, open, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { totalmem } from 'node:os';
import { z } from 'zod';
import { CATALOG, resolveAsset } from './catalog.mjs';

const device = z.enum(['cpu', 'gpu']).default(process.platform === 'darwin' ? 'gpu' : 'cpu');
export const modelSchema = z.union([
  z.object({ catalogId: z.string().max(40), device }).strict(),
  z.object({ model: z.string().max(1000), device }).strict()
]);
// Leave headroom for capability models that load beside the brain.
const fitsMemory = bytes => bytes * 1.3 + 1024 ** 3 <= totalmem() * .7;

export async function modelFiles(path) {
  const match = path.match(/-(\d{5})-of-(\d{5})\.gguf$/i);
  if (match && Number(match[1]) !== 1) throw new Error('Choose the first GGUF shard (00001); its companion shards must be beside it');
  const count = match ? Number(match[2]) : 1;
  if (count < 1 || count > 32) throw new Error('Unsupported GGUF shard count');
  return Promise.all(Array.from({ length: count }, async (_, i) => {
    const name = match ? path.replace(/-\d{5}-of-(\d{5})\.gguf$/i, `-${String(i + 1).padStart(5, '0')}-of-$1.gguf`) : path;
    const info = await stat(name);
    if (!info.isFile()) throw new Error('Every model shard must be a regular file');
    const file = await open(name, 'r');
    try { const buffer = Buffer.alloc(4); await file.read(buffer, 0, 4, 0); if (buffer.toString() !== 'GGUF') throw new Error('Invalid GGUF model or shard'); }
    finally { await file.close(); }
    return { path: name, bytes: info.size };
  }));
}

/** The single local chat model behind the Brain. QVAC only; loaded lazily with native tool calling enabled. */
export class Models {
  constructor(directory) { this.directory = directory; this.config = null; this.status = 'No chat model configured'; this.busy = false; }
  async configure(input) {
    if (this.busy) throw new Error('Wait for the current response before changing models');
    const config = modelSchema.parse(input);
    if (config.catalogId) {
      const entry = CATALOG.find(e => e.id === config.catalogId && e.role === 'brain');
      if (!entry) throw new Error('Unknown catalog model');
      Object.assign(config, { label: entry.label, features: entry.features || ['tools'], model: '' });
    } else {
      if (!isAbsolute(config.model) || !config.model.toLowerCase().endsWith('.gguf')) throw new Error('Choose an absolute path to a local GGUF model');
      config.model = await realpath(config.model);
      const files = await modelFiles(config.model);
      if (!fitsMemory(files.reduce((sum, f) => sum + f.bytes, 0))) throw new Error('This model is too large for this computer\'s memory. Choose smaller weights.');
      Object.assign(config, { label: config.model.split('/').pop().replace(/\.gguf$/i, ''), features: ['tools'] });
    }
    await this.unload(); this.config = config; this.status = 'Configured · loads on first message';
    return this.info();
  }
  get ready() { return Boolean(this.config); }
  get vision() { return Boolean(this.config?.features?.includes('vision')); }
  info() { return { ...(this.config || { model: '', device: 'gpu', features: [] }), status: this.status, busy: this.busy, configured: this.ready, vision: this.vision }; }
  async getSDK() {
    if (!this.sdkPromise) this.sdkPromise = (async () => {
      const configPath = join(this.directory, 'qvac.config.json');
      // Downloaded weights are shared by every workspace on this machine; chats and files stay per workspace.
      const cacheDirectory = process.env.QVAC_UI_MODEL_CACHE || fileURLToPath(new URL('../.local/qvac-cache', import.meta.url));
      await writeFile(configPath, JSON.stringify({ cacheDirectory, loggerLevel: 'info', loggerConsoleOutput: false, includeAudioDecoder: false }), { mode: 0o600 });
      process.env.QVAC_CONFIG_PATH = configPath;
      this.sdk = await import('@qvac/sdk');
      return this.sdk;
    })();
    return this.sdkPromise;
  }
  async load(signal) {
    if (this.modelId) return;
    if (!this.config) throw new Error('Choose a local chat model in Settings first');
    this.status = 'Loading local GGUF…';
    await this.getSDK(); signal?.throwIfAborted();
    let modelSrc = this.config.model, extra = {};
    if (this.config.catalogId) {
      const entry = CATALOG.find(e => e.id === this.config.catalogId), main = resolveAsset(this.sdk, entry.assets.modelSrc);
      if (!fitsMemory(main.bytes)) throw new Error(`${entry.label} needs more memory than this computer can spare`);
      modelSrc = main.src;
      if (entry.assets.projectionModelSrc) extra.projectionModelSrc = resolveAsset(this.sdk, entry.assets.projectionModelSrc).src;
    } else await modelFiles(modelSrc);
    const name = this.config.catalogId || modelSrc;
    // Explicit placement avoids an unreliable automatic fitting probe observed on the tested host.
    const loading = this.sdk.loadModel({ modelSrc, modelType: 'llamacpp-completion', modelFitPolicy: 'off',
      modelConfig: { ctx_size: 16384, tools: true, ...extra, ...(/qwen3|hermes-4|hermes-14b/i.test(name) ? { reasoning_budget: 0 } : {}), device: this.config.device, gpu_layers: this.config.device === 'gpu' ? 99 : 0, threads: 4, fit: false } });
    const cancel = () => this.sdk.cancel({ requestId: loading.requestId }).catch(() => {});
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    try { this.modelId = await loading; } finally { signal?.removeEventListener('abort', cancel); }
    this.status = 'Ready · QVAC local GGUF';
  }
  /**
   * One model turn. Streams visible text through onDelta and returns the text
   * plus any tool calls the model made. Tools are JSON-schema function specs.
   */
  async complete(history, { tools = [], signal, onDelta = () => {}, maxTokens = 1200, responseFormat, captureThinking = true } = {}) {
    if (this.busy) throw new Error('Another model response is in progress');
    this.busy = true;
    try {
      await this.load(signal); signal?.throwIfAborted();
      const run = this.sdk.completion({ modelId: this.modelId, history, stream: true, captureThinking, generationParams: { temp: .3, predict: maxTokens }, ...(tools.length ? { tools } : {}), ...(responseFormat ? { responseFormat } : {}) });
      const cancel = () => { this.sdk.cancel({ requestId: run.requestId }).catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      let text = '', completed = false; const calls = [];
      try {
        for await (const event of run.events) {
          signal?.throwIfAborted();
          if (event.type === 'contentDelta') { text += event.text; onDelta(event.text); }
          else if (event.type === 'toolCall') calls.push(event.call);
          if (text.length > 50000) throw new Error('Model output limit reached');
        }
        const final = await run.final; completed = true;
        const toolCalls = (final.toolCalls?.length ? final.toolCalls : calls).map(({ id, name, arguments: args }) => ({ id, name, arguments: args || {} }));
        return { text, toolCalls };
      } finally {
        signal?.removeEventListener('abort', cancel);
        if (!completed) { cancel(); await run.final.catch(() => {}); }
      }
    } catch (e) { if (!signal?.aborted) this.status = `Error · ${String(e.message).slice(0, 160)}`; throw e; }
    finally { this.busy = false; }
  }
  /** JSON output constrained by a JSON schema (llama.cpp grammar), parsed and validated by the caller's zod schema. */
  async structured(history, schema, { signal, maxTokens = 1500 } = {}) {
    const { $schema, ...jsonSchema } = z.toJSONSchema(schema);
    // Some chat templates (Qwen3.5) open a <think> tag before the constrained JSON, so read raw text and take the object.
    const { text } = await this.complete(history, { signal, maxTokens, captureThinking: false, responseFormat: { type: 'json_schema', json_schema: { name: 'result', schema: jsonSchema } } });
    const start = text.indexOf('{'), end = text.lastIndexOf('}');
    if (start < 0 || end < start) throw new Error('The model did not return structured output');
    return schema.parse(JSON.parse(text.slice(start, end + 1)));
  }
  async unload() { if (this.sdk && this.modelId) await this.sdk.unloadModel({ modelId: this.modelId }); this.modelId = null; }
  async close() { try { await this.unload(); } finally { if (this.sdk) await this.sdk.close(); this.modelId = null; } }
}
