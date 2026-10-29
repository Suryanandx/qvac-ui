import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * AES-256-GCM encryption for connector credentials. The key lives in the
 * macOS Keychain (per workspace) when available, otherwise in a 0600 key
 * file inside the private workspace directory. Set QVAC_UI_KEYCHAIN=0 to
 * force the key file (used by tests).
 */
export class Secrets {
  constructor(directory) { this.directory = directory; this.account = createHash('sha256').update(directory).digest('hex').slice(0, 24); }
  async key() {
    if (this.cached) return this.cached;
    const useKeychain = process.platform === 'darwin' && process.env.QVAC_UI_KEYCHAIN !== '0';
    if (useKeychain) {
      try {
        const { stdout } = await run('security', ['find-generic-password', '-s', 'qvac-ui', '-a', this.account, '-w']);
        if (/^[a-f0-9]{64}$/.test(stdout.trim())) return (this.cached = Buffer.from(stdout.trim(), 'hex'));
      } catch { /* not created yet */ }
      const fresh = randomBytes(32).toString('hex');
      try { await run('security', ['add-generic-password', '-U', '-s', 'qvac-ui', '-a', this.account, '-w', fresh]); this.where = 'keychain'; return (this.cached = Buffer.from(fresh, 'hex')); }
      catch { /* fall back to a key file */ }
    }
    const path = join(this.directory, 'secrets.key');
    try { const hex = (await readFile(path, 'utf8')).trim(); if (/^[a-f0-9]{64}$/.test(hex)) { this.where = 'file'; return (this.cached = Buffer.from(hex, 'hex')); } } catch { /* create below */ }
    const fresh = randomBytes(32).toString('hex');
    await writeFile(path, fresh, { mode: 0o600, flag: 'wx' }).catch(async e => { if (e.code !== 'EEXIST') throw e; });
    this.where = 'file';
    return (this.cached = Buffer.from((await readFile(path, 'utf8')).trim(), 'hex'));
  }
  async seal(value) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64')).join('.');
  }
  async open(sealed) {
    const [iv, tag, data] = sealed.split('.').map(p => Buffer.from(p, 'base64'));
    const decipher = createDecipheriv('aes-256-gcm', await this.key(), iv); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'));
  }
}
