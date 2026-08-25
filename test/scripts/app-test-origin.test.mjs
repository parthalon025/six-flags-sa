#!/usr/bin/env node
/**
 * app-test-origin — port reservation and health probes for UI validation.
 *
 *   node test/scripts/app-test-origin.test.mjs
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import {
  FALLBACK_APP_PORT,
  appOrigin,
  healthUrl,
  probeAppHealth,
  reserveAppPort,
  watchOriginHealth,
} from '../../scripts/lib/app-test-origin.mjs';

assert.equal(appOrigin(), `http://127.0.0.1:${FALLBACK_APP_PORT}`);
assert.equal(healthUrl('http://127.0.0.1:3118/'), 'http://127.0.0.1:3118/api/health');

await assert.rejects(
  () => probeAppHealth('http://127.0.0.1:1/api/health', { fetchFn: async () => { throw new Error('ECONNREFUSED'); } }),
  /no app is listening/i,
  'refused connection names the origin clearly',
);

await assert.rejects(
  () => probeAppHealth('http://127.0.0.1:3118/api/health', { fetchFn: async () => ({ ok: false, status: 503 }) }),
  /\/api\/health returned 503/i,
);

const port = await reserveAppPort();
assert.ok(Number.isInteger(port.port) && port.port > 0, 'reserveAppPort yields a positive integer');
let blocked = false;
await new Promise((resolve) => {
  const s = createServer();
  s.once('error', (err) => {
    if (err.code === 'EADDRINUSE') blocked = true;
    resolve();
  });
  s.listen(port.port, '127.0.0.1', () => s.close(resolve));
});
assert.equal(blocked, true, 'held port blocks concurrent bind');
await port.release();

let downReason = '';
const stop = watchOriginHealth('http://127.0.0.1:9/api/health', {
  intervalMs: 5,
  fetchFn: async () => {
    throw new Error('ECONNREFUSED');
  },
  onDown: (err) => {
    downReason = err.message;
  },
});
await new Promise((r) => setTimeout(r, 20));
stop();
assert.match(downReason, /no app is listening/i, 'watcher reports origin loss');

console.log('app-test-origin: ok');
