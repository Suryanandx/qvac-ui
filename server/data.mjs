import { parse } from 'csv-parse/sync';
import { hash } from './store.mjs';
export function importDocument(store, { name, content }) {
  if (typeof name !== 'string' || name.length > 150 || !/\.(csv|txt|md|json|pdf|docx)$/i.test(name)) throw new Error('Choose a CSV, TXT, Markdown, JSON, PDF or Word file');
  if (typeof content !== 'string' || Buffer.byteLength(content) > 2_000_000 || !content.trim()) throw new Error('Files must contain text and be smaller than 2 MB of text');
  let rows = null;
  if (/\.csv$/i.test(name)) {
    const grid = parse(content, { bom: true, skip_empty_lines: true, max_record_size: 100_000 });
    if (grid.length < 2 || grid.length > 5001 || grid[0].length > 40) throw new Error('CSV supports 1–5,000 rows and at most 40 columns');
    const headers = grid.shift();
    if (new Set(headers).size !== headers.length || headers.some(h => !h || ['__proto__', 'constructor', 'prototype'].includes(h))) throw new Error('CSV needs unique, non-empty column names');
    rows = grid.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  }
  if (/\.json$/i.test(name)) JSON.parse(content);
  const doc = store.put('document', { name, content, rows, sha256: hash(content), source: 'user-import', bytes: Buffer.byteLength(content) });
  store.log('data.imported', { documentId: doc.id, name, sha256: doc.sha256 });
  return doc;
}
export function profileDocument(doc) {
  if (!doc.rows) return { characters: doc.content.length, lines: doc.content.split('\n').length };
  const columns=Object.keys(doc.rows[0]).map(name => {
    const values = doc.rows.map(r => r[name]), filled = values.filter(v => String(v).trim() !== '');
    const numeric = filled.length > 0 && filled.every(v => Number.isFinite(Number(v)));
    return { name, missing: values.length - filled.length, distinct: new Set(values).size, numeric,
      ...(numeric ? { sum: filled.reduce((s, v) => s + Number(v), 0), min: Math.min(...filled.map(Number)), max: Math.max(...filled.map(Number)) } : {}) };
  });
  const groupedTotals=columns.filter(c=>!c.numeric&&c.distinct<=20).map(c=>({column:c.name,groups:[...new Set(doc.rows.map(r=>r[c.name]))].map(value=>({value,totals:Object.fromEntries(columns.filter(n=>n.numeric).map(n=>[n.name,doc.rows.filter(r=>r[c.name]===value).reduce((sum,r)=>sum+Number(r[n.name]||0),0)]))}))}));
  return {rows:doc.rows.length,columns,groupedTotals};
}
export function searchDocuments(store, query, ids = []) {
  const terms = query.toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return store.list('document').filter(d => ids.includes(d.id)).flatMap(doc => {
    const chunks = doc.content.match(/[\s\S]{1,1200}/g) || [];
    return chunks.map((text, index) => ({ documentId: doc.id, name: doc.name, sha256: doc.sha256, chunk: index + 1, text,
      score: terms.reduce((n, t) => n + (text.toLowerCase().includes(t) ? 1 : 0), 0) }));
  }).sort((a, b) => b.score - a.score).slice(0, 4);
}
