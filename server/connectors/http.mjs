// Small HTTP client for connectors: JSON in/out, bounded responses, timeouts
// and error messages that never echo credentials.
const LIMIT = 2_000_000;

export class ConnectorError extends Error {}

export async function request(method, url, { headers = {}, query, body, form, signal, timeout = 30000, fetchImpl = globalThis.fetch } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(u.hostname)) throw new ConnectorError('Connectors only call HTTPS endpoints');
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const timer = AbortSignal.timeout(timeout), combined = signal ? AbortSignal.any([signal, timer]) : timer;
  const init = { method, headers: { Accept: 'application/json', 'User-Agent': 'QVAC-UI/0.3', ...headers }, signal: combined, redirect: 'follow' };
  if (form) { init.body = new URLSearchParams(form); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const res = await fetchImpl(u, init);
  const text = await res.text();
  if (text.length > LIMIT) throw new ConnectorError('Response too large');
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const detail = typeof data === 'object' && data ? (data.message || data.error?.message || data.error_description || data.error || data.errors?.[0]?.message || JSON.stringify(data).slice(0, 200)) : String(data).slice(0, 200);
    throw new ConnectorError(`${u.hostname} returned HTTP ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`.slice(0, 400));
  }
  return data;
}

export const bearer = token => ({ Authorization: `Bearer ${token}` });
export const basic = (user, pass) => ({ Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` });

/** Accept a bare hostname or an https URL; return the https origin. */
export function httpsOrigin(value, { suffix } = {}) {
  const raw = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const u = new URL(raw);
  if (u.protocol !== 'https:' || u.username || u.password) throw new ConnectorError('Use an https:// address without credentials');
  if (suffix && !u.hostname.endsWith(suffix)) throw new ConnectorError(`Expected a *${suffix} address`);
  return u.origin;
}
