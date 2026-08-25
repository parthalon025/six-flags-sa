#!/usr/bin/env node
/**
 * validate-ui origin-loss detection — abort before bogus party-mesh failures.
 *
 *   node test/app/validate-ui-origin.test.mjs
 */
import assert from 'node:assert/strict';
import {
  classifySuiteFailure,
  shouldAbortAfterSuiteFailure,
  shouldAbortQueueOnFailure,
} from './lib/validate-ui-origin.mjs';

assert.equal(
  classifySuiteFailure('functional.mjs exited with code 1'),
  'suite-failed',
  'ordinary suite exit stays a suite failure',
);
assert.equal(
  classifySuiteFailure('fetch failed'),
  'origin-lost',
  'connection refused mid-run is origin loss',
);
assert.equal(
  classifySuiteFailure('functional:party: ERR_CONNECTION_REFUSED'),
  'origin-lost',
);

assert.equal(shouldAbortQueueOnFailure('origin-lost'), true);
assert.equal(shouldAbortQueueOnFailure('suite-failed'), false);

assert.equal(
  shouldAbortAfterSuiteFailure({
    suiteError: 'functional.mjs exited with code 1',
    originAlive: false,
  }),
  true,
  'a dead origin aborts even when the suite only reports an exit code',
);
assert.equal(
  shouldAbortAfterSuiteFailure({
    suiteError: 'functional.mjs exited with code 1',
    originAlive: true,
  }),
  false,
);

console.log('validate-ui-origin: ok');
