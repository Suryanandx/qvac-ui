import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'workspace.sqlite'));
    chmodSync(join(directory, 'workspace.sqlite'), 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, event TEXT, body TEXT, previous TEXT, digest TEXT);
    `);
  }
  list(kind) { return this.db.prepare('SELECT body FROM records WHERE kind=? ORDER BY rowid DESC').all(kind).map(r => JSON.parse(r.body)); }
  get(kind, id) { const row = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?').get(kind, id); if (!row) throw new Error('Record not found'); return JSON.parse(row.body); }
  put(kind, body) { const item = { id: randomUUID(), createdAt: new Date().toISOString(), ...body }; this.db.prepare('INSERT INTO records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE records.kind=excluded.kind').run(item.id, kind, JSON.stringify(item)); return item; }
  log(event, body) {
    const at = new Date().toISOString(), previous = this.db.prepare('SELECT digest FROM audit ORDER BY seq DESC LIMIT 1').get()?.digest || 'genesis';
    const serialized = JSON.stringify(body), digest = hash({ at, event, body: serialized, previous });
    this.db.prepare('INSERT INTO audit(at,event,body,previous,digest) VALUES(?,?,?,?,?)').run(at, event, serialized, previous, digest);
  }
  audit() { return this.db.prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 200').all().map(r => ({ ...r, body: JSON.parse(r.body) })); }
  verify() { let previous = 'genesis'; for (const r of this.db.prepare('SELECT * FROM audit ORDER BY seq').all()) { if (r.previous !== previous || hash({ at: r.at, event: r.event, body: r.body, previous }) !== r.digest) return false; previous = r.digest; } return true; }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  remove(kind, id) { this.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind, id); }
  count(kind, field) { const counts = {}; for (const { value } of this.db.prepare("SELECT json_extract(body, '$.' || ?) AS value FROM records WHERE kind=?").all(field, kind)) counts[value] = (counts[value] || 0) + 1; return counts; }
  close() { this.db.close(); }
}
