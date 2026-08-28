#!/usr/bin/env node
/**
 * lib/guestTraces.js — #379: a venue batch must land in at most 2 Upstash
 * round trips, not N sequential LPUSH calls plus two more.
 *
 * The Redis path needs `usingRedis === true`, which lib/serverStore.js reads
 * from the environment at import time — so this file sets Upstash creds and
 * a fake fetch before importing anything, same pattern as a real deployment
 * picking its backend once at boot.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { createFakeUpstash } = await import('./lib/fakeUpstash.mjs');
const fake = createFakeUpstash();
globalThis.fetch = fake.fetchImpl;

const APP = '../../apps/party-tracker/';
const store = await import(`${APP}lib/serverStore.js`);
const traces = await import(`${APP}lib/guestTraces.js`);

assert.equal(store.usingRedis, true, 'this file needs the Redis path to test the RTT count');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

console.log('\n--- guest traces: Redis batching ---');

const trace = (venueId, i) => ({
  venueId,
  id: `s-${venueId}-${i}`,
  startedAt: i,
  endedAt: i + 1,
  metres: 10,
  pointCount: 3,
  points: [{ lat: 1, lng: 2 }],
});

await check('a venue batch of N traces issues one pipelined round trip', async () => {
  fake.calls.length = 0;
  const batch = Array.from({ length: 12 }, (_, i) => trace('big-kahunas', i));
  const { stored, venues } = await traces.appendGuestTraces(batch);
  assert.equal(stored, 12);
  assert.deepEqual(venues, ['big-kahunas']);
  const pipelineCalls = fake.calls.filter((c) => c.url.endsWith('/pipeline'));
  assert.equal(pipelineCalls.length, 1, 'exactly one /pipeline POST for the whole batch');
  assert.equal(fake.calls.length, 1, 'no other Upstash request was made');
  const [lpush, ltrim, expire] = pipelineCalls[0].body;
  assert.equal(lpush[0], 'LPUSH');
  assert.equal(lpush.length, 2 + 12, 'one LPUSH carrying all 12 values, not 12 LPUSH calls');
  assert.equal(ltrim[0], 'LTRIM');
  assert.equal(expire[0], 'EXPIRE');
});

await check('a mixed multi-venue batch pipelines once per venue', async () => {
  fake.calls.length = 0;
  const batch = [
    trace('big-kahunas', 100),
    trace('cedar-point', 200),
    trace('big-kahunas', 101),
  ];
  const { stored, venues } = await traces.appendGuestTraces(batch);
  assert.equal(stored, 3);
  assert.deepEqual([...venues].sort(), ['big-kahunas', 'cedar-point']);
  const pipelineCalls = fake.calls.filter((c) => c.url.endsWith('/pipeline'));
  assert.equal(pipelineCalls.length, 2, 'one pipeline per venue in the batch, not one per trace');
});

await check('newest-first ordering is unchanged by the switch to multi-value LPUSH', async () => {
  fake.calls.length = 0;
  await traces.appendGuestTraces([trace('order-check', 1), trace('order-check', 2), trace('order-check', 3)]);
  const listed = await traces.listGuestTraces('order-check', { limit: 10 });
  assert.deepEqual(
    listed.map((t) => t.startedAt),
    [3, 2, 1],
    'the most recently appended trace in the batch is listed first',
  );
});

await check('the 500-cap trim and TTL still apply through the pipeline', async () => {
  fake.calls.length = 0;
  const batch = Array.from({ length: 510 }, (_, i) => trace('cap-check', i));
  await traces.appendGuestTraces(batch);
  const stats = await traces.guestTraceStats('cap-check');
  assert.equal(stats.count, 500, 'LTRIM still caps the list at MAX_PER_VENUE');
  assert.ok(fake.store.ttl.has('ki:guest-traces:cap-check'), 'EXPIRE still landed');
});

if (FAIL.length) {
  console.error(`guest-traces tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`guest-traces tests: ${PASS.length} passed`);
}
