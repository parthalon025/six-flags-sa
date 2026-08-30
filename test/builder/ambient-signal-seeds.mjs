#!/usr/bin/env node
/**
 * Ambient quest seeds from stale adapter caches and evidence conflicts (#420).
 *
 *   node test/builder/ambient-signal-seeds.mjs
 */
import assert from 'node:assert/strict';

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

console.log('\nambient signal quest seeds\n');

const {
  ADAPTER_CACHE_FRESHNESS_DAYS,
  adapterCacheIsStale,
  questSeedsFromStaleAdapters,
  questSeedsFromConflicts,
  ambientSignalShipArtifacts,
} = await import('../../packages/venue-builder/lib/ambient-signal-seeds.mjs');
const { shippedGapsForVenue, shippedTypeForSeed, SHIPPED_GAP_TYPES } = await import(
  '../../packages/venue-builder/lib/ship-gaps.mjs'
);
const { questSeedsForVenue } = await import('../../packages/venue-builder/lib/quest-seeds.mjs');
const { SHIPPED_GAP_TYPES: PHONE_GAP_TYPES } = await import('../../apps/party-tracker/lib/venue/store.js');

await check('stale adapter cache produces a verify seed naming the source', () => {
  const seeds = questSeedsFromStaleAdapters('demo-park', {
    'parks-api': { fetched: '2020-01-01', attractions: [] },
  }, {}, '2026-08-27');
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'adapter_stale');
  assert.equal(seeds[0].adapterId, 'parks-api');
  assert.match(seeds[0].need, /parks-api/i);
  assert.equal(seeds[0].tier, 1);
  return true;
});

await check('fresh adapter cache and declared gap notes emit no stale seeds', () => {
  const fresh = questSeedsFromStaleAdapters('demo-park', {
    'parks-api': { fetched: '2026-08-20', attractions: [] },
  }, {}, '2026-08-27');
  assert.equal(fresh.length, 0);
  const gapped = questSeedsFromStaleAdapters('demo-park', {
    'parks-api': { fetched: '2020-01-01', attractions: [] },
  }, { 'parks-api': 'no API key in CI' }, '2026-08-27');
  assert.equal(gapped.length, 0);
  return true;
});

await check('divergent evidence node produces a conflict seed for the attraction', () => {
  const attractions = {
    attractions: [{
      id: 'maverick',
      name: 'Maverick',
      place: 'maverick',
      features: {
        queue_entrance: {
          confidence: 'low',
          conflict: true,
          evidence: [
            { source: 'osm_named_queue', at: { lat: 41.0, lng: -82.0 }, date: '2026-01-01' },
            { source: 'osm_entrance', at: { lat: 41.001, lng: -82.05 }, date: '2026-01-01' },
          ],
        },
      },
    }],
  };
  const seeds = questSeedsFromConflicts('cedar-point', attractions);
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'evidence_conflict');
  assert.equal(seeds[0].target, 'maverick');
  assert.match(seeds[0].need, /conflict/i);
  assert.equal(seeds[0].tier, 2);
  return true;
});

await check('converging attractions emit no conflict seeds', () => {
  const attractions = {
    attractions: [{
      id: 'gemini',
      name: 'Gemini',
      place: 'gemini',
      features: {
        queue_entrance: {
          confidence: 'moderate',
          conflict: false,
          evidence: [{ source: 'osm_named_queue', at: { lat: 41.0, lng: -82.0 }, date: '2026-01-01' }],
        },
      },
    }],
  };
  assert.equal(questSeedsFromConflicts('cedar-point', attractions).length, 0);
  return true;
});

await check('a stale adapter and a ride evidence conflict both ship verify Gaps, targeted differently', () => {
  const pois = [{ n: 'Maverick', i: 'maverick', c: 'coaster', h: { min: 52 } }];
  const attractions = {
    attractions: [{
      id: 'maverick',
      name: 'Maverick',
      place: 'maverick',
      features: {
        queue_entrance: {
          confidence: 'low',
          conflict: true,
          evidence: [
            { source: 'osm_named_queue', at: { lat: 41.0, lng: -82.0 }, date: '2026-01-01' },
            { source: 'osm_entrance', at: { lat: 41.001, lng: -82.05 }, date: '2026-01-01' },
          ],
        },
      },
    }],
  };
  const adapterCaches = { 'parks-api': { fetched: '2020-01-01', attractions: [] } };
  const doc = shippedGapsForVenue({
    venueId: 'cedar-point',
    pois,
    map: {},
    attractions,
    adapterCaches,
    gapNotes: {},
    asOf: '2026-08-27',
  });
  assert.ok(doc.gaps.some((g) => g.type === 'verify' && g.target === 'parks-api'));
  // The owner ruled on 2026-08-23 that a ride whose sources disagree stays
  // visible to guests. It reaches the phone on `verify` — targeted at the ride
  // it is about, not at an adapter id, because that is where the guest stands.
  assert.ok(
    doc.gaps.some((g) => g.type === 'verify' && g.target === 'maverick'),
    'a ride evidence conflict must reach the phone as a verify Gap on the ride (owner ruling, 2026-08-23)',
  );
  // On `verify`, though — not on a dispute spelling. `path_disputed` is gone
  // and no new type joined the frozen seven to carry this.
  assert.ok(
    !doc.gaps.some((g) => g.type === 'path_disputed'),
    'the retired dispute type must not come back to carry the conflict',
  );
  const brief = questSeedsForVenue({
    venueId: 'cedar-point',
    attractions,
    adapterCaches,
    gapNotes: {},
    asOf: '2026-08-27',
    includeAmbient: false,
  });
  assert.ok(
    brief.durable.some((seed) => seed.sourceGap === 'evidence_conflict' && seed.target === 'maverick'),
    'the conflict is still on the builder-side seed list too, not lost',
  );
  return true;
});

await check('clean venue ship artifacts match baseline without signal seeds', () => {
  const pois = [{ n: 'Gemini', i: 'gemini', c: 'coaster', lat: 41.0, lng: -82.0, h: { min: 48 } }];
  const map = { path: [{ r: [[-82.0, 41.0], [-82.001, 41.0]] }] };
  const baseline = shippedGapsForVenue({ venueId: 'cedar-point', pois, map });
  const withSignals = shippedGapsForVenue({
    venueId: 'cedar-point',
    pois,
    map,
    adapterCaches: { 'parks-api': { fetched: '2026-08-20', attractions: [] } },
    gapNotes: {},
    asOf: '2026-08-27',
  });
  assert.deepEqual(withSignals, baseline);
  return true;
});

await check('questSeedsForVenue includes signal-derived durable seeds', () => {
  const out = questSeedsForVenue({
    venueId: 'demo-park',
    includeAmbient: false,
    signalSeeds: [{
      venueId: 'demo-park',
      type: 'verify_source',
      tier: 1,
      sourceGap: 'adapter_stale',
      target: null,
      adapterId: 'queue-times',
    }],
  });
  assert.ok(out.durable.some((s) => s.sourceGap === 'adapter_stale'));
  return true;
});

await check('shipped type mapping and allowlists include verify', () => {
  assert.equal(shippedTypeForSeed({ sourceGap: 'adapter_stale' }), 'verify');
  assert.equal(
    shippedTypeForSeed({ sourceGap: 'evidence_conflict', target: 'x' }),
    'verify',
    'a ride evidence conflict ships on verify — an existing type, not an eighth one',
  );
  assert.ok(SHIPPED_GAP_TYPES.includes('verify'));
  assert.ok(PHONE_GAP_TYPES.has('verify'));
  assert.ok(ADAPTER_CACHE_FRESHNESS_DAYS['parks-api'] > 0);
  assert.equal(adapterCacheIsStale({ fetched: '2020-01-01' }, 30, '2026-08-27'), true);
  assert.equal(adapterCacheIsStale({ fetched: '2026-08-20' }, 30, '2026-08-27'), false);
  return true;
});

await check('ambientSignalShipArtifacts bundles seeds for ship-gaps', () => {
  const { seeds } = ambientSignalShipArtifacts({
    venueId: 'park',
    adapterCaches: { 'queue-times': { fetched: '2019-06-01', rides: [] } },
    attractions: null,
    gapNotes: {},
    asOf: '2026-08-27',
  });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'adapter_stale');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
