#!/usr/bin/env node
/**
 * Party E7.3 — observation freshness by volatility class (#329).
 *
 * Seams:
 *   volatilityForObservation — maps source/shape → volatility class
 *   freshnessFor             — age → fresh / aging / stale tier + live gate
 *   liveKindFor              — stale observations never read as LIVE
 */

import assert from 'node:assert/strict';

const {
  freshnessFor,
  volatilityForObservation,
  liveKindFor,
  observationShapeFromReport,
  STATUS_WINDOWS_MS,
} = await import('../../apps/party-tracker/lib/observations/freshness.js');

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

const NOW = Date.parse('2026-09-21T12:00:00.000Z');

console.log('\n--- observation-freshness ---');

await check('volatilityForObservation maps party-report to status', () => {
  assert.equal(volatilityForObservation({ source: 'party-report' }), 'status');
});

await check('volatilityForObservation maps party-queue to wait', () => {
  assert.equal(volatilityForObservation({ source: 'party-queue', waitMin: 25 }), 'wait');
});

await check('freshnessFor labels a 10-minute status report fresh (green)', () => {
  const row = freshnessFor(
    { source: 'party-report', ts: NOW - 10 * 60 * 1000 },
    NOW,
  );
  assert.equal(row.tier, 'fresh');
  assert.equal(row.tone, 'ok');
  assert.equal(row.live, true);
});

await check('freshnessFor labels a 20-minute status report aging (yellow)', () => {
  const row = freshnessFor(
    { source: 'party-report', ts: NOW - 20 * 60 * 1000 },
    NOW,
  );
  assert.equal(row.tier, 'aging');
  assert.equal(row.tone, 'warn');
  assert.equal(row.live, true);
});

await check('freshnessFor labels a 35-minute status report stale (red)', () => {
  const row = freshnessFor(
    { source: 'party-report', ts: NOW - 35 * 60 * 1000 },
    NOW,
  );
  assert.equal(row.tier, 'stale');
  assert.equal(row.live, false);
});

await check('wait volatility stays fresh longer than status at the same age', () => {
  const age = 18 * 60 * 1000;
  const status = freshnessFor({ source: 'party-report', ts: NOW - age }, NOW);
  const wait = freshnessFor({ source: 'party-queue', waitMin: 30, ts: NOW - age }, NOW);
  assert.equal(status.tier, 'aging');
  assert.equal(wait.tier, 'fresh');
});

await check('liveKindFor returns LIVE only when freshness.live', () => {
  const fresh = freshnessFor({ source: 'party-report', ts: NOW - 5 * 60 * 1000 }, NOW);
  const stale = freshnessFor({ source: 'party-report', ts: NOW - 40 * 60 * 1000 }, NOW);
  assert.equal(liveKindFor('ride_status', fresh), 'LIVE · RIDE REPORT');
  assert.equal(liveKindFor('ride_status', stale), 'RIDE REPORT');
  assert.equal(liveKindFor('ride_status', null), 'LIVE · RIDE REPORT');
});

await check('observationShapeFromReport maps party ride reports', () => {
  const row = observationShapeFromReport({ status: 'down', ts: NOW });
  assert.deepEqual(row, { source: 'party-report', status: 'down', ts: NOW });
});

await check('STATUS_WINDOWS_MS aligns status aging with ride stale threshold', async () => {
  const { RIDE_STALE_AFTER_MS } = await import('../../apps/party-tracker/lib/core/state.js');
  assert.equal(STATUS_WINDOWS_MS.status.aging, RIDE_STALE_AFTER_MS);
});

await check('statusPillClasses carries fresh and aging tiers from ride status', async () => {
  const { statusFor } = await import('../../apps/party-tracker/lib/rideStatus.js');
  const { statusPillClasses } = await import('../../apps/party-tracker/lib/live.js');
  const fresh = statusFor({ c: 'coaster', id: 'orion' }, { status: 'open', ts: NOW - 5 * 60 * 1000 }, null, NOW);
  const aging = statusFor({ c: 'coaster', id: 'orion' }, { status: 'open', ts: NOW - 20 * 60 * 1000 }, null, NOW);
  assert.match(statusPillClasses(fresh), /\bfresh\b/);
  assert.match(statusPillClasses(aging), /\baging\b/);
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
