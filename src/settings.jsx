import React, { useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, Check, ChevronDown, Cpu, Database, Download, ExternalLink, KeyRound, Loader2, Plug, Plus, PlugZap, Search, ShieldCheck, Sparkles, Trash2, Waves, WifiOff, Workflow, X } from 'lucide-react';

const gb = bytes => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

export default function Settings({ api, state, refresh, onClose, initialTab = 'models' }) {
  const [tab, setTab] = useState(initialTab), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const run = async fn => { setSaving(true); setError(''); try { await fn(); await refresh(); } catch (e) { setError(e.message); } finally { setSaving(false); } };
  const tabs = [['models', 'Models', Cpu], ['connectors', 'Connectors', PlugZap], ['skills', 'Skills', BookOpen], ['vault', 'Vault', Database], ['capabilities', 'Capabilities', Waves], ['mcp', 'MCP', Plug], ['flows', 'Flows', Workflow], ['privacy', 'Privacy', ShieldCheck], ['activity', 'Activity', Activity]];
  const props = { api, state, run, saving, refresh };
  return <div className="sheet-backdrop" onClick={onClose}><aside className="sheet" onClick={e => e.stopPropagation()} aria-label="Settings">
    <header><h2>Settings</h2><button className="icon-button" aria-label="Close settings" onClick={onClose}><X size={18} /></button></header>
    <nav className="sheet-tabs">{tabs.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => { setTab(id); setError(''); }}><Icon size={14} />{label}</button>)}</nav>
    {error && <p className="composer-error">{error}</p>}
    <div className="sheet-body">
      {tab === 'models' && <Models {...props} />}
      {tab === 'connectors' && <Connectors {...props} />}
      {tab === 'skills' && <Skills {...props} />}
      {tab === 'vault' && <Vault {...props} />}
      {tab === 'capabilities' && <Capabilities {...props} />}
      {tab === 'mcp' && <Mcp {...props} />}
      {tab === 'flows' && <div className="settings-list">{state.flows.map(f => <div key={f.id} className="settings-row"><div><b>{f.name}</b><small>{f.description}</small><code>{f.steps.join(' → ')}</code></div><button className="icon-button" aria-label={`Delete flow ${f.name}`} onClick={() => run(() => api('flows', { action: 'delete', name: f.name }))}><Trash2 size={15} /></button></div>)}<p className="hint">Ask the copilot to create flows, e.g. “Create a flow called intake that transcribes a recording and speaks a summary.” Run one with <code>/flow name</code>.</p></div>}
      {tab === 'privacy' && <Privacy {...props} />}
      {tab === 'activity' && <ActivityLog api={api} />}
    </div>
  </aside></div>;
}

function Models({ api, state, run, saving, refresh }) {
  const [catalog, setCatalog] = useState(null), [device, setDevice] = useState(state.model.device || 'gpu'), [path, setPath] = useState(''), [showLanguages, setShowLanguages] = useState(false);
  const load = () => api('catalog', { action: 'list' }).then(r => setCatalog(r.entries)).catch(() => {});
  useEffect(() => { load(); }, []);
  const downloading = Object.values(state.downloads || {}).some(d => d.status === 'downloading');
  useEffect(() => { if (!downloading) return; const t = setInterval(() => { refresh(); load(); }, 1500); return () => clearInterval(t); }, [downloading]);
  if (!catalog) return <p className="hint"><Loader2 size={13} className="spin" /> Reading the QVAC model registry…</p>;
  const download = id => run(async () => { await api('catalog', { action: 'download', id }); await load(); });
  const row = e => {
    const d = state.downloads?.[e.id], active = state.model.catalogId === e.id;
    return <div key={e.id} className={`settings-row column ${active ? 'selected' : ''}`}>
      <div className="row-top"><div><b>{e.label}{e.recommended && <span className="pill ok">recommended</span>}</b><small>{e.description}</small><small className="meta">{gb(e.bytes)} · {e.license}{e.features?.includes('vision') ? ' · sees images' : ''}</small></div>
        {!e.installed && toolReady(e) && state.downloads?.[e.id]?.status !== 'downloading' ? <span className="pill ok" title="This tool already uses a local model file">set up</span> : e.installed ? (e.role === 'capability' && !state.capabilities.find(c => c.id === e.capability)?.configured ? <button className="secondary small" disabled={saving} onClick={() => download(e.id)}>Set up</button> : e.role === 'brain' ? (active ? <span className="pill ok"><Check size={11} /> in use</span> : <button className="secondary small" disabled={saving} onClick={() => run(() => api('settings/model', { catalogId: e.id, device }))}>Use</button>) : <span className="pill ok">installed</span>)
          : d?.status === 'downloading' ? <span className="pill"><Loader2 size={11} className="spin" /> {d.percentage}%</span>
          : e.available ? <button className="secondary small" onClick={() => download(e.id)}><Download size={13} /> {gb(e.bytes)}</button> : <span className="pill">unavailable</span>}</div>
      {d?.status === 'downloading' && <div className="progress"><i style={{ width: `${d.percentage}%` }} /></div>}
      {d?.status === 'failed' && <small className="row-error">{d.error}</small>}
    </div>;
  };
  const groups = [['Brain', e => e.role === 'brain'], ['QVAC Psy · Tether specialist models', e => e.psy], ['Tools (speech, reading, decisions, BCI)', e => e.role === 'capability'], ['Listening & speaking', e => ['transcribe', 'vad', 'diarize'].includes(e.role)], ['Vault', e => e.role === 'embed'], ['Create (download only if you need them)', e => ['image', 'music'].includes(e.role)]];
  const translation = catalog.filter(e => e.role === 'translate');
  // A tool already configured from another file (e.g. a local GGUF) counts as set up.
  const toolReady = e => e.role === 'capability' && state.capabilities.find(c => c.id === e.capability)?.configured;
  const missing = catalog.filter(e => e.recommended && e.available && !e.installed && !toolReady(e) && state.downloads?.[e.id]?.status !== 'downloading');
  return <div className="settings-list">
    <p className="hint">Models come from the QVAC registry, pinned to an exact version and checked against SHA-256 after download. Nothing downloads until you click. Status: <b>{state.model.status}</b></p>
    {missing.length > 0 && <div className="settings-row column setup-row"><div className="row-top"><div><b><Sparkles size={14} /> Recommended setup</b><small>{missing.map(e => e.label).join(', ')}</small></div>
      <button className="primary" onClick={() => run(async () => { for (const e of missing) await api('catalog', { action: 'download', id: e.id }); await load(); })}><Download size={13} /> Install {gb(missing.reduce((n, e) => n + e.bytes, 0))}</button></div></div>}
    <label className="inline-field">Run the brain on<select value={device} onChange={e => setDevice(e.target.value)}><option value="gpu">GPU / Metal</option><option value="cpu">CPU</option></select></label>
    {groups.map(([title, test]) => <React.Fragment key={title}><h4 className="group-title">{title}</h4>{catalog.filter(test).map(row)}</React.Fragment>)}
    <h4 className="group-title">Translation <button className="link" onClick={() => setShowLanguages(!showLanguages)}>{showLanguages ? 'Show installed' : `All ${translation.length / 2} languages`}</button></h4>
    {translation.filter(e => showLanguages || e.installed).map(row)}
    <h4 className="group-title">Your own GGUF</h4>
    <div className="form">
      <label>Installed files<select value={path} onChange={e => setPath(e.target.value)}><option value="">Choose…</option>{state.model.availableModels.map(m => <option key={m.path} value={m.path}>{m.name}</option>)}</select></label>
      <label>Or an absolute path<input value={path} onChange={e => setPath(e.target.value)} placeholder="/path/to/model.gguf" /></label>
      <button className="secondary" disabled={saving || !path} onClick={() => run(() => api('settings/model', { model: path, device }))}>Use this file</button>
    </div>
  </div>;
}

function Connectors({ api, state, run, saving }) {
  const [open, setOpen] = useState(null), [values, setValues] = useState({}), [query, setQuery] = useState(''), [testing, setTesting] = useState(null);
  const groups = useMemo(() => [...new Set(state.connectors.map(c => c.group))], [state.connectors]);
  const shown = state.connectors.filter(c => `${c.name} ${c.description} ${c.group}`.toLowerCase().includes(query.toLowerCase()));
  const test = id => run(async () => { setTesting(id); try { await api('connectors', { action: 'test', id }); } finally { setTesting(null); } });
  return <div className="settings-list">
    <p className="hint">Connect services with your own API keys. Keys are encrypted with a key kept in your {navigator.platform.startsWith('Mac') ? 'macOS Keychain' : 'private workspace'} and are never shown again. The copilot finds connector tools on demand; anything that changes data asks you first.{state.offline && <b> Offline mode is on, so connectors are paused.</b>}</p>
    <div className="search-field"><Search size={14} /><input placeholder="Search connectors" value={query} onChange={e => setQuery(e.target.value)} /></div>
    {groups.map(group => <React.Fragment key={group}><h4 className="group-title">{group}</h4>
      {shown.filter(c => c.group === group).map(c => <div key={c.id} className="settings-row column">
        <div className="row-top"><div><b>{c.name}</b><small>{c.description}</small><small className="meta">{c.tools.length} tools{c.tools.some(t => t.write) ? ` · ${c.tools.filter(t => t.write).length} ask before changing data` : ' · read-only'}</small></div>
          {c.enabled ? <span className={`pill ${c.lastTest?.ok === false ? 'bad' : 'ok'}`}>{c.oauth && !c.authorized ? 'sign-in needed' : c.lastTest ? (c.lastTest.ok ? 'working' : 'error') : 'on'}</span> : null}
          {c.keyless ? <button className="secondary small" disabled={saving} onClick={() => run(() => api('connectors', { action: c.enabled ? 'disable' : 'enable', id: c.id }))}>{c.enabled ? 'Turn off' : 'Turn on'}</button>
            : <button className="secondary small" onClick={() => { setOpen(open === c.id ? null : c.id); setValues({}); }}>{open === c.id ? 'Close' : c.enabled ? 'Edit' : 'Connect'} <ChevronDown size={12} /></button>}</div>
        {c.lastTest && !c.lastTest.ok && <small className="row-error">{c.lastTest.error}</small>}
        {c.enabled && c.keyless && <div className="row-actions"><button className="link" disabled={testing === c.id} onClick={() => test(c.id)}>{testing === c.id ? 'Testing…' : 'Test connection'}</button></div>}
        {open === c.id && <div className="form inline">
          {c.fields.map(f => <label key={f.key}>{f.label}{f.help && <small className="meta">{f.help}</small>}<input type={f.secret ? 'password' : 'text'} autoComplete="off" placeholder={f.set ? (f.secret ? '•••••••• saved' : f.value) : f.placeholder || ''} value={values[f.key] ?? (f.secret ? '' : f.value || '')} onChange={e => setValues({ ...values, [f.key]: e.target.value })} /></label>)}
          {c.oauth && <p className="hint">Add this redirect URI to your OAuth app: <code>{location.origin}/oauth/callback</code></p>}
          <div className="row-actions">
            <button className="primary" disabled={saving} onClick={() => run(async () => { await api('connectors', { action: 'save', id: c.id, values }); setValues({}); if (!c.oauth) await api('connectors', { action: 'test', id: c.id }).catch(() => {}); })}><KeyRound size={13} /> Save{c.oauth ? '' : ' & test'}</button>
            {c.oauth && c.enabled && <button className="secondary" onClick={() => run(async () => { const { url } = await api('connectors', { action: 'oauth-start', id: c.id }); window.open(url, '_blank', 'noopener'); })}><ExternalLink size={13} /> Sign in with {c.name.split(' ')[0]}</button>}
            {c.enabled && <button className="secondary" disabled={testing === c.id} onClick={() => test(c.id)}>{testing === c.id ? 'Testing…' : 'Test'}</button>}
            {c.enabled && <button className="icon-button" aria-label={`Remove ${c.name}`} onClick={() => run(async () => { await api('connectors', { action: 'remove', id: c.id }); setOpen(null); })}><Trash2 size={15} /></button>}
          </div>
          <div className="tool-chips">{c.tools.map(t => <code key={t.name} title={t.description}>{t.name}{t.write ? ' ✎' : ''}</code>)}</div>
        </div>}
      </div>)}</React.Fragment>)}
  </div>;
}

function Skills({ api, state, run, saving }) {
  const [view, setView] = useState(null), [adding, setAdding] = useState(false), [source, setSource] = useState(''), [query, setQuery] = useState('');
  const shown = state.skills.filter(s => `${s.name} ${s.description}`.toLowerCase().includes(query.toLowerCase()));
  const template = `---\nname: my-skill\ndescription: What this skill does and when to use it.\n---\n\n# My skill\n\n1. First step (name the tools to use).\n2. What the answer should contain.\n`;
  return <div className="settings-list">
    <p className="hint">Skills are reusable instructions in the open <b>Agent Skills</b> format (a <code>SKILL.md</code> file). The copilot sees each skill's name and description, and loads the full instructions only when a task fits. Skills never run code. Skills from Anthropic's and other public skill libraries can be pasted in as they are.</p>
    <div className="row-actions"><div className="search-field grow"><Search size={14} /><input placeholder={`Search ${state.skills.length} skills`} value={query} onChange={e => setQuery(e.target.value)} /></div><button className="secondary" onClick={() => { setAdding(!adding); setSource(source || template); }}><Plus size={14} /> New or import</button></div>
    {adding && <div className="form">
      <label>SKILL.md<textarea rows={10} value={source} onChange={e => setSource(e.target.value)} spellCheck={false} /></label>
      <div className="row-actions"><label className="secondary small file-pick">Load file<input type="file" hidden accept=".md,text/markdown" onChange={async e => { const f = e.target.files[0]; if (f) setSource(await f.text()); }} /></label>
        <button className="primary" disabled={saving} onClick={() => run(async () => { await api('skills', { action: 'save', source }); setAdding(false); setSource(''); })}>Save skill</button></div>
    </div>}
    {shown.map(s => <div key={s.name} className="settings-row column">
      <div className="row-top"><div><b>{s.name}</b><small>{s.description}</small><small className="meta">{s.source === 'user' ? 'Your skill' : 'Built-in'} · {s.words} words</small></div>
        <label className="check"><input type="checkbox" checked={s.enabled} onChange={e => run(() => api('skills', { action: e.target.checked ? 'enable' : 'disable', name: s.name }))} /> On</label>
        <button className="link" onClick={async () => setView(view?.name === s.name ? null : await api('skills', { action: 'read', name: s.name }))}>{view?.name === s.name ? 'Hide' : 'View'}</button>
        {s.source === 'user' && <button className="icon-button" aria-label={`Delete ${s.name}`} onClick={() => run(() => api('skills', { action: 'delete', name: s.name }))}><Trash2 size={15} /></button>}</div>
      {view?.name === s.name && <pre className="skill-body">{view.body}</pre>}
    </div>)}
  </div>;
}

function Vault({ api, run, saving }) {
  const [info, setInfo] = useState(null);
  const load = () => api('vault').then(setInfo).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!info) return <p className="hint">Loading…</p>;
  return <div className="settings-list">
    <p className="hint">The vault is a private, meaning-based index of every document, transcript and OCR result in this workspace. It uses EmbeddingGemma on this computer; nothing is uploaded. Ask things like “what did we decide about pricing?” in any chat.</p>
    <div className="ui-metrics"><div><small>Documents indexed</small><b>{info.documents.length}</b></div><div><small>Passages</small><b>{info.chunks}</b></div><div><small>Waiting</small><b>{info.pending}</b></div></div>
    <button className="secondary" disabled={saving || !info.pending} onClick={() => run(async () => { await api('vault', { action: 'index' }); await load(); })}>{saving ? 'Indexing…' : `Index ${info.pending} waiting document${info.pending === 1 ? '' : 's'}`}</button>
    {info.documents.map(d => <div key={d.documentId} className="settings-row"><div><b>{d.name}</b><small>{d.chunks} passages</small></div></div>)}
  </div>;
}

function Capabilities({ api, state, run, saving }) {
  const [editing, setEditing] = useState(null), [form, setForm] = useState({});
  const fields = { transcribe: ['modelPath'], tts: ['modelPath', 'ttsEngine'], ocr: ['modelPath', 'detectorPath', 'pipeline'], bci: ['modelPath', 'embedderPath'], classify: ['modelPath'], decide: ['modelPath'] };
  return <div className="settings-list">
    <p className="hint">Local QVAC models the brain calls as tools. Unconfigured capabilities are hidden from the model.</p>
    {state.capabilities.map(c => <div key={c.id} className="settings-row column">
      <div className="row-top"><div><b>{c.label}</b><small>{c.requirements}</small></div><span className={`pill ${c.configured ? 'ok' : ''}`}>{c.configured ? (c.bundled ? 'bundled' : 'ready') : 'not set'}</span><button className="secondary small" onClick={() => { setEditing(editing === c.id ? null : c.id); setForm({ ...(c.config || {}), capability: c.id }); }}>{editing === c.id ? 'Close' : 'Edit'}</button></div>
      {editing === c.id && <div className="form inline">{fields[c.id].map(f => f === 'ttsEngine' ? <label key={f}>Engine<select value={form.ttsEngine || 'supertonic'} onChange={e => setForm({ ...form, ttsEngine: e.target.value })}><option>supertonic</option><option>parler</option></select></label>
        : f === 'pipeline' ? <label key={f}>Pipeline<select value={form.pipeline || 'easyocr'} onChange={e => setForm({ ...form, pipeline: e.target.value })}><option>easyocr</option><option>doctr</option></select></label>
        : <label key={f}>{f.replace('Path', ' path')}<input value={form[f] || ''} onChange={e => setForm({ ...form, [f]: e.target.value })} placeholder="/absolute/path" /></label>)}
        <button className="primary" disabled={saving} onClick={() => run(async () => { await api('settings/capability', form); setEditing(null); })}>Save</button></div>}
    </div>)}
  </div>;
}

function Mcp({ api, state, run, saving }) {
  const [adding, setAdding] = useState(false), [form, setForm] = useState({ transport: 'stdio', name: '', command: 'npx', args: '', env: '', url: '' });
  const add = () => run(async () => {
    const server = form.transport === 'stdio'
      ? { transport: 'stdio', name: form.name, command: form.command, args: form.args.split('\n').map(s => s.trim()).filter(Boolean), env: Object.fromEntries(form.env.split('\n').map(l => l.trim()).filter(Boolean).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) }
      : { transport: 'http', name: form.name, url: form.url };
    await api('mcp', { action: 'add', server }); setAdding(false);
  });
  return <div className="settings-list">
    <p className="hint">Connect any Model Context Protocol server for more tools. Each call asks for your approval unless you trust that server.</p>
    {state.mcp.map(s => <div key={s.id} className="settings-row column">
      <div className="row-top"><div><b>{s.name}</b><small>{s.transport === 'stdio' ? `${s.command} ${s.args.join(' ')}` : s.url}</small></div><span className={`pill ${s.status === 'connected' ? 'ok' : s.status === 'error' ? 'bad' : ''}`}>{s.status}</span></div>
      {s.error && <small className="row-error">{s.error}</small>}
      {s.tools.length > 0 && <div className="tool-chips">{s.tools.map(t => <code key={t.name} title={t.description}>{t.name}</code>)}</div>}
      <div className="row-actions">
        <label className="check"><input type="checkbox" checked={s.enabled} onChange={e => run(() => api('mcp', { action: 'update', id: s.id, patch: { enabled: e.target.checked } }))} /> Enabled</label>
        <label className="check"><input type="checkbox" checked={s.trusted} onChange={e => run(() => api('mcp', { action: 'update', id: s.id, patch: { trusted: e.target.checked } }))} /> Trusted (skip approvals)</label>
        <button className="secondary small" disabled={saving} onClick={() => run(() => api('mcp', { action: 'reconnect', id: s.id }))}>Reconnect</button>
        <button className="icon-button" aria-label={`Remove ${s.name}`} onClick={() => run(() => api('mcp', { action: 'remove', id: s.id }))}><Trash2 size={15} /></button>
      </div>
    </div>)}
    {adding ? <div className="form">
      <label>Name<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="filesystem" /></label>
      <label>Transport<select value={form.transport} onChange={e => setForm({ ...form, transport: e.target.value })}><option value="stdio">Local command (stdio)</option><option value="http">Streamable HTTP URL</option></select></label>
      {form.transport === 'stdio' ? <>
        <label>Command<input value={form.command} onChange={e => setForm({ ...form, command: e.target.value })} /></label>
        <label>Arguments, one per line<textarea rows={3} value={form.args} onChange={e => setForm({ ...form, args: e.target.value })} placeholder={'-y\n@modelcontextprotocol/server-filesystem\n/Users/you/Documents'} /></label>
        <label>Environment, KEY=value per line<textarea rows={2} value={form.env} onChange={e => setForm({ ...form, env: e.target.value })} /></label>
        <p className="hint warn">This runs the command on your computer with your user permissions. Add only servers you trust.</p>
      </> : <label>URL<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://example.com/mcp" /></label>}
      <div className="row-actions"><button className="primary" disabled={saving || !form.name} onClick={add}>{saving ? 'Connecting…' : 'Connect'}</button><button className="secondary" onClick={() => setAdding(false)}>Cancel</button></div>
    </div> : <button className="secondary" onClick={() => setAdding(true)}><Plus size={14} /> Add MCP server</button>}
  </div>;
}

function Privacy({ api, state, run, saving }) {
  return <div className="settings-list">
    <div className="settings-row column"><div className="row-top"><div><b><WifiOff size={14} /> Offline mode</b><small>Turns off every connector and MCP server. Models, files, voice and the vault keep working on this computer.</small></div>
      <label className="switch"><input type="checkbox" checked={state.offline} disabled={saving} onChange={e => run(() => api('settings/app', { offline: e.target.checked }))} /><span /></label></div></div>
    <div className="settings-row column"><b><ShieldCheck size={14} /> What stays local</b><small>Chats, files, transcripts, generated media and the vault live in this workspace's private folder. Connector keys are encrypted. Model downloads come from the QVAC registry and are checksum-verified. Only connectors and MCP servers you turn on reach the internet, and changes need your approval.</small></div>
  </div>;
}

function ActivityLog({ api }) {
  const [audit, setAudit] = useState(null);
  useEffect(() => { api('audit').then(setAudit).catch(() => {}); }, []);
  if (!audit) return <p className="hint">Loading…</p>;
  return <div className="settings-list"><p className="status-line"><span className={`dot ${audit.valid ? 'ok' : 'bad'}`} />Audit hash chain {audit.valid ? 'intact' : 'does not verify'}</p>
    {audit.events.slice(0, 100).map(e => <div key={e.seq} className="audit-row"><code>{e.event}</code><small>{new Date(e.at).toLocaleTimeString()}</small><span>{Object.entries(e.body).filter(([k]) => ['tool', 'name', 'id', 'capability', 'agent', 'error', 'decision', 'ok'].includes(k)).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join(' · ')}</span></div>)}
  </div>;
}
