import { constants } from 'node:fs';
import { mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const appRoot = fileURLToPath(new URL('../', import.meta.url));
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
export const defaultWorkspace = () => resolve(process.env.QVAC_UI_DATA || join(appRoot, '.local'));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

async function privateJSON(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const info = await file.stat();
    if (!info.isFile() || info.size > 16384 || (process.getuid && info.uid !== process.getuid()) || (process.platform !== 'win32' && (info.mode & 0o077))) throw new Error('Unsafe local session file ownership or permissions');
    return JSON.parse(await file.readFile('utf8'));
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  finally { await file?.close(); }
}

async function removeOwned(path, owner) {
  const record = await privateJSON(path).catch(() => null);
  if (record?.owner === owner && record.pid === process.pid) await unlink(path).catch(e => { if (e.code !== 'ENOENT') throw e; });
}

/** Return a verified live service; never send its bearer token off loopback. */
export async function readSession(directory = defaultWorkspace()) {
  let canonical;
  try { canonical = await realpath(directory); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const record = await privateJSON(join(canonical, 'session.json'));
  if (!record) return null;
  if (record.version !== 1 || record.directory !== canonical || !Number.isSafeInteger(record.pid) || record.pid < 1 || typeof record.owner !== 'string' || !alive(record.pid)) return null;
  let url;
  try { url = new URL(record.url); } catch { return null; }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.pathname !== '/' || url.search || !/^#[a-f0-9]{64}$/.test(url.hash) || url.origin !== record.origin) return null;
  try {
    const response = await fetch(`${url.origin}/api/state`, { redirect: 'error', headers: { Authorization: `Bearer ${url.hash.slice(1)}` }, signal: AbortSignal.timeout(2000) });
    if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) return null;
    const state = await response.json();
    if (!state?.model || !Array.isArray(state.conversations) || typeof state.activeConversationId !== 'string') return null;
    return record;
  } catch { return null; }
}

async function assertPortAvailable(port) {
  if (!port) return;
  const probe = net.createServer();
  await new Promise((resolveListen, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolveListen); });
  await new Promise(resolveClose => probe.close(resolveClose));
}

/** One owner per workspace. Reusers never open SQLite or shut down its owner. */
export async function startSession({ createApp, directory = defaultWorkspace(), port = 4317, waitMs = 15000 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT must be an integer from 0 to 65535');
  await mkdir(directory, { recursive: true, mode: 0o700 }); directory = await realpath(directory);
  const sessionPath = join(directory, 'session.json'), lockPath = join(directory, 'server.lock');
  const owner = randomUUID(), deadline = Date.now() + waitMs;
  while (true) {
    const running = await readSession(directory);
    if (running) return { ...running, owned: false, close: async () => {} };
    let lock;
    try { lock = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600); }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const previous = await privateJSON(lockPath).catch(e => { if (e instanceof SyntaxError) return null; throw e; });
      if (previous && Number.isSafeInteger(previous.pid) && previous.pid > 0 && !alive(previous.pid)) {
        // Serialize stale-lock recovery so two launchers cannot delete a new
        // owner's lock between checking an old record and unlinking its path.
        const recoveryPath = join(directory, 'server-recovery.lock');
        let recovery;
        try { recovery = await open(recoveryPath, 'wx', 0o600); }
        catch (error) { if (error.code !== 'EEXIST') throw error; if (Date.now() >= deadline) throw new Error('Workspace startup recovery is already in progress.'); await pause(200); continue; }
        try {
          await recovery.writeFile(JSON.stringify({ owner, pid: process.pid }));
          const check = await privateJSON(lockPath);
          if (check?.owner === previous.owner && check?.pid === previous.pid && !alive(check.pid)) await unlink(lockPath).catch(e => { if (e.code !== 'ENOENT') throw e; });
        } finally { await recovery.close(); await removeOwned(recoveryPath, owner); }
        continue;
      }
      if (Date.now() >= deadline) throw new Error('This workspace is already starting or its owner is not responding. Close the existing QVAC UI process before retrying.');
      await pause(200); continue;
    }
    await lock.writeFile(JSON.stringify({ version: 1, owner, pid: process.pid, directory, startedAt: new Date().toISOString() })); await lock.close();
    let service;
    try {
      // A pre-session or unrelated server on this port must never cause a second
      // SQLite instance to open before createApp discovers its occupied port.
      await assertPortAvailable(port);
      service = await createApp({ directory, port });
      const record = { version: 1, owner, pid: process.pid, directory, origin: service.origin, url: service.url, startedAt: new Date().toISOString() };
      const temporary = join(directory, `.session-${owner}.tmp`);
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(record, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
      await rename(temporary, sessionPath);
      let closed = false;
      return { ...service, ...record, owned: true, close: async () => {
        if (closed) return; closed = true;
        try { await service.close(); }
        finally { await removeOwned(sessionPath, owner); await removeOwned(lockPath, owner); }
      } };
    } catch (e) {
      await service?.close().catch(() => {}); await removeOwned(sessionPath, owner); await removeOwned(lockPath, owner);
      if (e.code === 'EADDRINUSE') throw new Error(`Port ${port} already has a service without a matching authenticated workspace session. Stop it or choose another PORT.`);
      throw e;
    }
  }
}
