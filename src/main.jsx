import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUp, AudioLines, BookOpen, Brain, Check, ChevronDown, CircleAlert, Cpu, Database, FileAudio, FileImage, FileText, Globe, Headphones, Image as ImageIcon, Languages, LayoutPanelTop, ListChecks, Loader2, Mic, Music, PanelLeftClose, PanelLeftOpen, Plug, PlugZap, Plus, Paperclip, Receipt, ScanText, Scale, Search, Settings2, ShieldCheck, Sparkles, Square, Table2, Tags, Volume2, VolumeX, WifiOff, Workflow, Wrench, X, Save, Eye, Users } from 'lucide-react';
import ChatManager from './ChatManager.jsx';
import Settings from './settings.jsx';
import { OpenUICard, configureMedia, markAutoplay } from './openui.jsx';
import { fileUpload, toWav, wavFile } from './audio.js';
import './style.css';

const incoming = location.hash.slice(1);
if (incoming) { sessionStorage.setItem('qvac-session', incoming); history.replaceState(null, '', location.pathname); }
const token = sessionStorage.getItem('qvac-session') || '';
const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
async function api(path, data) {
  const res = await fetch('/api/' + path, { method: data === undefined ? 'GET' : 'POST', headers: headers(), ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await res.json(); if (!res.ok) throw new Error(result.error); return result;
}
configureMedia(async (kind, ref) => { const res = await fetch(`/api/${kind}/${encodeURIComponent(ref)}`, { headers: headers() }); if (!res.ok) throw new Error('File not found'); return res.blob(); });
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const remember = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* per-viewer convenience only */ } };

const TOOL_META = {
  transcribe_audio: ['Speech to text', AudioLines], meeting_notes: ['Meeting notes', Users], read_image_text: ['Read image text', ScanText], look_at_image: ['Look at image', Eye],
  classify_image: ['Classify image', Tags], extract_fields: ['Extract fields', Receipt], decode_brain_signals: ['Decode brain signals', Brain], speak: ['Speak', Volume2],
  decide: ['Decision model', Scale], analyze_table: ['Analyze table', Table2], search_files: ['Search files', Search], search_vault: ['Search vault', Database],
  translate_text: ['Translate', Languages], show_ui: ['Display', LayoutPanelTop], save_document: ['Save file', Save], generate_image: ['Generate image', ImageIcon],
  generate_music: ['Generate music', Music], create_flow: ['Create flow', Workflow], run_flow: ['Run flow', Workflow], list_flows: ['Flows', ListChecks], use_skill: ['Skill', BookOpen]
};
const toolMeta = name => TOOL_META[name] || [name.replace('__', ' · ').replace(/_/g, ' '), PlugZap];
const KIND_ICON = { audio: FileAudio, image: FileImage, neural: Brain, document: FileText };
const AUDIO = /\.(mp3|m4a|aac|ogg|oga|opus|webm|flac|wav)$/i;

// Each workspace starts a focused chat: an agent persona, a sample to try, and the prompt that runs it end to end.
const WORKSPACES = [
  { id: 'meeting', title: 'Meeting notes', body: 'Speakers, decisions, action items and a Markdown copy from any recording.', icon: Users, agent: 'meeting', sample: 'team-meeting.wav', text: 'Write meeting notes for this recording.' },
  { id: 'intake', title: 'Document intake', body: 'Pull vendor, dates, totals and line items from invoices, receipts and PDFs.', icon: Receipt, agent: 'analyst', sample: 'invoice.png', text: 'Check this invoice: extract vendor, invoice number, issue date, subtotal, tax and total, and verify the arithmetic.' },
  { id: 'sheets', title: 'Spreadsheet analyst', body: 'Exact totals and breakdowns from CSV files, as tables and charts.', icon: Table2, agent: 'analyst', sample: 'business-sales.csv', text: 'What is total revenue, and how does it split by region?' },
  { id: 'voice', title: 'Talk hands-free', body: 'A spoken conversation: it listens, answers and speaks back.', icon: Headphones, voice: true },
  { id: 'vault', title: 'Private vault', body: 'Ask questions across every file you have ever added, by meaning.', icon: Database, agent: 'researcher', sample: 'meeting-notes.md', text: 'Search the vault: who is preparing the revenue report, and by when?' },
  { id: 'translate', title: 'Translate', body: 'On-device translation between English and 15 languages.', icon: Languages, text: 'Translate into Spanish: "Our quarterly report is ready. Please review the budget before Friday."' },
  { id: 'see', title: 'Look at images', body: 'Describe photos, screenshots and charts; write alt text.', icon: Eye, sample: 'invoice.png', text: 'What is in this image? Describe it in detail.' },
  { id: 'bci', title: 'Brain signals', body: 'Decode a public BCI research recording into text, then speak it.', icon: Brain, sample: 'neural_sample_2.bin', text: 'Decode this brain recording, then read the sentence aloud.' },
  { id: 'research', title: 'Research with connectors', body: 'Wikipedia, weather, Hacker News, plus any service you connect.', icon: Globe, agent: 'researcher', connectors: ['wikipedia', 'weather', 'hackernews'], text: 'Using Wikipedia, give me a short brief on Ada Lovelace with the key dates.' },
  { id: 'create', title: 'Create images & music', body: 'Generate images and short tracks on device (models download on request).', icon: Sparkles, text: 'Generate an image of a lighthouse on a cliff at sunset, painterly style.' }
];

/** Minimal, safe Markdown: paragraphs, bullets, numbered lists, headings, tables, code and bold. React elements only. */
function Markdown({ text }) {
  const inline = s => s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((t, i) => t.startsWith('**') && t.endsWith('**') ? <b key={i}>{t.slice(2, -2)}</b> : t.startsWith('`') && t.endsWith('`') && t.length > 1 ? <code key={i}>{t.slice(1, -1)}</code> : t);
  const blocks = []; let list = null;
  const lines = text.replace(/\r/g, '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('```')) { const code = []; while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]); blocks.push(<pre key={i} className="md-code">{code.join('\n')}</pre>); list = null; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || '')) {
      const cells = l => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = cells(line), rows = []; i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--; blocks.push(<div key={i} className="ui-table-wrap"><table className="ui-table"><thead><tr>{head.map((h, j) => <th key={j}>{inline(h)}</th>)}</tr></thead><tbody>{rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}</tbody></table></div>); list = null; continue;
    }
    const bullet = line.match(/^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/);
    if (bullet) { if (!list || list.ordered !== Boolean(bullet[1])) { list = { ordered: Boolean(bullet[1]), items: [] }; blocks.push(list); } list.items.push(bullet[2]); continue; }
    list = null;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) blocks.push(<h5 key={i}>{inline(heading[1])}</h5>);
    else if (line.trim()) blocks.push(<p key={i}>{inline(line)}</p>);
  }
  return <div className="md">{blocks.map((b, i) => b.items ? React.createElement(b.ordered ? 'ol' : 'ul', { key: 'l' + i }, b.items.map((t, j) => <li key={j}>{inline(t)}</li>)) : b)}</div>;
}

function ToolPart({ part }) {
  const [label, Icon] = toolMeta(part.name), running = part.status === 'running';
  const file = part.args?.file || part.args?.name || part.args?.query;
  return <div className={`tool-part ${part.status} ${part.nested ? 'nested' : ''}`}>
    <div className="tool-head"><span className="tool-icon"><Icon size={14} /></span><b>{label}</b>{file && <code>{String(file).slice(0, 60)}</code>}
      <span className="tool-status">{running ? <><Loader2 size={12} className="spin" /> {part.step || 'running'}</> : part.status === 'done' ? <><Check size={12} /> done</> : part.status}</span></div>
    {part.flow && <ol className="ui-steps live">{part.flow.map((s, i) => <li key={i} className={s.status}><span>{s.label}</span><small>{s.status}</small></li>)}</ol>}
    {part.display && <OpenUICard source={part.display} />}
  </div>;
}

function ApprovalCard({ part, onDecide }) {
  const [label] = toolMeta(part.tool);
  return <div className={`approval-card ${part.decision || 'pending'}`}>
    <div className="tool-head"><span className="tool-icon"><ShieldCheck size={14} /></span><b>Allow {label}?</b><code>{part.source === 'connector' ? '' : 'MCP · '}{part.server}</code></div>
    <p>This would change or send data outside your computer. It runs only if you allow it, and only once, with exactly these details:</p>
    <pre>{JSON.stringify(part.args, null, 2)}</pre>
    {part.decision ? <small className="decision">{part.decision}</small> : <div className="approval-actions"><button className="primary" onClick={() => onDecide(part, 'approve')}><Check size={14} /> Allow once</button><button className="secondary" onClick={() => onDecide(part, 'reject')}><X size={14} /> Decline</button></div>}
  </div>;
}

/** Earlier versions stored structured reports as JSON text; show them as readable Markdown. */
function legacyText(message) {
  if (!message.lang) return message.content;
  try {
    const r = JSON.parse(message.content.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
    return [`**${r.title}**`, r.summary, ...(r.findings?.length ? ['', ...r.findings.map(f => `- ${f}`)] : []), ...(r.nextSteps?.length ? ['', '**Next steps**', ...r.nextSteps.map(s => `- ${s}`)] : [])].join('\n');
  } catch { return message.content; }
}

function AssistantMessage({ message, onDecide, live }) {
  const parts = message.parts?.length ? message.parts : message.content ? [{ type: 'text', text: legacyText(message) }] : [];
  return <div className="message assistant">
    <div className="avatar"><Sparkles size={14} /></div>
    <div className="message-body">
      {parts.map((p, i) => p.type === 'text' ? (p.text.trim() && <Markdown key={i} text={p.text} />) : p.type === 'approval' ? <ApprovalCard key={p.id} part={p} onDecide={onDecide} /> : p.type === 'search' ? <span key={i} className="search-chip"><Search size={11} /> Found tools for “{p.query}”</span> : <ToolPart key={p.id || i} part={p} />)}
      {live && !parts.some(p => p.type === 'tool' && p.status === 'running') && <span className="thinking"><Loader2 size={13} className="spin" /> {parts.length ? 'Working…' : 'Thinking…'}</span>}
      {message.error && <p className="message-error"><CircleAlert size={14} /> {message.error}</p>}
      {!live && message.provenance && <small className="provenance">{message.provenance.model} · {message.provenance.agent}{message.provenance.tools?.length ? ` · ${message.provenance.tools.join(', ')}` : ''} · {(message.provenance.elapsedMs / 1000).toFixed(1)} s</small>}
    </div>
  </div>;
}

/** Microphone capture with a simple energy detector: in hands-free mode a pause ends the turn. */
function useRecorder() {
  const capture = useRef(null), [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0), [level, setLevel] = useState(0);
  async function start({ onSilence } = {}) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    const context = new AudioContext(), source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1), mute = context.createGain();
    mute.gain.value = 0; const item = { stream, context, processor, chunks: [], started: Date.now(), heard: false, quietSince: 0, noise: .008 };
    processor.onaudioprocess = e => {
      const data = e.inputBuffer.getChannelData(0); let sum = 0; for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / data.length), now = Date.now(); setLevel(Math.min(1, rms * 12));
      if (item.chunks.length * 4096 < context.sampleRate * 600) item.chunks.push(new Float32Array(data));
      if (!onSilence) return;
      if (now - item.started < 600) { item.noise = Math.max(item.noise, rms * 1.8); return; }
      if (rms > Math.max(.015, item.noise)) { item.heard = true; item.quietSince = 0; }
      else if (item.heard) { item.quietSince ||= now; if (now - item.quietSince > 1100) { item.heard = false; onSilence(); } }
      else if (now - item.started > 15000) onSilence({ timeout: true });
    };
    source.connect(processor); processor.connect(mute); mute.connect(context.destination);
    item.ticker = setInterval(() => setSeconds(Math.round((Date.now() - item.started) / 1000)), 250);
    capture.current = item; setSeconds(0); setRecording(true);
  }
  async function stop() {
    const item = capture.current; capture.current = null; setRecording(false); setLevel(0);
    if (!item) return null;
    clearInterval(item.ticker); item.processor.onaudioprocess = null; item.stream.getTracks().forEach(t => t.stop()); await item.context.close();
    return item.chunks.length ? wavFile(item.chunks, item.context.sampleRate) : null;
  }
  return { recording, seconds, level, start, stop };
}

function Composer({ state, busy, onSend, onStop, onAttach, onSample, error, agent, setAgent, speak, setSpeak, handsFree, setHandsFree }) {
  const [text, setText] = useState(''), [menu, setMenu] = useState(false);
  const fileInput = useRef(null), textarea = useRef(null), recorder = useRecorder(), [micError, setMicError] = useState('');
  const commands = text.startsWith('/') && !text.includes(' ') ? state.commands.filter(c => c.name.startsWith(text)) : [];
  const ttsReady = state.capabilities.find(c => c.id === 'tts')?.configured;
  const submit = () => { if (!text.trim() || busy) return; onSend({ text: text.trim(), agent, speak: speak && ttsReady }); setText(''); };
  const sendRecording = async ({ timeout } = {}) => {
    const file = await recorder.stop();
    if (timeout || !file) { if (handsFree) setHandsFree(false); return; }
    const attachment = await onAttach(file);
    onSend({ text: '', voiceAttachmentId: attachment.id, agent, speak: (speak || handsFree) && ttsReady });
  };
  // Hands-free: listen whenever idle; a pause sends the turn; the spoken reply finishing starts listening again.
  useEffect(() => {
    if (!handsFree) { if (recorder.recording) recorder.stop(); return; }
    if (!busy && !recorder.recording) recorder.start({ onSilence: sendRecording }).catch(e => { setMicError(e.message); setHandsFree(false); });
  }, [handsFree, busy]);
  async function toggleMic() {
    setMicError('');
    try {
      if (!recorder.recording) return await recorder.start();
      const file = await recorder.stop();
      if (!file) throw new Error('Nothing was recorded');
      const attachment = await onAttach(file);
      onSend({ text: text.trim(), voiceAttachmentId: attachment.id, agent, speak: speak && ttsReady }); setText('');
    } catch (e) { setMicError(e.message); }
  }
  const attachFile = async f => { if (!f) return; try { await onAttach(AUDIO.test(f.name) ? await toWav(f) : f); textarea.current?.focus(); } catch (e) { setMicError(e.message); } };
  const recent = state.attachments.slice(-6);
  return <div className="composer-wrap"
    onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); [...e.dataTransfer.files].forEach(attachFile); }}>
    {commands.length > 0 && <div className="command-menu">{commands.map(c => <button key={c.name} onClick={() => { setText(c.name + ' '); textarea.current?.focus(); }}><code>{c.name}</code><span>{c.help}</span></button>)}</div>}
    {menu && <div className="attach-menu" onMouseLeave={() => setMenu(false)}>
      <button onClick={() => { setMenu(false); fileInput.current.click(); }}><Paperclip size={14} /> Upload files<small>Audio · images · PDF · Word · CSV · text · BCI .bin. Or drop files here.</small></button>
      <div className="menu-label">Sample files</div>
      {['team-meeting.wav', 'remote-work-policy.pdf', 'vendor-onboarding.docx', 'meeting-recording.wav', 'voice-question.wav', 'invoice.png', 'business-sales.csv', 'meeting-notes.md', 'competitor-notes.md', 'neural_sample_2.bin'].map(name => <button key={name} onClick={async () => { setMenu(false); await onSample(name); textarea.current?.focus(); }}>{name}</button>)}
    </div>}
    {handsFree && <div className="handsfree-bar"><span className="pulse-dot" style={{ transform: `scale(${1 + recorder.level * 1.5})` }} />{busy ? 'Answering…' : recorder.recording ? 'Listening. Pause to send.' : 'Starting microphone…'}<button className="link" onClick={() => setHandsFree(false)}>End conversation</button></div>}
    <div className="composer">
      {recent.length > 0 && <div className="attachments">{recent.map(a => { const Icon = KIND_ICON[a.kind] || FileText; return <span key={a.id} className="attachment" title={a.name}><Icon size={13} /><b>{a.ref}</b>{a.name}</span>; })}</div>}
      <textarea ref={textarea} value={text} onChange={e => setText(e.target.value)} placeholder={recorder.recording && !handsFree ? `Recording… ${recorder.seconds}s. Press the mic again to send.` : 'Ask anything, drop a file, or type / for commands'} rows={2}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} disabled={recorder.recording && !handsFree} aria-label="Message" />
      <div className="composer-bar">
        <div>
          <button className="icon-button" title="Attach" aria-label="Attach" onClick={() => setMenu(!menu)} disabled={busy}><Plus size={17} /></button>
          <input ref={fileInput} type="file" hidden multiple accept=".wav,.mp3,.m4a,.aac,.ogg,.opus,.webm,.flac,.png,.jpg,.jpeg,.pdf,.docx,.bin,.csv,.txt,.md,.json" onChange={async e => { const files = [...e.target.files]; e.target.value = ''; for (const f of files) await attachFile(f); }} />
          <button className={`icon-button ${recorder.recording && !handsFree ? 'recording' : ''}`} title={recorder.recording ? 'Stop and send' : 'Voice message'} aria-label="Voice message" onClick={toggleMic} disabled={handsFree || (busy && !recorder.recording)}><Mic size={17} /></button>
          <button className={`icon-button ${handsFree ? 'on' : ''}`} title="Hands-free conversation" aria-label="Hands-free conversation" onClick={() => setHandsFree(!handsFree)} disabled={!ttsReady}><Headphones size={17} /></button>
          <button className={`icon-button ${speak && ttsReady ? 'on' : ''}`} title={ttsReady ? (speak ? 'Spoken replies on' : 'Spoken replies off') : 'Configure text-to-speech in Settings'} aria-label="Spoken replies" onClick={() => setSpeak(!speak)} disabled={!ttsReady}>{speak && ttsReady ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
          <span className="divider" />
          <label className="agent-select"><select value={agent} onChange={e => setAgent(e.target.value)} aria-label="Agent">{state.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><ChevronDown size={12} /></label>
        </div>
        {busy ? <button className="send stop" title="Stop" aria-label="Stop" onClick={onStop}><Square size={13} /></button> : <button className="send" title="Send" aria-label="Send" onClick={submit} disabled={!text.trim()}><ArrowUp size={17} /></button>}
      </div>
    </div>
    {(micError || error) && <p className="composer-error">{micError || error}</p>}
  </div>;
}

function App() {
  const [state, setState] = useState(null), [live, setLive] = useState(null), [error, setError] = useState(''), [settings, setSettings] = useState(null);
  const [history, setHistory] = useState(innerWidth > 900 && stored('qvac-history', true)), scroller = useRef(null);
  const [agent, setAgent] = useState(stored('qvac-agent', 'assistant')), [speak, setSpeak] = useState(stored('qvac-speak', false)), [handsFree, setHandsFree] = useState(false);
  const refresh = async () => { const s = await api('state'); setState(s); return s; };
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  useEffect(() => remember('qvac-history', history), [history]);
  useEffect(() => remember('qvac-agent', agent), [agent]);
  useEffect(() => remember('qvac-speak', speak), [speak]);
  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); }, [live, state?.messages?.length]);

  async function attach(file) {
    setError('');
    try { const record = await api('attachments', { conversationId: state.activeConversationId, ...(await fileUpload(file)) }); await refresh(); return record; }
    catch (e) { setError(e.message); throw e; }
  }
  async function sample(name) { setError(''); try { const r = await api('samples', { name, conversationId: state.activeConversationId }); await refresh(); return r; } catch (e) { setError(e.message); throw e; } }

  async function send(request) {
    setError('');
    const turn = { user: { role: 'user', content: request.text || '🎙 Voice message', voice: Boolean(request.voiceAttachmentId) }, assistant: { role: 'assistant', parts: [] } };
    const update = fn => setLive(prev => { const next = { user: prev.user, assistant: { ...prev.assistant, parts: [...prev.assistant.parts] } }; fn(next); return next; });
    setLive(turn);
    let spokeReply = false;
    try {
      const res = await fetch('/api/chat', { method: 'POST', headers: headers(), body: JSON.stringify({ ...request, conversationId: state.activeConversationId }) });
      if (!res.ok) throw new Error((await res.json()).error);
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = '';
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n'); buffer = frames.pop();
        for (const frame of frames) {
          const event = frame.match(/^event: (.*)$/m)?.[1], data = JSON.parse(frame.match(/^data: (.*)$/m)?.[1] || 'null');
          if (event === 'start' || event === 'user') update(t => { t.user = data.user; });
          if (event === 'delta') update(t => { const last = t.assistant.parts.at(-1); if (last?.type === 'text') t.assistant.parts[t.assistant.parts.length - 1] = { ...last, text: last.text + data.text }; else t.assistant.parts.push({ type: 'text', text: data.text }); });
          if (event === 'tool_start') update(t => { t.assistant.parts.push({ type: 'tool', id: data.id, name: data.name, args: data.args, status: 'running' }); });
          if (event === 'progress') update(t => { const i = t.assistant.parts.findLastIndex(p => p.name === data.tool && p.status === 'running'); if (i >= 0) t.assistant.parts[i] = { ...t.assistant.parts[i], step: data.step }; });
          if (event === 'tool_search') update(t => { t.assistant.parts.push({ type: 'search', query: data.query }); });
          if (event === 'tool_end') {
            if (data.audio && (request.speak || data.name === 'generate_music')) { markAutoplay(data.audio.id); if (data.name === 'speak') spokeReply = true; }
            update(t => { const i = t.assistant.parts.findIndex(p => p.id === data.id); const part = { type: 'tool', ...data }; if (i >= 0) t.assistant.parts[i] = { ...t.assistant.parts[i], ...part }; else t.assistant.parts.push(part); });
          }
          if (event === 'flow') update(t => { const i = t.assistant.parts.findLastIndex(p => p.name === 'run_flow' && p.status === 'running'); if (i >= 0) t.assistant.parts[i] = { ...t.assistant.parts[i], flow: data.steps }; });
          if (event === 'approval') update(t => { t.assistant.parts.push({ type: 'approval', ...data }); });
          if (event === 'approval_done') update(t => { const i = t.assistant.parts.findIndex(p => p.id === data.id); if (i >= 0) t.assistant.parts[i] = { ...t.assistant.parts[i], decision: data.decision }; });
          if (event === 'failure') update(t => { t.assistant.error = data.error; });
        }
      }
    } catch (e) { setError(e.message); }
    finally {
      await refresh().catch(() => {});
      // In hands-free mode, keep "busy" until the spoken reply finishes so the mic does not hear it.
      if (spokeReply && handsFree) await new Promise(r => { const done = () => { window.removeEventListener('qvac-audio-ended', done); r(); }; window.addEventListener('qvac-audio-ended', done); setTimeout(done, 60000); });
      setLive(null);
    }
  }
  async function stop() { await api('cancel', {}).catch(() => {}); }
  async function decide(part, decision) { try { await api('approvals', { id: part.id, decision, digest: part.digest }); } catch (e) { setError(e.message); } }
  async function openWorkspace(w) {
    try {
      if (state.messages.length) { await api('conversations', { action: 'create', title: w.title }); await refresh(); }
      if (w.agent) setAgent(w.agent);
      if (w.voice) { setHandsFree(true); return; }
      for (const id of w.connectors || []) if (!state.connectors.find(c => c.id === id)?.enabled) await api('connectors', { action: 'enable', id });
      if (w.sample) await sample(w.sample);
      await send({ text: w.text, agent: w.agent || agent, speak: false });
    } catch (e) { setError(e.message); }
  }

  if (!token) return <div className="boot"><span className="logo big">Q</span><h1>Open your private session link</h1><p>Start QVAC UI with <code>npm run open</code> or the launcher. The link it prints unlocks this browser.</p></div>;
  if (!state) return <div className="boot">{error ? <><CircleAlert size={30} /><h1>Can't reach QVAC UI</h1><p>{error}</p></> : <Loader2 className="spin" size={26} />}</div>;
  const conversation = state.conversations.find(c => c.id === state.activeConversationId);
  const busy = Boolean(live) || state.busy;
  const outside = state.tools.filter(t => t.source !== 'local');
  const localTools = state.tools.filter(t => t.source === 'local').length;
  const empty = !state.messages.length && !live;
  return <div className={`shell ${history ? 'with-history' : ''}`}>
    {history && <div className="history"><ChatManager conversations={state.conversations} activeConversationId={state.activeConversationId} api={api} refresh={refresh} onSelect={() => innerWidth < 900 && setHistory(false)} onCollapse={() => setHistory(false)} disabled={busy} /></div>}
    {history && innerWidth < 900 && <button className="history-scrim" aria-label="Close chats" onClick={() => setHistory(false)} />}
    <main>
      <header className="topbar">
        <button className="icon-button" aria-label={history ? 'Hide chats' : 'Show chats'} onClick={() => setHistory(!history)}>{history ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}</button>
        <div className="title"><span className="logo">Q</span><b>{conversation?.title || 'Chat'}</b></div>
        <div className="top-right">
          {state.offline && <button className="chip warn" onClick={() => setSettings('privacy')}><WifiOff size={12} />Offline</button>}
          <button className="chip" title={state.model.status} onClick={() => setSettings('models')}><span className={`dot ${state.model.configured ? 'ok' : 'bad'}`} />{state.model.configured ? state.model.label : 'Choose a model'}{state.model.vision && <Eye size={12} />}</button>
          <button className="chip" title={state.tools.map(t => t.name).join(', ')} onClick={() => setSettings('connectors')}><Wrench size={12} />{localTools} tools{outside.length ? ` · ${new Set(outside.map(t => t.server)).size} connected` : ''}</button>
          <button className="icon-button" aria-label="Settings" onClick={() => setSettings('models')}><Settings2 size={18} /></button>
        </div>
      </header>
      <section className="conversation" ref={scroller}>
        <div className="column">
          {empty ? <div className="welcome">
            <span className="logo big">Q</span>
            <h1>QVAC UI</h1>
            <p>A private AI copilot that runs on this computer. One local brain listens, reads, sees, speaks, translates, searches your files, runs skills and flows, and uses the services you connect.</p>
            {!state.model.configured && <button className="primary" onClick={() => setSettings('models')}><Cpu size={14} /> Choose a model to begin</button>}
            <div className="demos">{WORKSPACES.map(w => <button key={w.id} className="demo" disabled={busy || !state.model.configured} onClick={() => openWorkspace(w)}><w.icon size={17} /><b>{w.title}</b><small>{w.body}</small></button>)}</div>
            <div className="welcome-links"><button className="link" onClick={() => setSettings('connectors')}><PlugZap size={13} /> {state.connectors.length} connectors</button><button className="link" onClick={() => setSettings('skills')}><BookOpen size={13} /> {state.skills.filter(s => s.enabled).length} skills</button><button className="link" onClick={() => setSettings('mcp')}><Plug size={13} /> MCP servers</button></div>
          </div> : <>
            {state.messages.map(m => m.role === 'user' ? <div key={m.id} className="message user"><div className="bubble">{m.voice && <Mic size={13} />}{m.content}</div>{m.error && !state.messages.some(x => x.turnId === m.turnId && x.role === 'assistant') && <small className="message-error">{m.error}</small>}</div> : <AssistantMessage key={m.id} message={m} onDecide={decide} />)}
            {live && <><div className="message user"><div className="bubble">{live.user.voice && <Mic size={13} />}{live.user.content}</div></div><AssistantMessage message={live.assistant} live onDecide={decide} /></>}
          </>}
        </div>
      </section>
      <div className="column composer-column"><Composer state={state} busy={busy} onSend={send} onStop={stop} onAttach={attach} onSample={name => sample(name).catch(() => {})} error={error} agent={agent} setAgent={setAgent} speak={speak} setSpeak={setSpeak} handsFree={handsFree} setHandsFree={setHandsFree} /></div>
    </main>
    {settings && <Settings api={api} state={state} refresh={refresh} initialTab={settings} onClose={() => setSettings(null)} />}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
