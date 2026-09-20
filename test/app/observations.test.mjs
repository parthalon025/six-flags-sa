#!/usr/bin/env node
/**
 * Party E7.1 — observation schema, store, and action-log bridge (#327).
 *
 * Seams:
 *   validateObservationAppend  — shared shape both client and server agree on
 *   observationFromActionLogEntry — maps local action-log rows to wire rows
 *   insertObservation / flushActionLog — append-only persistence + flush
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { validateObservationAppend } = await import('@party-tracker/shared/observations.js');
const { observationFromActionLogEntry, flushActionLog } = await import(
  '../../apps/party-tracker/lib/observations/bridge.js'
);
const { insertObservation } = await import('../../apps/party-tracker/lib/observations/store.js');

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

console.log('\n--- observations ---');

await check('validateObservationAppend accepts a ride report row', () => {
  const parsed = validateObservationAppend({
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-09-20T12:00:00.000Z',
    status: 'down',
    source: 'party-report',
    confidence: 'low',
    authorId: 'usr_demo',
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.observation.placeId, 'orion');
  assert.equal(parsed.observation.status, 'down');
});

await check('validateObservationAppend rejects missing placeId', () => {
  const parsed = validateObservationAppend({
    venueId: 'kings-island',
    ts: '2026-09-20T12:00:00.000Z',
    source: 'party-report',
    confidence: 'low',
  });
  assert.equal(parsed.ok, false);
});

await check('validateObservationAppend rejects invalid status', () => {
  const parsed = validateObservationAppend({
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-09-20T12:00:00.000Z',
    status: 'maybe',
    source: 'party-report',
    confidence: 'low',
  });
  assert.equal(parsed.ok, false);
});

await check('observationFromActionLogEntry maps a ride report entry', () => {
  const row = observationFromActionLogEntry({
    id: 'local-1',
    ts: 1_700_000_000_000,
    kind: 'ride',
    detail: {
      venueId: 'kings-island',
      rideId: 'orion',
      status: 'down',
      waitMin: 45,
      authorId: 'usr_demo',
    },
  });
  assert.ok(row);
  assert.equal(row.placeId, 'orion');
  assert.equal(row.waitMin, 45);
  assert.equal(row.status, 'down');
  assert.equal(row.source, 'party-report');
});

await check('observationFromActionLogEntry ignores non-ride kinds', () => {
  assert.equal(
    observationFromActionLogEntry({ id: 'x', ts: 1, kind: 'meet', detail: {} }),
    null,
  );
});

await check('insertObservation appends in memory and is idempotent on client id', async () => {
  const first = await insertObservation({
    id: 'obs_demo',
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-09-20T12:00:00.000Z',
    status: 'down',
    source: 'party-report',
    confidence: 'low',
  });
  const replay = await insertObservation({
    id: 'obs_demo',
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-09-20T12:00:00.000Z',
    status: 'down',
    source: 'party-report',
    confidence: 'low',
  });
  assert.equal(first.id, 'obs_demo');
  assert.equal(replay.id, 'obs_demo');
});

await check('flushActionLog posts qualifying entries and removes them', async () => {
  const pending = [
    {
      id: 'local-1',
      ts: 1_700_000_000_000,
      kind: 'report',
      detail: {
        venueId: 'kings-island',
        placeId: 'orion',
        status: 'open',
        source: 'party-report',
        confidence: 'medium',
      },
    },
    { id: 'local-2', ts: 1, kind: 'meet', detail: {} },
  ];
  const removed = [];
  const posted = [];
  const result = await flushActionLog(
    {
      load: async () => pending,
      remove: async (id) => {
        removed.push(id);
      },
    },
    {
      append: async (row) => {
        posted.push(row);
      },
    },
  );
  assert.equal(result.flushed, 1);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].placeId, 'orion');
  assert.deepEqual(removed, ['local-1']);
});

if (FAIL.length) {
  console.error(`\nobservations tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' ', f);
  process.exit(1);
}
console.log(`\nobservations tests: ${PASS.length} passed`);
