#!/usr/bin/env node
/**
 * UI test origin — ephemeral port claim and health-probe messaging (#573).
 *
 *   node test/scripts/ui-test-origin.test.mjs
 */
import assert from 'node:assert/strict';
import {
  bindEphemeralPort,
  describeHealthFailure,
  failureMessageForSuiteClose,
  healthUrlForPort,
  isOriginUnreachableError,
  originForPort,
} from '../../scripts/lib/ui-test-origin.mjs';

const port = await bindEphemeralPort();
assert.ok(Number.isInteger(port) && port > 0, 'bindEphemeralPort returns a positive integer');

const port2 = await bindEphemeralPort();
assert.notEqual(port, port2, 'each claim gets a distinct port');

assert.equal(originForPort(3118), 'http://127.0.0.1:3118');
assert.equal(healthUrlForPort(3118), 'http://127.0.0.1:3118/api/health');

assert.match(
  describeHealthFailure('http://127.0.0.1:3118', new Error('fetch failed')),
  /no app answering at http:\/\/127\.0\.0\.1:3118/,
);
assert.match(describeHealthFailure('http://127.0.0.1:3118', new Error('fetch failed')), /BASE_URL/);

assert.equal(isOriginUnreachableError('ERR_CONNECTION_REFUSED'), true);
assert.equal(isOriginUnreachableError('connect ECONNREFUSED 127.0.0.1:3000'), true);
assert.equal(isOriginUnreachableError('functional.mjs exited with code 1'), false);

assert.equal(
  failureMessageForSuiteClose({
    output: 'Error: connect ECONNREFUSED 127.0.0.1:3000\n',
    script: 'functional.mjs',
    name: 'functional:smoke',
    base: 'http://127.0.0.1:3000',
    code: 1,
  }),
  'origin at http://127.0.0.1:3000 stopped answering during functional:smoke',
);
assert.equal(
  failureMessageForSuiteClose({
    output: 'FAIL assertion\n',
    script: 'functional.mjs',
    name: 'functional:smoke',
    base: 'http://127.0.0.1:3000',
    code: 1,
  }),
  'functional.mjs exited with code 1',
);

console.log('ui-test-origin: ok');
