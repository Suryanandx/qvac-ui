// Download catalog models through the QVAC registry (pinned source + SHA-256).
// Usage: node scripts/download-models.mjs [catalog-id ...]   (default: recommended set)
//        node scripts/download-models.mjs --list
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATALOG, DEFAULT_TRANSLATION, catalogStatus, downloadEntry, translationEntry } from '../server/catalog.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.QVAC_CONFIG_PATH ||= join(root, '.local', 'qvac.config.json');
const sdk = await import('@qvac/sdk');
const entries = [...CATALOG, ...DEFAULT_TRANSLATION.flatMap(lang => [translationEntry(lang, 'to'), translationEntry(lang, 'from')])];
const args = process.argv.slice(2);
const status = await catalogStatus(sdk, entries);
if (args.includes('--list')) {
  for (const e of status) console.log(`${e.installed ? '✓' : ' '} ${e.id.padEnd(18)} ${(e.bytes / 1e9).toFixed(2).padStart(6)} GB  ${e.label}${e.available ? '' : '  (not in this SDK)'}`);
  process.exit(0);
}
const wanted = args.length ? status.filter(e => args.includes(e.id)) : status.filter(e => e.recommended || e.role === 'translate');
for (const entry of wanted) {
  if (entry.installed) { console.log(`✓ ${entry.id} already installed`); continue; }
  let last = -1;
  process.stdout.write(`↓ ${entry.id} (${(entry.bytes / 1e9).toFixed(2)} GB)\n`);
  await downloadEntry(sdk, entry, { onProgress: p => { const pct = Math.floor(p.percentage / 10) * 10; if (pct > last) { last = pct; console.log(`  ${entry.id} ${pct}%`); } } });
  console.log(`✓ ${entry.id}`);
}
await sdk.close(); process.exit(0);
