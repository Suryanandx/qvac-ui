import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { decodeUpload, MAX_UPLOAD_BYTES } from './capabilities.mjs';
import { importDocument } from './data.mjs';

export const attachmentSchema = z.object({
  conversationId: z.string().min(1).max(100), name: z.string().min(1).max(200),
  base64: z.string().min(4).max(Math.ceil(MAX_UPLOAD_BYTES / 3) * 4)
}).strict();

const kindByExtension = { '.wav': 'audio', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.bin': 'neural', '.csv': 'document', '.txt': 'document', '.md': 'document', '.json': 'document', '.pdf': 'document', '.docx': 'document' };
const capabilityFor = { audio: 'transcribe', image: 'ocr', neural: 'bci' };

// Public BCI research fixtures document their recording session day; match by content hash only.
const bciManifest = (() => {
  try { return JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/bci/manifest.json', import.meta.url)), 'utf8')).samples || []; }
  catch { return []; }
})();

const TEXT_LIMIT = 1_900_000;
export async function pdfText(bytes) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const standardFontDataUrl = fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)) + '/';
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 300); i++) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map(item => item.str + (item.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim());
    }
    const text = pages.map((p, i) => `[Page ${i + 1}]\n${p}`).join('\n\n');
    if (!pages.join('').trim()) throw new Error('This PDF has no text layer (it is probably scanned). Attach the pages as images to read them with OCR or vision.');
    return text.slice(0, TEXT_LIMIT);
  } finally { await task.destroy(); }
}
export async function docxText(bytes) {
  const { default: mammoth } = await import('mammoth');
  const { value } = await mammoth.extractRawText({ buffer: bytes });
  if (!value.trim()) throw new Error('This Word document has no text');
  return value.slice(0, TEXT_LIMIT);
}

/** Files attached in chat. Binary inputs stay on local disk (0600); text files become searchable documents. */
export class Attachments {
  constructor(store, directory) { this.store = store; this.directory = join(directory, 'attachments'); }
  list(conversationId) { return this.store.list('attachment').filter(a => a.conversationId === conversationId).reverse(); }
  async add(input) {
    const request = attachmentSchema.parse(input);
    const conversation = this.store.get('conversation', request.conversationId);
    if (conversation.archived) throw new Error('Restore this chat before attaching files');
    const name = basename(request.name), extension = extname(name).toLowerCase(), kind = kindByExtension[extension];
    if (!kind) throw new Error('Attach audio (WAV), images (PNG, JPEG), PDF or Word documents, CSV/TXT/MD/JSON text, or BCI .bin recordings');
    const ref = `file-${this.list(request.conversationId).length + 1}`;
    if (kind === 'document') {
      const bytes = Buffer.from(request.base64, 'base64');
      const content = extension === '.pdf' ? await pdfText(bytes) : extension === '.docx' ? await docxText(bytes) : bytes.toString('utf8');
      const doc = importDocument(this.store, { name, content });
      return this.save({ conversationId: request.conversationId, ref, name, kind, documentId: doc.id, sha256: doc.sha256, bytes: doc.bytes, rows: doc.rows?.length ?? null });
    }
    const checked = decodeUpload({ name, base64: request.base64 }, capabilityFor[kind]);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const record = this.save({ conversationId: request.conversationId, ref, name, kind, sha256: checked.sha256, bytes: checked.bytes.length, metadata: checked.metadata,
      ...(kind === 'neural' ? { dayIndex: bciManifest.find(s => s.sha256 === checked.sha256)?.day_idx ?? null } : {}) });
    await writeFile(join(this.directory, record.id + checked.metadata.extension), checked.bytes, { mode: 0o600, flag: 'wx' });
    return record;
  }
  save(body) {
    const record = this.store.put('attachment', body);
    this.store.log('attachment.added', { id: record.id, conversationId: body.conversationId, kind: body.kind, sha256: body.sha256 });
    return record;
  }
  /** Resolve a model-supplied reference (file-2, a file name or record id) inside one conversation only. */
  resolve(conversationId, reference, kinds) {
    const all = this.list(conversationId), wanted = String(reference || '').trim().toLowerCase();
    const candidates = kinds ? all.filter(a => kinds.includes(a.kind)) : all;
    // Small models write references loosely ("file-1 invoice.png", "invoice"), so accept those too.
    const match = candidates.find(a => a.ref === wanted || a.id === wanted || a.name.toLowerCase() === wanted)
      || candidates.find(a => wanted.split(/[\s,()]+/).includes(a.ref) || wanted.includes(a.name.toLowerCase()) || (wanted.length > 2 && a.name.toLowerCase().startsWith(wanted)))
      || (!wanted || candidates.length === 1 ? candidates.at(-1) : null);
    if (!match) throw new Error(candidates.length ? `Unknown attachment "${reference}". Available: ${candidates.map(a => `${a.ref} (${a.name})`).join(', ')}` : `No ${kinds?.join('/') || ''} file is attached to this chat`);
    return match;
  }
  path(attachment) { return join(this.directory, attachment.id + attachment.metadata.extension); }
  async upload(attachment) {
    const bytes = await readFile(join(this.directory, attachment.id + attachment.metadata.extension));
    return { name: attachment.name, base64: bytes.toString('base64') };
  }
}
