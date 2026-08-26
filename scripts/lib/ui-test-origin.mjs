/**
 * UI test origin — ephemeral port claim and health-probe helpers (#573).
 *
 * Interface:
 *   bindEphemeralPort({ host })
 *   originForPort(port, host)
 *   healthUrlForPort(port, host)
 *   describeHealthFailure(base, err)
 *   isOriginUnreachableError(message)
 *   failureMessageForSuiteClose({ output, script, name, base, code })
 */
import { createServer } from 'node:net';

/** Bind port 0, read the assigned port, then release the listener. */
export function bindEphemeralPort({ host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : null;
      server.close((err) => {
        if (err) reject(err);
        else if (!port) reject(new Error('ui-test-origin: could not read ephemeral port'));
        else resolve(port);
      });
    });
  });
}

export function originForPort(port, host = '127.0.0.1') {
  return `http://${host}:${port}`;
}

export function healthUrlForPort(port, host = '127.0.0.1') {
  return `${originForPort(port, host)}/api/health`;
}

/** Actionable message when the pre-flight health probe fails. */
export function describeHealthFailure(base, err) {
  const detail = err?.message || String(err);
  return [
    `no app answering at ${base}`,
    'start the server first (npm run build && PORT=<port> npm start)',
    'or set BASE_URL to an already-running instance',
    `(${detail})`,
  ].join(' — ');
}

/** Map a child suite exit to the error runPool should record. */
export function failureMessageForSuiteClose({ output, script, name, base, code }) {
  if (!code) return null;
  if (isOriginUnreachableError(output)) {
    return `origin at ${base} stopped answering during ${name}`;
  }
  return `${script} exited with code ${code}`;
}

/** Did a suite failure look like the origin died mid-run rather than a real assertion? */
export function isOriginUnreachableError(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('econnrefused') ||
    m.includes('connection refused') ||
    m.includes('err_connection_refused')
  );
}
