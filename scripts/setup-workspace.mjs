// Set up a workspace from the terminal: download the recommended models from
// the QVAC registry, configure the speech/OCR/TTS tools and select the vision
// brain. Same result as Settings → Models → Install recommended.
// Usage: npm run setup:workspace   (stop the running app first)
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { readSession, defaultWorkspace } from '../server/session.mjs';
import { CATALOG, downloadEntry, entryPaths } from '../server/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
if (await readSession(defaultWorkspace())) throw new Error('Close the running QVAC UI server before configuring the workspace.');
const app = await createApp({ directory: process.env.QVAC_UI_DATA || join(root, '.local') });
try {
  const sdk = await app.models.getSDK();
  for (const entry of CATALOG.filter(e => e.recommended)) {
    let last = -1;
    console.log(`↓ ${entry.label}`);
    await downloadEntry(sdk, entry, { onProgress: p => { const pct = Math.floor(p.percentage / 20) * 20; if (pct > last) { last = pct; console.log(`  ${pct}%`); } } });
    if (entry.role === 'capability') {
      const result = await app.capabilities.configure({ capability: entry.capability, ...(await entryPaths(sdk, entry)), ...(entry.options || {}) });
      app.store.put('capability-settings', { id: `cap-${entry.capability}`, config: result.capabilities.find(c => c.id === entry.capability).config });
    }
  }
  await app.models.configure({ catalogId: 'brain-vision' });
  app.store.put('settings', { id: 'model-settings', config: { catalogId: 'brain-vision', device: app.models.config.device } });
  app.store.log('workspace.configured', { from: 'setup-workspace' });
  console.log(`\n✓ Ready. Brain: ${app.models.config.label}. Tools: ${app.capabilities.info().capabilities.filter(c => c.configured).map(c => c.id).join(', ')}`);
} finally { await app.close(); }
