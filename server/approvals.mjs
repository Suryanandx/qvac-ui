import { randomUUID } from 'node:crypto';
import { hash } from './store.mjs';

/**
 * Human approval for tools with outside effects (MCP). The chat stream pauses
 * on a pending approval until the user decides in the UI; each approval is
 * bound to the exact tool name and arguments, used once, and expires.
 */
export class Approvals {
  constructor(store, { timeoutMs = 300000 } = {}) { this.store = store; this.timeoutMs = timeoutMs; this.pending = new Map(); }
  request({ tool, args, conversationId, signal }) {
    const id = randomUUID(), digest = hash({ tool, args });
    let settle;
    const decision = new Promise(resolve => { settle = resolve; });
    const finish = value => { if (!this.pending.has(id)) return; this.pending.delete(id); clearTimeout(timer); signal?.removeEventListener('abort', onAbort); this.store.log('approval.decided', { id, tool, digest, decision: value }); settle(value); };
    const timer = setTimeout(() => finish('expired'), this.timeoutMs);
    const onAbort = () => finish('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    this.pending.set(id, { id, tool, args, digest, conversationId, finish });
    this.store.log('approval.requested', { id, tool, digest, conversationId });
    if (signal?.aborted) onAbort();
    return { id, digest, decision };
  }
  decide(id, decision, digest) {
    const item = this.pending.get(id);
    if (!item) throw new Error('This approval was already used, expired or cancelled');
    if (digest !== item.digest) throw new Error('Approval payload changed');
    if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid decision');
    item.finish(decision === 'approve' ? 'approved' : 'rejected');
    return { id, decision };
  }
  list() { return [...this.pending.values()].map(({ finish, ...item }) => item); }
}
