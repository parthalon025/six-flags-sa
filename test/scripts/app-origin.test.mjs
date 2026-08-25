#!/usr/bin/env node
/**
 * App origin helpers — port allocation and clear unreachable-origin messages.
 *
 *   node test/scripts/app-origin.test.mjs
 */
import assert from 'node:assert/strict';
import {
  VALIDATE_UI_DEFAULT_PORT,
  allocateEphemeralPort,
  baseUrlFromPort,
  healthUrlFromBase,
  isOriginUnreachable,
  originLostMidRunMessage,
  originProbeFailureMessage,
  resolveDefaultBaseUrl,
} from '../../scripts/lib/app-origin.mjs';

assert.equal(VALIDATE_UI_DEFAULT_PORT, 3118, 'validate-ui defaults off the contended 3000 port');

assert.equal(
  resolveDefaultBaseUrl({ env: {} }),
  'http://127.0.0.1:3118',
  'unset BASE_URL falls back to the less-contended port',
);
assert.equal(
  resolveDefaultBaseUrl({ env: { BASE_URL: 'http://127.0.0.1:3999/' } }),
  'http://127.0.0.1:3999',
  'BASE_URL wins and trailing slashes are trimmed',
);

assert.equal(baseUrlFromPort(3118), 'http://127.0.0.1:3118');
assert.equal(healthUrlFromBase('http://127.0.0.1:3118'), 'http://127.0.0.1:3118/api/health');

assert.equal(isOriginUnreachable(new Error('fetch failed')), true);
assert.equal(isOriginUnreachable(new Error('ECONNREFUSED')), true);
assert.equal(isOriginUnreachable(new Error('ERR_CONNECTION_REFUSED')), true);
assert.equal(isOriginUnreachable(new Error('timeout')), false);

const probeMsg = originProbeFailureMessage('http://127.0.0.1:3118', new Error('ECONNREFUSED'));
assert.match(probeMsg, /No app responding at http:\/\/127\.0\.0\.1:3118/);
assert.match(probeMsg, /BASE_URL/);

const lostMsg = originLostMidRunMessage('http://127.0.0.1:3118');
assert.match(lostMsg, /stopped responding mid-run/);
assert.match(lostMsg, /bogus failures/);

const port = await allocateEphemeralPort();
assert.ok(Number.isInteger(port) && port > 0, 'ephemeral port is a positive integer');

console.log('app-origin: ok');
