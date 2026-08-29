#!/usr/bin/env node
/** google-places adapter — offline path vs live fetch must not dirty tracked venue caches. */
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { googlePlacesCacheFile, run } from '../../packages/venue-builder/lib/adapters/google-places.mjs';
import { readCache } from '../../packages/venue-builder/lib/adapters/_cache.mjs';

// Synthetic ids so run()'s writeCache side effect never touches a real shipped venue.
const TEST_VENUE = '__test-google-places__';
const TRACKED_FIXTURE = 'fixture-park';

const PASS = [];
const FAIL = [];
async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\ngoogle-places adapter suite\n');

process.env.GOOGLE_MAPS_API_KEY = 'test-key';

await check('offline run returns cached claims without writing', async () => {
  const cacheFile = googlePlacesCacheFile(TRACKED_FIXTURE);
  const before = readFileSync(cacheFile, 'utf8');
  const res = await run({ venueId: TRACKED_FIXTURE, offline: true });
  assert.equal(res.offline, true);
  assert.equal(readFileSync(cacheFile, 'utf8'), before, 'tracked fixture cache must stay byte-identical');
  return true;
});

await check('live fetch stamps fetched from the injected clock', async () => {
  const stamped = '2020-01-15T12:00:00.000Z';
  const res = await run(
    { venueId: TEST_VENUE, placeIds: ['ChIJlive'] },
    {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ id: 'ChIJlive', displayName: { text: 'Live Gate' } }),
      }),
      now: () => stamped,
    },
  );
  assert.equal(res.ok, true);
  assert.equal(res.claims[0].displayName, 'Live Gate');
  const cached = readCache(TEST_VENUE, 'google-places');
  assert.equal(cached.fetched, stamped);
  return true;
});

await check('live fetch without injected clock records a fresh ISO timestamp', async () => {
  const before = Date.now();
  await run(
    { venueId: TEST_VENUE, placeIds: ['ChIJwall'] },
    {
      fetchFn: async () => ({
        ok: true,
        json: async () => ({ id: 'ChIJwall', displayName: { text: 'Wall Clock' } }),
      }),
    },
  );
  const after = Date.now();
  const cached = readCache(TEST_VENUE, 'google-places');
  const ms = Date.parse(cached.fetched);
  assert.ok(ms >= before - 50 && ms <= after + 50, 'fetched must be a real wall-clock stamp on live runs');
  return true;
});

try {
  rmSync(new URL(`../../packages/venue-builder/data/venues/${TEST_VENUE}`, import.meta.url), {
    recursive: true,
    force: true,
  });
} catch {
  // best-effort cleanup of the synthetic venue sidecar
}

delete process.env.GOOGLE_MAPS_API_KEY;

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
