// Curated models from the QVAC registry. Each entry names SDK registry
// constants (pinned source + SHA-256), so downloads are reproducible and
// verified by the SDK. Nothing downloads until the user asks.
import { z } from 'zod';

export const CATALOG = [
  { id: 'brain-vision', role: 'brain', label: 'Qwen3.5 4B · vision', recommended: true, license: 'Apache-2.0',
    description: 'Default brain. Tool calling plus image understanding ("what is in this photo?").',
    assets: { modelSrc: 'QWEN3_5_4B_MULTIMODAL_Q4_K_M', projectionModelSrc: 'MMPROJ_QWEN3_5_4B_MULTIMODAL_Q8_0' }, features: ['tools', 'vision'] },
  { id: 'brain-vision-9b', role: 'brain', label: 'Qwen3.5 9B · vision', license: 'Apache-2.0',
    description: 'Stronger reasoning and writing; slower. Needs about 12 GB of free memory.',
    assets: { modelSrc: 'QWEN3_5_9B_MULTIMODAL_Q4_K_M', projectionModelSrc: 'MMPROJ_QWEN3_5_9B_MULTIMODAL_F16' }, features: ['tools', 'vision'], optional: true },
  { id: 'hermes-3b', role: 'brain', label: 'Hermes 3 · Llama 3.2 3B', license: 'Llama 3.2 Community',
    description: 'Nous Research model tuned for tool calling and agent work. Small and fast.', features: ['tools'],
    assets: { modelSrc: { url: 'https://huggingface.co/NousResearch/Hermes-3-Llama-3.2-3B-GGUF/resolve/3cd927095d8cbab12c743f932aa63b6f7bbfa141/Hermes-3-Llama-3.2-3B.Q4_K_M.gguf', file: 'Hermes-3-Llama-3.2-3B.Q4_K_M.gguf', bytes: 2019373888, sha256: '91776fe0f6cd7483d9d5e06162fdd1f8f0262c15ced269791b4d96a655e8a5a2' } } },
  { id: 'hermes-14b', role: 'brain', label: 'Hermes 4 · 14B', license: 'Apache-2.0',
    description: 'Nous Research hybrid-reasoning model with strong tool use. Needs about 14 GB of free memory.', features: ['tools'], optional: true,
    assets: { modelSrc: { url: 'https://huggingface.co/bartowski/NousResearch_Hermes-4-14B-GGUF/resolve/0693c8f45031215d6734406947e6b43d1b3ee0de/NousResearch_Hermes-4-14B-Q4_K_M.gguf', file: 'NousResearch_Hermes-4-14B-Q4_K_M.gguf', bytes: 9001753536, sha256: '7ad9be1e446e3da0c149fdf55284c90be666d3e13c6e2581587853f4f9538073' } } },
  { id: 'brain-text', role: 'brain', label: 'Qwen3 4B', license: 'Apache-2.0',
    description: 'Text-only brain. Also the text encoder for image generation.',
    assets: { modelSrc: 'QWEN3_4B_Q4_K_M' }, features: ['tools'] },
  // Tether's own QVAC Psy models (qvac.tether.io/products/models), used as specialists the brain consults.
  { id: 'medpsy', role: 'medical', label: 'QVAC MedPsy 1.7B', license: 'Apache-2.0', psy: true,
    description: 'Tether medical-reasoning model: beats MedGemma 4B on 7 medical benchmarks at under half the size. Answers health questions for education, not diagnosis.',
    assets: { modelSrc: { url: 'https://huggingface.co/qvac/MedPsy-1.7B-GGUF/resolve/fd4cecc90c2de8dce4b112795456a54be9c59363/medpsy-1.7b-q4_k_m-imat.gguf', file: 'medpsy-1.7b-q4_k_m-imat.gguf', bytes: 1282439360, sha256: '41ee947d9cce72ec657577219fd1798fabeabf0d832217fe23c9d6d3d18d5880' } } },
  { id: 'medpsy-4b', role: 'medical', label: 'QVAC MedPsy 4B', license: 'Apache-2.0', psy: true, optional: true,
    description: 'Larger MedPsy: outperforms the nearly 7× larger MedGemma 27B on 7 medical benchmarks.',
    assets: { modelSrc: { url: 'https://huggingface.co/qvac/MedPsy-4B-GGUF/resolve/ad85e5a6f745027a576595df9acf745b071353b3/medpsy-4b-q4_k_m-imat.gguf', file: 'medpsy-4b-q4_k_m-imat.gguf', bytes: 2716068640, sha256: '2ecbf622a2856f631001f20f593669aa03acba39977f521bef80cd8600864980' } } },
  { id: 'visionpsy', role: 'vision-lite', label: 'QVAC VisionPsy Nano 460M Flash', license: 'Apache-2.0', psy: true,
    description: 'Tether vision model that leads its size class on 16 of 17 benchmarks, using as few as 64 visual tokens. Lets any brain look at images.',
    assets: { modelSrc: 'VISIONPSY_NANO_460M_MULTIMODAL_Q8_0', projectionModelSrc: 'MMPROJ_VISIONPSY_NANO_460M_MULTIMODAL_Q8_0' } },
  { id: 'translatepsy-afri', role: 'translate-llm', label: 'QVAC TranslatePsy AfriSLM 0.8B', license: 'Apache-2.0', psy: true,
    description: 'Tether translation model for English and 19 African languages (Swahili, Yoruba, Hausa, Amharic, Zulu…), matching systems up to 152× larger.',
    assets: { modelSrc: 'TRANSLATEPSY_AFRISLM_0_8B_TRANSLATION_Q4_K_M' } },
  // Capability models: downloading one configures its tool automatically.
  { id: 'cap-tts', role: 'capability', capability: 'tts', options: { ttsEngine: 'supertonic' }, recommended: true, label: 'Supertonic · English speech', license: 'OpenRAIL',
    description: 'Text-to-speech for spoken replies, read-aloud and hands-free conversation.', assets: { modelPath: 'TTS_EN_SUPERTONIC_Q4_0' } },
  { id: 'cap-ocr', role: 'capability', capability: 'ocr', options: { pipeline: 'easyocr' }, recommended: true, label: 'EasyOCR · Latin scripts', license: 'Apache-2.0',
    description: 'Reads printed text in images: receipts, invoices, screenshots.', assets: { modelPath: 'OCR_LATIN', detectorPath: 'OCR_CRAFT' } },
  { id: 'cap-stt', role: 'capability', capability: 'transcribe', recommended: true, label: 'Whisper tiny · English (fast)', license: 'MIT',
    description: 'Fast speech-to-text for voice messages.', assets: { modelPath: 'WHISPER_EN_TINY_Q8_0' } },
  { id: 'cap-decide', role: 'capability', capability: 'decide', label: 'LAYA typed decisions', license: 'Apache-2.0',
    description: 'Scores options for a situation (approve / hold / reject…). Advisory only.', assets: { modelPath: 'LAYA_TYPED_DECISIONS_421M_Q8_0' } },
  { id: 'cap-bci', role: 'capability', capability: 'bci', label: 'BCI Whisper (research)', license: 'see upstream',
    description: 'Decodes research brain-computer-interface recordings of attempted speech.', assets: { modelPath: 'BCI_WINDOWED', embedderPath: 'BCI_EMBEDDER' } },
  { id: 'stt-small', role: 'transcribe', label: 'Whisper small · multilingual', recommended: true, license: 'MIT',
    description: 'Speech-to-text for about 100 languages; more accurate than tiny.',
    assets: { modelSrc: 'WHISPER_SMALL_Q8_0' } },
  { id: 'vad', role: 'vad', label: 'Silero VAD', recommended: true, license: 'MIT',
    description: 'Detects speech and pauses for hands-free voice and live transcription.',
    assets: { modelSrc: 'VAD_SILERO_5_1_2' } },
  { id: 'diarize', role: 'diarize', label: 'Sortformer · 4 speakers', recommended: true, license: 'CC-BY-4.0',
    description: 'Labels who is speaking in meeting recordings (up to four speakers).',
    assets: { modelSrc: 'PARAKEET_SORTFORMER_4SPK_V2_1_Q8_0' } },
  { id: 'embed', role: 'embed', label: 'EmbeddingGemma 300M', recommended: true, license: 'Gemma terms',
    description: 'Meaning-based search across your files in the private vault.',
    assets: { modelSrc: 'EMBEDDINGGEMMA_300M_Q8_0' } },
  { id: 'image', role: 'image', label: 'FLUX.2 klein 4B', license: 'Apache-2.0',
    description: 'Generates images from a description. Uses Qwen3 4B as its text encoder.',
    assets: { modelSrc: 'FLUX_2_KLEIN_4B_Q4_0', vaeModelSrc: 'FLUX_2_KLEIN_4B_VAE', llmModelSrc: 'QWEN3_4B_Q4_K_M' } },
  { id: 'music', role: 'music', label: 'ACE-Step 1.5 turbo', license: 'Apache-2.0',
    description: 'Generates short instrumental music from a description.',
    assets: { ditModelSrc: 'AUDIOGEN_ACESTEP_V15_TURBO_Q4_K_M', lmModelSrc: 'AUDIOGEN_ACESTEP_5HZ_LM_0_6B_Q8_0', textEncModelSrc: 'AUDIOGEN_QWEN3_EMBEDDING_0_6B_Q8_0', vaeModelSrc: 'AUDIOGEN_VAE_BF16' } }
];

// Bergamot translation pairs are tiny; each language pair is its own catalog entry.
export const AFRICAN_LANGUAGES = { af: 'Afrikaans', am: 'Amharic', ha: 'Hausa', ig: 'Igbo', rw: 'Kinyarwanda', ln: 'Lingala', lg: 'Luganda', mg: 'Malagasy', ny: 'Nyanja', om: 'Oromo', sn: 'Shona', so: 'Somali', st: 'Southern Sotho', sw: 'Swahili', tn: 'Tswana', wo: 'Wolof', xh: 'Xhosa', yo: 'Yoruba', zu: 'Zulu' };
export const TRANSLATION_LANGUAGES = { es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', ru: 'Russian', uk: 'Ukrainian', ja: 'Japanese', ko: 'Korean', zh: 'Chinese', ar: 'Arabic', hi: 'Hindi', tr: 'Turkish' };
export const DEFAULT_TRANSLATION = ['es', 'fr', 'de'];
export function translationEntry(lang, direction) {
  const code = lang.toUpperCase(), constant = direction === 'to' ? `BERGAMOT_EN_${code}` : `BERGAMOT_${code}_EN`;
  return { id: `translate-${direction === 'to' ? 'en-' + lang : lang + '-en'}`, role: 'translate', label: direction === 'to' ? `English → ${TRANSLATION_LANGUAGES[lang]}` : `${TRANSLATION_LANGUAGES[lang]} → English`, license: 'MPL-2.0', description: 'Bergamot neural machine translation.', assets: { modelSrc: constant }, lang, direction };
}

/** Local file paths of an installed entry, by slot (registry assets only). */
export async function entryPaths(sdk, entry) {
  const out = {};
  for (const [slot, asset] of Object.entries(entry.assets)) {
    const meta = sdk[asset], info = meta && await sdk.getModelInfo({ name: meta.name });
    const file = info?.cacheFiles?.find(f => f.isCached);
    if (!file) throw new Error(`${asset} is not downloaded`);
    out[slot] = file.path;
  }
  return out;
}

export const catalogIdSchema = z.string().regex(/^[a-z0-9-]{2,40}$/);

/** Resolve one asset (registry constant name or pinned URL) to an SDK model source plus metadata. */
export function resolveAsset(sdk, asset) {
  if (typeof asset === 'string') { const meta = sdk[asset]; return meta?.src ? { key: asset, src: meta, name: meta.name, bytes: meta.expectedSize, sha256: meta.sha256Checksum } : null; }
  return { key: asset.file, src: asset.url, name: asset.file, bytes: asset.bytes, sha256: asset.sha256, url: true };
}

/** Catalog entries resolved against the installed SDK: real sizes, checksums and cache state. */
export async function catalogStatus(sdk, entries, downloaded = new Set()) {
  return Promise.all(entries.map(async entry => {
    const files = await Promise.all(Object.entries(entry.assets).map(async ([slot, asset]) => {
      const r = resolveAsset(sdk, asset);
      if (!r) return { slot, missing: true };
      if (r.url) return { slot, name: r.name, bytes: r.bytes, sha256: r.sha256, cached: downloaded.has(r.key) };
      const info = await sdk.getModelInfo({ name: r.name }).catch(() => null);
      return { slot, name: r.name, bytes: r.bytes, sha256: r.sha256, cached: Boolean(info?.cacheFiles?.length && info.cacheFiles.every(f => f.isCached)) };
    }));
    const available = files.every(f => !f.missing);
    return { ...entry, files, available, bytes: files.reduce((s, f) => s + (f.bytes || 0), 0), installed: available && files.every(f => f.cached) };
  }));
}

/** Download every file of one entry, verifying SHA-256, and report combined progress. Returns the keys downloaded. */
export async function downloadEntry(sdk, entry, { onProgress = () => {}, signal, downloaded = new Set() } = {}) {
  const assets = [...new Map(Object.values(entry.assets).map(a => { const r = resolveAsset(sdk, a); if (!r) throw new Error(`${a} is not in this SDK version's registry`); return [r.key, r]; })).values()];
  const total = assets.reduce((s, a) => s + (a.bytes || 0), 0), keys = [];
  let done = 0;
  for (const asset of assets) {
    signal?.throwIfAborted();
    const cached = asset.url ? downloaded.has(asset.key) : (await sdk.getModelInfo({ name: asset.name }).catch(() => null))?.cacheFiles?.every(f => f.isCached);
    if (!cached) {
      const op = sdk.downloadAsset({ assetSrc: asset.src, requireHttpChecksum: true, requireSecureTransport: true, onProgress: p => onProgress({ file: asset.name, percentage: total ? Math.min(100, (done + (p.downloaded || 0)) / total * 100) : p.percentage, downloaded: done + (p.downloaded || 0), total }) });
      const cancel = () => sdk.cancel({ requestId: op.requestId }).catch(() => {});
      signal?.addEventListener('abort', cancel, { once: true });
      try { await op; } finally { signal?.removeEventListener('abort', cancel); }
    }
    keys.push(asset.key); done += asset.bytes || 0;
    onProgress({ file: asset.name, percentage: total ? done / total * 100 : 100, downloaded: done, total });
  }
  return keys;
}
