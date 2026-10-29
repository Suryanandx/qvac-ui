import React, { useMemo, useState } from 'react';
import { MessageSquare, Plus, Search, Archive, ArchiveRestore, Pencil, Check, X, MoreHorizontal, PanelLeftClose, LockKeyhole } from 'lucide-react';
import './chat-manager.css';

const displayDate = value => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };

export function ChatManager({ conversations = [], activeConversationId, api, refresh, onSelect, onCollapse, disabled = false }) {
  const [filter, setFilter] = useState('active'), [query, setQuery] = useState(''), [renaming, setRenaming] = useState(null), [title, setTitle] = useState(''), [menu, setMenu] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const archivedCount = conversations.filter(chat => chat.archived).length;
  const shown = useMemo(() => conversations.filter(chat => Boolean(chat.archived) === (filter === 'archived') && (chat.title || 'Untitled chat').toLowerCase().includes(query.trim().toLowerCase())), [conversations, filter, query]);
  const locked = busy || disabled;
  async function act(action, args = {}) {
    if (locked) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api('conversations', { action, ...args });
      const state = await refresh?.();
      setMenu(null);
      if (action === 'create' || action === 'select') {
        const id = args.id || result.id || result.conversation?.id || result.activeConversationId || state?.activeConversationId;
        setFilter('active'); setQuery(''); setRenaming(null); onSelect?.(id);
      } else if (action === 'rename') { setRenaming(null); setNotice('Chat renamed.'); }
      else if (action === 'archive') { setNotice('Archived. Your messages are kept.'); if (args.id === activeConversationId) onSelect?.(state?.activeConversationId || result.activeConversationId); }
      else if (action === 'restore') { setNotice('Chat restored.'); setFilter('active'); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  function edit(chat) { setRenaming(chat.id); setTitle(chat.title || ''); setMenu(null); setError(''); }
  return <section className="chat-history" aria-label="Chat history"><header className="history-header"><div><span className="history-workspace">PERSONAL WORKSPACE</span><h2>Chats</h2></div><button className="icon-button" onClick={onCollapse} aria-label="Hide chat history" title="Hide chat history"><PanelLeftClose size={18}/></button></header>
    <div className="history-tools"><button className="history-new" disabled={locked} onClick={() => act('create')}><Plus size={17}/> New chat <span>Start fresh</span></button><label className="history-search"><Search size={15}/><input id="history-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your chats" aria-label="Find a conversation"/></label><div className="history-filters" aria-label="Chat visibility"><button className={filter === 'active' ? 'selected' : ''} aria-pressed={filter === 'active'} onClick={() => { setFilter('active'); setRenaming(null); setMenu(null); }}>Recent <span>{conversations.length - archivedCount}</span></button><button className={filter === 'archived' ? 'selected' : ''} aria-pressed={filter === 'archived'} onClick={() => { setFilter('archived'); setRenaming(null); setMenu(null); }}><Archive size={12}/> Archived <span>{archivedCount}</span></button></div></div>
    {error && <div className="history-error" role="alert">{error}</div>}{notice && <div className="history-notice" role="status"><Check size={12}/>{notice}<button aria-label="Dismiss chat notice" onClick={() => setNotice('')}><X size={12}/></button></div>}
    <div className="history-scroll">{shown.length ? <div className="history-list">{shown.map(chat => <article className={`history-item ${chat.id === activeConversationId && !chat.archived ? 'current' : ''}`} key={chat.id} data-conversation-id={chat.id}>
      {renaming === chat.id ? <form className="history-rename" onSubmit={e => { e.preventDefault(); if (title.trim()) act('rename', { id: chat.id, title: title.trim() }); }}><label htmlFor={`chat-title-${chat.id}`}>Conversation title</label><input id={`chat-title-${chat.id}`} value={title} onChange={e => setTitle(e.target.value)} maxLength={100} required autoFocus disabled={locked} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }}/><div><button className="quiet" type="button" onClick={() => setRenaming(null)} disabled={locked}>Cancel</button><button className="secondary" disabled={locked || !title.trim()} aria-label="Save chat title"><Check size={13}/> Save</button></div></form> : <><button className="history-open" disabled={locked || chat.archived} onClick={() => act('select', { id: chat.id })} aria-current={chat.id === activeConversationId && !chat.archived ? 'page' : undefined} aria-label={`Open chat: ${chat.title || 'Untitled chat'}`} title={chat.title || 'Untitled chat'}><MessageSquare size={16}/><span><b>{chat.title || 'Untitled chat'}</b><small>{chat.messageCount || 0} {(chat.messageCount || 0) === 1 ? 'message' : 'messages'}<i/>{displayDate(chat.updatedAt || chat.createdAt)}</small></span></button><button className="history-options" disabled={locked} aria-label={`Chat options: ${chat.title || 'Untitled chat'}`} aria-expanded={menu === chat.id} onClick={() => setMenu(menu === chat.id ? null : chat.id)}><MoreHorizontal size={16}/></button></>}
      {menu === chat.id && <div className="history-menu"><button disabled={locked} onClick={() => edit(chat)} aria-label={`Rename ${chat.title || 'Untitled chat'}`}><Pencil size={13}/> Rename</button>{chat.archived ? <button disabled={locked} onClick={() => act('restore', { id: chat.id })} aria-label={`Restore ${chat.title || 'Untitled chat'}`}><ArchiveRestore size={13}/> Restore</button> : <button disabled={locked} onClick={() => act('archive', { id: chat.id })} aria-label={`Archive ${chat.title || 'Untitled chat'}`}><Archive size={13}/> Archive</button>}</div>}
    </article>)}</div> : <div className="history-empty"><MessageSquare size={25}/><h3>{query.trim() ? 'No matching chats' : filter === 'archived' ? 'No archived chats' : 'A fresh start.'}</h3><p>{query.trim() ? 'Try another title.' : filter === 'archived' ? 'Chats you archive will appear here.' : 'Start a conversation with your local assistant.'}</p>{query.trim() && <button className="quiet" onClick={() => setQuery('')}>Clear search</button>}</div>}</div>
    <footer className="history-footer">{disabled ? <p className="history-locked">Finish or stop the current response before switching chats.</p> : <><LockKeyhole size={13}/><div><b>Private, on this device</b><small>Your chats stay in your local workspace.</small></div></>}</footer>
  </section>;
}
export default ChatManager;
