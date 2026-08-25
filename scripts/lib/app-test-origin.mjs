/**
 * App test origin — less-contended default port, ephemeral reservation, and
 * health probes with errors that name the origin instead of cascading into
 * bogus suite failures.
 *
 * Interface:
 *   FALLBACK_APP_PORT
 *   appOrigin(port?, host?)
 *   healthUrl(origin)
 *   reserveAppPort()
 *   probeAppHealth(url, { fetchFn, timeoutMs })
 *   watchOriginHealth(url, { fetchFn, intervalMs, onDown }) → stop
 */
import { createServer } from 'node:net';

/** Deliberately not 3000 — dev servers and other tools fight for it. */
export const FALLBACK_APP_PORT = 3118;

export function appOrigin(port = FALLBACK_APP_PORT, host = '127.0.0.1') {
  return `http://${host}:${port}`;
}

export function healthUrl(origin) {
  return `${origin.replace(/\/+$/, '')}/api/health`;
}

export function reserveAppPort({ host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      resolve({
        port,
        release: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}

function formatProbeFailure(origin, detail) {
  return `no app is listening at ${origin.replace(/\/+$/, '')} (${detail})`;
}

export async function probeAppHealth(
  url,
  { fetchFn = globalThis.fetch, timeoutMs = 10_000 } = {},
) {
  if (!fetchFn) throw new Error('app-test-origin: fetch is required');
  const origin = url.replace(/\/api\/health\/?$/, '');
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`/api/health returned ${res.status}`);
    const body = await res.json().catch(() => ({}));
    if (body.ok === false) throw new Error('health body not ok');
    return true;
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      throw new Error(formatProbeFailure(origin, 'health probe timed out'));
    }
    const msg = String(err?.message || err);
    if (/ECONNREFUSED|fetch failed|Failed to fetch|ENOTFOUND/i.test(msg)) {
      throw new Error(formatProbeFailure(origin, msg));
    }
    throw err;
  }
}

export function watchOriginHealth(
  url,
  { fetchFn = globalThis.fetch, intervalMs = 5_000, onDown } = {},
) {
  if (!fetchFn) throw new Error('app-test-origin: fetch is required');
  if (typeof onDown !== 'function') throw new Error('app-test-origin: onDown is required');
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      await probeAppHealth(url, { fetchFn, timeoutMs: intervalMs });
    } catch (err) {
      if (!stopped) onDown(err);
    }
  };
  const id = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  tick().catch(() => {});
  return () => {
    stopped = true;
    clearInterval(id);
  };
}
