#!/usr/bin/env node
/**
 * venues:report gate — every shipped venue passes checklist + expect locks.
 *
 *   node test/scripts/venue-report-gate.test.mjs
 */
import assert from 'node:assert/strict';
import {
  checkAllVenueReports,
  checkExpectLock,
  checkShippedVenueReports,
  checkVenueReport,
  readExpectLock,
} from '../../scripts/lib/venue-report-gate.mjs';

/* -------------------------------------------------------- checkExpectLock */

{
  const map = { meta: { coverage: { walkable_km: 100 } } };
  assert.deepEqual(checkExpectLock('x', map, null), []);
  assert.deepEqual(checkExpectLock('x', map, { walkable_km_min: 95 }), []);
  const below = checkExpectLock('x', map, { walkable_km_min: 101 });
  assert.equal(below.length, 1);
  assert.equal(below[0].key, 'walkable_km_min');
  assert.match(below[0].message, /below locked floor/);

  const missing = checkExpectLock('x', { meta: {} }, { walkable_km_min: 10 });
  assert.equal(missing.length, 1);
  assert.match(missing[0].message, /missing km/);

  const unknown = checkExpectLock('x', map, { mystery_floor: 1 });
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /unknown expect key/);
}

/* ------------------------------------------------------- readExpectLock */

{
  assert.deepEqual(
    readExpectLock('park', { expect: { walkable_km_min: 42 } }),
    { walkable_km_min: 42 },
    'shipped map meta.expect is the last fallback, matching build-venue',
  );
}

/* ------------------------------------------------------ checkVenueReport */

{
  const venue = { id: 'park', locality: 'Town' };
  const map = { lands: [{ n: 'Main' }], boundary: [[0, 0]], path: [[0, 0]] };
  const pois = [{ n: 'Gate', c: 'gate', lat: 0, lng: 0 }];
  assert.deepEqual(
    checkVenueReport({ venue, map, pois, mapKb: 10, poisKb: 5 }),
    [],
    'a minimal complete venue passes',
  );

  const noGeometry = checkVenueReport({
    venue,
    map: {},
    pois: [],
    mapKb: 1,
    poisKb: 1,
  });
  assert.ok(noGeometry.some((f) => f.kind === 'checklist' && f.key === 'geometry'));
}

/* --------------------------------------------------- checkAllVenueReports */

{
  const venues = [
    { id: 'a', locality: 'One' },
    { id: 'b', locality: 'Two' },
  ];
  const goodMap = {
    lands: [{ n: 'Main' }],
    boundary: [[0, 0]],
    path: [[0, 0]],
    meta: { coverage: { walkable_km: 50 } },
  };
  const goodPois = [{ n: 'Gate', c: 'gate', lat: 0, lng: 0 }];
  const load = (v) => ({
    map: goodMap,
    pois: goodPois,
    mapKb: 10,
    poisKb: 5,
  });
  const clean = checkAllVenueReports({
    venues,
    load,
    readExpect: (id, { map }) => (id === 'b' ? { walkable_km_min: 60 } : map?.meta?.expect ?? null),
  });
  assert.equal(clean.ok, false);
  assert.equal(clean.failures.length, 1);
  assert.equal(clean.failures[0].venueId, 'b');
  assert.equal(clean.failures[0].kind, 'expect');
}

/* --------------------------------------------------------- the repo gate */

{
  const gate = checkShippedVenueReports();
  const explain = gate.failures
    .map((f) => `  ${f.venueId}: [${f.kind}/${f.key}] ${f.message}`)
    .join('\n');
  assert.ok(
    gate.ok,
    `a shipped venue fails venues:report — fix upstream or re-lock expect:\n${explain}\n  Run: npm run venues:report`,
  );
}

console.log('venue-report-gate: ok (every shipped venue passes checklist + expect locks)');
