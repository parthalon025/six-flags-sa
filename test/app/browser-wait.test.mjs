#!/usr/bin/env node
/**
 * Contract tests for browser wait helpers (#315).
 *
 * Seams: heightsGateReady predicate, formatWaitTimeoutError, until() diagnose hook.
 */
import assert from 'node:assert/strict';
import { heightsGateReady, formatWaitTimeoutError, until } from './browser.mjs';

assert.equal(
  heightsGateReady({ gateCount: 0, mapDrawn: true, ridesTabCount: 1 }),
  true,
  'ready when gate is gone, map drawn, Plan tab mounted',
);

assert.equal(
  heightsGateReady({ gateCount: 1, mapDrawn: true, ridesTabCount: 1 }),
  false,
  'not ready while a gate overlay is up',
);

assert.equal(
  heightsGateReady({ gateCount: 0, mapDrawn: false, ridesTabCount: 1 }),
  false,
  'not ready before the map has drawn markers',
);

assert.equal(
  heightsGateReady({ gateCount: 0, mapDrawn: true, ridesTabCount: 0 }),
  false,
  'not ready before the tab bar mounts the Plan tab',
);

const formatted = formatWaitTimeoutError({
  label: 'rides tab after POI load',
  last: false,
  diagnose: { gateCount: 1, mapDrawn: false, ridesTabCount: 0, screenshot: 'test/shots/wait-fail-rides.png' },
});
assert.match(formatted, /timed out waiting for rides tab after POI load/);
assert.match(formatted, /"gateCount":1/);
assert.match(formatted, /"screenshot":"test\/shots\/wait-fail-rides\.png"/);

let diagnosed = false;
try {
  await until(async () => false, {
    timeout: 50,
    step: 10,
    label: 'probe',
    diagnose: async () => {
      diagnosed = true;
      return { gateCount: 2 };
    },
  });
} catch (err) {
  assert.ok(diagnosed, 'diagnose runs on timeout');
  assert.match(err.message, /"gateCount":2/);
}

console.log('browser-wait.test.mjs: ok');
