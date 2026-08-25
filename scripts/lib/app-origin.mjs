/**
 * App origin — default port, URL shaping, and unreachable-origin messages.
 *
 * Interface:
 *   resolveDefaultBaseUrl({ env })
 *   baseUrlFromPort(port, host?)
 *   healthUrlFromBase(base)
 *   allocateEphemeralPort(host?)
 *   isOriginUnreachable(err)
 *   originProbeFailureMessage(base, err)
 *   originLostMidRunMessage(base)
 */
import net from 'node:net';

/** Less contended than 3000 — validate-ui and pre-merge-vertical default here. */
export const VALIDATE_UI_DEFAULT_PORT = 3118;

export function baseUrlFromPort(port, host = '127.0.0.1') {
  return `http://${host}:${port}`;
}

export function resolveDefaultBaseUrl({ env = process.env } = {}) {
  const fromEnv = env.BASE_URL?.replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  return baseUrlFromPort(VALIDATE_UI_DEFAULT_PORT);
}

export function healthUrlFromBase(base) {
  return `${base.replace(/\/+$/, '')}/api/health`;
}

export function allocateEphemeralPort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.once('listening', () => {
      const { port } = probe.address();
      probe.close((err) => (err ? reject(err) : resolve(port)));
    });
    probe.listen(0, host);
  });
}

export function isOriginUnreachable(err) {
  const msg = String(err?.message || err || '');
  return /ECONNREFUSED|ERR_CONNECTION_REFUSED|fetch failed/i.test(msg);
}

export function originProbeFailureMessage(base, err) {
  const port = base.match(/:(\d+)\/?$/)?.[1] || VALIDATE_UI_DEFAULT_PORT;
  return [
    `No app responding at ${base} — start the server first`,
    `(e.g. PORT=${port} npm start -w @party-tracker/app) or set BASE_URL.`,
    `(${err?.message || err})`,
  ].join(' ');
}

export function originLostMidRunMessage(base) {
  return [
    `App at ${base} stopped responding mid-run`,
    '— remaining suites aborted to avoid bogus failures.',
    'Re-run on a free port (set BASE_URL or stop whatever killed the server).',
  ].join(' ');
}
