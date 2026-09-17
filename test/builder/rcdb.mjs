#!/usr/bin/env node
/** RCDB adapter — retry, error-stub cache semantics, compare-only contract. */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { readCache } from '../../packages/venue-builder/lib/adapters/_cache.mjs';
import {
  compareRcdbToBundle,
  isRcdbErrorStub,
  loadRcdbData,
  run,
} from '../../packages/venue-builder/lib/adapters/rcdb.mjs';
import { getAdapter } from '../../packages/venue-builder/lib/adapters/registry.mjs';

const TEST_VENUE = '__test-rcdb-retry__';
const TEST_VENUE_2 = '__test-rcdb-stub-refetch__';

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

function scrub(id) {
  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${id}`, import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup of synthetic venue sidecars
  }
}

console.log('\nrcdb adapter suite\n');

await check('isRcdbErrorStub recognises cached fetch failures', () => {
  assert.equal(isRcdbErrorStub({ error: 'timeout', coasters: [] }), true);
  assert.equal(isRcdbErrorStub({ fetched: '2026-01-01', coasters: [] }), false);
  assert.equal(isRcdbErrorStub(null), false);
});

await check('loadRcdbData retries a transient fetch failure then caches real data', async () => {
  scrub(TEST_VENUE);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('503 upstream');
    return [{ id: 1, name: 'Beast', park: 'Kings Island', height: 65 }];
  };

  const data = await loadRcdbData(TEST_VENUE, {
    venueName: 'Kings Island',
    fetch: true,
    fetchImpl,
    retry: { attempts: 3, backoffMs: 1 },
  });

  assert.equal(calls, 2, 'one retry before success');
  assert.equal(data.coasters.length, 1);
  assert.equal(data.coasters[0].name, 'Beast');
  assert.equal(data.error, undefined);
  assert.equal(readCache(TEST_VENUE, 'rcdb').coasters[0].name, 'Beast');
  scrub(TEST_VENUE);
});

await check('a cached error stub does not satisfy a later read — re-fetch succeeds', async () => {
  scrub(TEST_VENUE_2);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return [{ id: 2, name: 'Mystic Timbers', park: 'Kings Island', height: 109 }];
  };

  // Seed an error stub the way run() writes after exhausting retries.
  const { writeCache } = await import('../../packages/venue-builder/lib/adapters/_cache.mjs');
  writeCache(TEST_VENUE_2, 'rcdb', {
    fetched: null,
    coasters: [],
    park: 'Kings Island',
    error: '503 upstream',
    license: 'unofficial scrape — compare only',
  });
  assert.equal(isRcdbErrorStub(readCache(TEST_VENUE_2, 'rcdb')), true);

  const data = await loadRcdbData(TEST_VENUE_2, {
    venueName: 'Kings Island',
    fetch: false,
    fetchImpl,
    retry: { attempts: 1, backoffMs: 1 },
  });

  assert.equal(calls, 1, 'stub on disk forced a fresh fetch');
  assert.equal(data.coasters[0].name, 'Mystic Timbers');
  assert.equal(data.error, undefined);
  scrub(TEST_VENUE_2);
});

await check('compareRcdbToBundle pairs bundle coasters with RCDB names', () => {
  const compare = compareRcdbToBundle({
    rcdb: { coasters: [{ name: 'The Beast', height: 65 }] },
    pois: [{ n: 'Beast', c: 'coaster' }],
  });
  assert.equal(compare.matched, 1);
  assert.equal(compare.pairs[0].bundle, 'Beast');
});

await check('registry row documents the compare-only operator contract', () => {
  const row = getAdapter('rcdb');
  assert.ok(row, 'rcdb is registered');
  const notes = row.notes.toLowerCase();
  assert.match(notes, /compare-only|compare only/);
  assert.match(notes, /never/);
  assert.match(notes, /official|osm/);
  assert.match(notes, /unofficial|scrape|licen/);
});

await check('run() writes an error stub only after retries are exhausted', async () => {
  const id = '__test-rcdb-run-stub__';
  scrub(id);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('503 upstream');
  };

  const res = await run(
    { venueId: id, venueName: 'Kings Island', fetch: true },
    { fetchImpl, retry: { attempts: 3, backoffMs: 1 } },
  );

  assert.equal(res.ok, false);
  assert.equal(calls, 3, 'all retry attempts before stub');
  assert.equal(isRcdbErrorStub(readCache(id, 'rcdb')), true);
  scrub(id);
});

await check('run() requires a venueId', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
