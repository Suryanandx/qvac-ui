// Image and music generation check that leaves no weights behind: downloads
// FLUX.2 klein and ACE-Step into a temporary cache, generates a few times while
// watching memory, writes evidence to verification/native-generation.json and
// deletes the temporary cache (about 6 GB). Usage: node scripts/test-generation.mjs [runs]
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { freemem, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)), runs = Number(process.argv[2] || 2);
const cache = await mkdtemp(join(tmpdir(), 'qvac-gen-cache-')), workspace = await mkdtemp(join(tmpdir(), 'qvac-gen-ws-'));
process.env.QVAC_UI_MODEL_CACHE = cache;
const { Store } = await import('../server/store.mjs');
const { Models } = await import('../server/models.mjs');
const { Studio } = await import('../server/studio.mjs');
const { CATALOG, downloadEntry } = await import('../server/catalog.mjs');
const store = new Store(workspace), models = new Models(workspace), studio = new Studio({ store, directory: workspace, models });
const gb = n => (n / 1024 ** 3).toFixed(1);
const results = [];
try {
  const sdk = await models.getSDK();
  for (const id of ['image', 'music']) {
    const entry = { ...CATALOG.find(e => e.id === id) };
    // FLUX's text encoder is Qwen3 4B; reuse a local copy instead of downloading it again.
    if (id === 'image' && await studio.localQwen()) { const { llmModelSrc, ...rest } = entry.assets; entry.assets = rest; }
    console.log(`↓ ${entry.label} into a temporary cache`);
    await downloadEntry(sdk, entry, { onProgress: () => {} });
  }
  for (let i = 1; i <= runs; i++) {
    for (const [kind, run] of [
      ['image', () => studio.generateImage(['a lighthouse on a cliff at sunset, painterly', 'a red bicycle leaning on a brick wall, photo', 'a cozy reading nook with plants, watercolor'][(i - 1) % 3], { width: 512, height: 512, steps: 12 })],
      ['music', () => studio.generateMusic(['lo-fi hip hop with mellow piano and soft drums', 'upbeat acoustic guitar folk, bright and warm'][(i - 1) % 2], 10)]
    ]) {
      if (freemem() < 4 * 1024 ** 3) console.log(`  note: ${gb(freemem())} GB reported free before ${kind}`);
      const started = performance.now(), before = freemem();
      try {
        const media = await run();
        const bytes = (await readFile(join(workspace, 'media', `${media.id}.${media.ext}`))).length;
        results.push({ kind, run: i, ok: true, seconds: Math.round((performance.now() - started) / 100) / 10, bytes, freeBeforeGB: gb(before), freeAfterGB: gb(freemem()) });
      } catch (e) { results.push({ kind, run: i, ok: false, error: String(e.message).slice(0, 300), seconds: Math.round((performance.now() - started) / 100) / 10 }); }
      console.log(`${results.at(-1).ok ? 'PASS' : 'FAIL'} ${kind} #${i} ${results.at(-1).seconds}s ${results.at(-1).error || `${results.at(-1).bytes} bytes`}`);
    }
  }
} finally {
  await models.close().catch(() => {});
  store.close();
  await writeFile(join(root, 'verification', 'native-generation.json'), JSON.stringify({ ranAt: new Date().toISOString(), host: `${process.platform} ${process.arch}, ${gb(totalmem())} GB`, results }, null, 2) + '\n');
  await rm(cache, { recursive: true, force: true }); await rm(workspace, { recursive: true, force: true });
  console.log(`Deleted the temporary model cache. ${results.filter(r => r.ok).length}/${results.length} passed.`);
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
