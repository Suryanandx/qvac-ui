import React, { Component, useEffect, useRef, useState } from 'react';
import { createLibrary, defineComponent, Renderer } from '@openuidev/react-lang';
import { Check, Circle, Loader2, Play, X, Minus, Info, AlertTriangle, CircleCheck, OctagonAlert, Download as DownloadIcon } from 'lucide-react';
import { buildLibrary } from '../shared/ui-library.mjs';

// Media is fetched with the session token, so the renderer needs a loader from the app.
let loadBlob = async () => { throw new Error('Unavailable'); };
const loadAudio = ref => loadBlob('audio', ref);
const autoplay = new Set();
export function configureMedia(loader) { loadBlob = loader; }
export function markAutoplay(ref) { autoplay.add(ref); }

// Autoplayed replies play outside React, so they keep going when the live turn is swapped for the saved message.
let current = null;
const audioEnded = () => window.dispatchEvent(new Event('qvac-audio-ended'));
export function stopAudio() { if (current) { current.pause(); current.onended(); } }
async function playNow(ref) {
  stopAudio();
  try {
    const url = URL.createObjectURL(await loadAudio(ref)), el = new Audio(url);
    el.onended = el.onerror = () => { el.onended = el.onerror = null; URL.revokeObjectURL(url); if (current === el) current = null; audioEnded(); };
    current = el; await el.play();
  } catch { if (current) current.onended(); else audioEnded(); }
}

const fmt = s => s === null || s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const toneIcon = { info: Info, success: CircleCheck, warning: AlertTriangle, error: OctagonAlert };
const stepIcon = { pending: Circle, running: Loader2, done: Check, failed: X, skipped: Minus };

function AudioClip({ props }) {
  const [url, setUrl] = useState(null), [error, setError] = useState(''), ref = useRef(null);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  const open = async () => { try { setUrl(URL.createObjectURL(await loadAudio(props.ref))); } catch (e) { setError(e.message); } };
  useEffect(() => { if (autoplay.delete(props.ref)) playNow(props.ref); }, [props.ref]);
  useEffect(() => { if (url) { stopAudio(); ref.current?.play().catch(() => {}); } }, [url]);
  if (error) return <p className="ui-muted">{error}</p>;
  return url ? <audio ref={ref} className="ui-audio" controls src={url} /> : <button className="ui-play" onClick={open}><Play size={14} /> Play {props.seconds.toFixed(1)} s</button>;
}

function ImageView({ props }) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  useEffect(() => { let made; loadBlob('media', props.ref).then(b => setUrl(made = URL.createObjectURL(b))).catch(e => setError(e.message)); return () => made && URL.revokeObjectURL(made); }, [props.ref]);
  return error ? <p className="ui-muted">{error}</p> : url ? <img className="ui-image" src={url} alt={props.alt} /> : <div className="ui-image placeholder"><Loader2 size={16} className="spin" /></div>;
}
function DownloadLink({ props }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { const url = URL.createObjectURL(await loadBlob('exports', props.ref)); const a = Object.assign(document.createElement('a'), { href: url, download: props.name }); a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); } catch (e) { setError(e.message); } finally { setBusy(false); } };
  return <><button className="ui-download" onClick={save} disabled={busy}><DownloadIcon size={14} /> {props.name}</button>{error && <p className="ui-muted">{error}</p>}</>;
}

const render = {
  Image: ImageView, Download: DownloadLink,
  Card: ({ props, renderNode }) => {
    return <article className="ui-card"><header><h4>{props.title}</h4>{props.subtitle && <small>{props.subtitle}</small>}</header><div className="ui-body">{props.body.map((b, i) => <React.Fragment key={i}>{renderNode(b)}</React.Fragment>)}</div></article>;
  },
  Text: ({ props }) => <p className="ui-text">{props.content}</p>,
  Notice: ({ props }) => { const Icon = toneIcon[props.tone]; return <p className={`ui-notice ${props.tone}`}><Icon size={14} />{props.content}</p>; },
  Metrics: ({ props }) => <div className="ui-metrics">{props.items.map((m, i) => <div key={i}><small>{m.label}</small><b>{m.value}</b></div>)}</div>,
  Table: ({ props }) => <div className="ui-table-wrap"><table className="ui-table"><thead><tr>{props.columns.map((c, i) => <th key={i}>{c}</th>)}</tr></thead><tbody>{props.rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'num' : ''}>{typeof v === 'number' ? v.toLocaleString() : v === null ? '—' : String(v)}</td>)}</tr>)}</tbody></table></div>,
  BarChart: ({ props }) => {
    const max = Math.max(...props.values.map(Math.abs), 1);
    return <figure className="ui-bars"><figcaption>{props.title}</figcaption>{props.labels.map((l, i) => <div key={i} className="ui-bar"><span>{l}</span><div><i style={{ width: `${Math.abs(props.values[i] ?? 0) / max * 100}%` }} /></div><b>{(props.values[i] ?? 0).toLocaleString()}</b></div>)}</figure>;
  },
  List: ({ props }) => <ul className="ui-list">{props.items.map((t, i) => <li key={i}>{t}</li>)}</ul>,
  Transcript: ({ props }) => <div className="ui-transcript">{props.segments.map((s, i) => <p key={i}>{s.start !== null && <time>{fmt(s.start)}</time>}<span>{s.text}</span></p>)}</div>,
  Labels: ({ props }) => <div className="ui-labels">{props.items.map((l, i) => <div key={i}><span>{l.label}</span><div><i style={{ width: `${l.score * 100}%` }} /></div><b>{(l.score * 100).toFixed(1)}%</b></div>)}</div>,
  Audio: AudioClip,
  Code: ({ props }) => <pre className="ui-code">{props.content}</pre>,
  Steps: ({ props }) => <ol className="ui-steps">{props.items.map((s, i) => { const Icon = stepIcon[s.status]; return <li key={i} className={s.status}><Icon size={13} className={s.status === 'running' ? 'spin' : ''} /><span>{s.label}</span><small>{s.status}</small></li>; })}</ol>
};

export const library = buildLibrary({ createLibrary, defineComponent }, render);

/** Render one server-built OpenUI card; fall back to the raw source if it cannot be parsed. */
export class OpenUICard extends Component {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? <pre className="ui-code">{this.props.source}</pre> : <Renderer response={this.props.source} library={library} isStreaming={false} />; }
}
