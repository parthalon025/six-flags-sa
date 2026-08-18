#!/usr/bin/env node
/**
 * Quest sync: the seam that retries Side Quests' local outbox against the
 * durable contributions API. Fake queue + fake upload adapter — no storage,
 * no network.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { flushQuestQueue } = await import('../../apps/party-tracker/lib/adventure/questSync.js');
const { STATUS_PENDING } = await import('../../apps/party-tracker/lib/adventure/questQueue.js');

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

/** Minimal in-memory stand-in for createQuestQueue()'s async interface. */
function fakeQueue(reports) {
  let rows = [...reports];
  return {
    async load() {
      return [...rows];
    },
    async remove(id) {
      rows = rows.filter((r) => r.id !== id);
    },
    removedIds: () => reports.filter((r) => !rows.some((row) => row.id === r.id)).map((r) => r.id),
  };
}

const gapReport = (overrides = {}) => ({
  id: 'r1',
  questId: 'height-orion',
  venueId: 'kings-island',
  placeId: 'orion',
  kind: 'height',
  payload: { heightIn: 48 },
  lat: 1,
  lng: 2,
  userId: 'usr_dad',
  createdAt: 1000,
  status: STATUS_PENDING,
  ...overrides,
});

console.log('\n--- quest sync ---');

await check('flushes pending reports on success, keyed by the report id', async () => {
  const queue = fakeQueue([gapReport({ id: 'r1' }), gapReport({ id: 'r2', placeId: 'beast' })]);
  const seen = [];
  const upload = { enqueue: async (contribution) => { seen.push(contribution); } };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 2, failed: 0 });
  assert.deepEqual(seen.map((c) => c.id).sort(), ['r1', 'r2']);
  assert.deepEqual(await queue.load(), []);
});

await check('leaves a report pending when upload fails', async () => {
  const queue = fakeQueue([gapReport({ id: 'r1' })]);
  const upload = { enqueue: async () => { throw new Error('offline'); } };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 0, failed: 1 });
  const remaining = await queue.load();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, 'r1');
});

await check('no-ops when nothing is pending', async () => {
  const queue = fakeQueue([]);
  let called = false;
  const upload = { enqueue: async () => { called = true; } };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 0, failed: 0 });
  assert.equal(called, false);
});

await check('skips already-synced reports', async () => {
  const queue = fakeQueue([gapReport({ id: 'r1', status: 'synced' })]);
  let called = false;
  const upload = { enqueue: async () => { called = true; } };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 0, failed: 0 });
  assert.equal(called, false);
  assert.equal((await queue.load()).length, 1);
});

await check('skips ephemeral live-quest reports — nothing to sync to the durable API', async () => {
  const queue = fakeQueue([gapReport({ id: 'r1', kind: 'ride_status' })]);
  let called = false;
  const upload = { enqueue: async () => { called = true; } };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 0, failed: 0 });
  assert.equal(called, false);
  // Left alone, not removed — it was never a sync candidate.
  assert.equal((await queue.load()).length, 1);
});

await check('never throws when the queue itself fails to load', async () => {
  const queue = { load: async () => { throw new Error('IndexedDB unavailable'); }, remove: async () => {} };
  const upload = { enqueue: async () => {} };
  const result = await flushQuestQueue(queue, upload);
  assert.deepEqual(result, { flushed: 0, failed: 0 });
});

await check('no-ops without throwing when queue or upload is missing', async () => {
  assert.deepEqual(await flushQuestQueue(null, { enqueue: async () => {} }), { flushed: 0, failed: 0 });
  assert.deepEqual(await flushQuestQueue(fakeQueue([]), null), { flushed: 0, failed: 0 });
});

if (FAIL.length) {
  console.error(`quest sync tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`quest sync tests: ${PASS.length} passed`);
}
