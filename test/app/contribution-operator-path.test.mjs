#!/usr/bin/env node
/**
 * Operator-path availability probe for contribution-pipeline HTTP gating (#774).
 *
 *   node test/app/contribution-operator-path.test.mjs
 */

import assert from 'node:assert/strict';
import { contributionOperatorPathAvailable } from './lib/contribution-pipeline-vertical.mjs';

let failed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log('PASS', name);
  } catch (err) {
    failed += 1;
    console.error('FAIL', name, '->', err.message);
  }
};

const BASE = 'http://127.0.0.1:3118';

await check('metrics 200 means operator path is available', async () => {
  const result = await contributionOperatorPathAvailable(BASE, {
    fetchFn: async () => ({ ok: true, status: 200 }),
  });
  assert.equal(result, true);
});

await check('metrics 404 means operator path is gated — skip, do not fail', async () => {
  const prev = process.env.METRICS_TOKEN;
  const prevGuest = process.env.GUEST_TRACES_TOKEN;
  delete process.env.METRICS_TOKEN;
  delete process.env.GUEST_TRACES_TOKEN;
  try {
    const result = await contributionOperatorPathAvailable(BASE, {
      fetchFn: async () => ({ ok: false, status: 404, text: async () => '{"error":"Not found"}' }),
    });
    assert.notEqual(result, true);
    assert.equal(result.ok, false);
    assert.equal(result.status, 404);
    assert.match(result.reason, /operator/i);
  } finally {
    if (prev == null) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = prev;
    if (prevGuest == null) delete process.env.GUEST_TRACES_TOKEN;
    else process.env.GUEST_TRACES_TOKEN = prevGuest;
  }
});

await check('client METRICS_TOKEN is sent as Bearer on the metrics probe', async () => {
  const prev = process.env.METRICS_TOKEN;
  process.env.METRICS_TOKEN = 'probe-token';
  delete process.env.GUEST_TRACES_TOKEN;
  try {
    let seenAuth = '';
    const result = await contributionOperatorPathAvailable(BASE, {
      fetchFn: async (_url, init) => {
        seenAuth = init?.headers?.authorization || '';
        return { ok: true, status: 200 };
      },
    });
    assert.equal(result, true);
    assert.equal(seenAuth, 'Bearer probe-token');
  } finally {
    if (prev == null) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = prev;
  }
});

if (failed) {
  console.error(`\ncontribution-operator-path.test.mjs: ${failed} failed`);
  process.exit(1);
}
console.log(`\ncontribution-operator-path.test.mjs: ${3 - failed} ok`);
