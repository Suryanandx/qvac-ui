// Server-side builders for OpenUI result cards. Every card is assembled from
// validated data and serialized with jsonToOpenUI; model text is only ever a
// string prop, never OpenUI source.
import { createLibrary, defineComponent, jsonToOpenUI } from '@openuidev/lang-core';
import { buildLibrary } from '../shared/ui-library.mjs';

export const library = buildLibrary({ createLibrary, defineComponent });
const el = (typeName, props) => ({ type: 'element', typeName, props, partial: false });
const clip = (value, max = 4000) => { const text = String(value ?? ''); return text.length > max ? text.slice(0, max) + '…' : text; };

export const block = {
  text: content => el('Text', { content: clip(content) }),
  notice: (tone, content) => el('Notice', { tone, content: clip(content, 600) }),
  metrics: items => el('Metrics', { items: items.slice(0, 8).map(([label, value]) => ({ label: clip(label, 60), value: clip(value, 80) })) }),
  table: (columns, rows) => el('Table', { columns: columns.slice(0, 12).map(c => clip(c, 60)), rows: rows.slice(0, 50).map(r => r.slice(0, 12).map(v => typeof v === 'number' || typeof v === 'boolean' || v === null ? v : clip(v, 200))) }),
  bars: (title, pairs) => el('BarChart', { title: clip(title, 80), labels: pairs.slice(0, 20).map(([l]) => clip(l, 40)), values: pairs.slice(0, 20).map(([, v]) => Number(v) || 0) }),
  list: items => el('List', { items: items.slice(0, 20).map(i => clip(i, 400)) }),
  transcript: segments => el('Transcript', { segments: segments.slice(0, 200).map(s => ({ start: Number.isFinite(s.start) ? s.start : null, end: Number.isFinite(s.end) ? s.end : null, text: clip(s.text, 500) })) }),
  labels: items => el('Labels', { items: items.slice(0, 10).map(i => ({ label: clip(i.label, 80), score: Math.max(0, Math.min(1, Number(i.score) || 0)) })) }),
  audio: (ref, seconds) => el('Audio', { ref, seconds: Math.round(seconds * 10) / 10 }),
  code: content => el('Code', { content: clip(content, 6000) }),
  image: (ref, alt) => el('Image', { ref, alt: clip(alt, 300) }),
  download: (ref, name, format) => el('Download', { ref, name: clip(name, 100), format }),
  steps: items => el('Steps', { items: items.slice(0, 12).map(([label, status]) => ({ label: clip(label, 120), status })) })
};

export function card(title, body, subtitle) {
  return jsonToOpenUI(el('Card', { title: clip(title, 120), ...(subtitle ? { subtitle: clip(subtitle, 200) } : {}), body }), library);
}
