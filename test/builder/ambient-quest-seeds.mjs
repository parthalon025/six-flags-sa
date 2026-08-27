#!/usr/bin/env node
/**
 * Ambient quest seeds from stale adapter caches and evidence conflicts (#420).
 *
 *   node test/builder/ambient-quest-seeds.mjs
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

console.log('\nambient quest seeds (#420)\n');

const {
  questSeedsFromStaleAdapters,
  questSeedsFromEvidenceConflicts,
} = await import('../../packages/venue-builder/lib/quest-seeds.mjs');
const { adapterCacheIsStale, freshnessDaysForAdapter } = await import(
  '../../packages/venue-builder/lib/adapter-freshness.mjs'
);
const { shippedGapsForVenue, shippedTypeForSeed } = await import(
  '../../packages/venue-builder/lib/ship-gaps.mjs'
);

const AS_OF = '2026-08-27';

await check('adapter cache older than freshness window is stale', () => {
  const days = freshnessDaysForAdapter('queue-times', {});
  assert.equal(days, 7);
  const { stale } = adapterCacheIsStale(
    { fetched: '2026-08-01T12:00:00' },
    days,
    AS_OF,
  );
  assert.equal(stale, true);
  const fresh = adapterCacheIsStale({ fetched: '2026-08-26T12:00:00' }, days, AS_OF);
  assert.equal(fresh.stale, false);
  return true;
});

await check('stale adapter produces a verify seed naming the source', () => {
  const seeds = questSeedsFromStaleAdapters('kings-island', {
    adapters: ['queue-times'],
    caches: { 'queue-times': { fetched: '2026-01-01T00:00:00' } },
    asOf: AS_OF,
  });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'adapter_stale');
  assert.equal(seeds[0].target, 'queue-times');
  assert.equal(seeds[0].featureClass, 'queue');
  assert.match(seeds[0].need, /queue-times/i);
  return true;
});

await check('missing adapter cache is treated as stale', () => {
  const seeds = questSeedsFromStaleAdapters('kings-island', {
    adapters: ['queue-times'],
    caches: {},
    asOf: AS_OF,
  });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'adapter_stale');
  return true;
});

await check('fresh adapter cache emits no stale seeds', () => {
  const seeds = questSeedsFromStaleAdapters('kings-island', {
    adapters: ['queue-times'],
    caches: { 'queue-times': { fetched: '2026-08-26T12:00:00' } },
    asOf: AS_OF,
  });
  assert.equal(seeds.length, 0);
  return true;
});

await check('divergent evidence node produces a conflict seed for the ride', () => {
  const seeds = questSeedsFromEvidenceConflicts('park', {
    attractions: [
      {
        id: 'maverick',
        name: 'Maverick',
        features: {
          queue_entrance: {
            conflict: true,
            evidence: [
              { source: 'official_map', at: { lat: 41.48, lng: -82.68 }, date: '2026-01-01' },
              { source: 'osm_entrance', at: { lat: 41.481, lng: -82.681 }, date: '2026-01-01' },
            ],
          },
        },
      },
    ],
  });
  assert.equal(seeds.length, 1);
  assert.equal(seeds[0].sourceGap, 'evidence_conflict');
  assert.equal(seeds[0].target, 'maverick');
  assert.match(seeds[0].need, /Maverick/i);
  return true;
});

await check('converging evidence emits no conflict seeds', () => {
  const seeds = questSeedsFromEvidenceConflicts('park', {
    attractions: [
      {
        id: 'beast',
        name: 'The Beast',
        features: {
          queue_entrance: {
            confidence: 'high',
            evidence: [
              { source: 'official_map', at: { lat: 39.34, lng: -84.26 }, date: '2026-06-01' },
              { source: 'osm_entrance', at: { lat: 39.34, lng: -84.26 }, date: '2026-06-01' },
            ],
          },
        },
      },
    ],
  });
  assert.equal(seeds.length, 0);
  return true;
});

await check('shipped gaps include stale and conflict signal seeds', () => {
  const pois = [{ n: 'Maverick', i: 'maverick', c: 'coaster', h: { min: 52 } }];
  const doc = shippedGapsForVenue({
    venueId: 'park',
    pois,
    attractions: {
      attractions: [
        {
          id: 'maverick',
          name: 'Maverick',
          features: {
            queue_entrance: {
              conflict: true,
              evidence: [
                { source: 'official_map', at: { lat: 41.48, lng: -82.68 }, date: '2026-01-01' },
                { source: 'osm_entrance', at: { lat: 41.49, lng: -82.69 }, date: '2026-01-01' },
              ],
            },
          },
        },
      ],
    },
    adapterCaches: { 'queue-times': { fetched: '2026-01-01T00:00:00' } },
    declaredAdapters: ['queue-times'],
    asOf: AS_OF,
  });
  assert.ok(doc.gaps.some((g) => g.type === 'queue' && g.target === 'maverick'));
  assert.ok(doc.gaps.some((g) => g.type === 'path_disputed' && g.target === 'queue-times'));
  assert.equal(shippedTypeForSeed({ sourceGap: 'adapter_stale' }), 'path_disputed');
  assert.equal(shippedTypeForSeed({ sourceGap: 'evidence_conflict', featureKey: 'queue_entrance' }), 'queue');
  return true;
});

await check('clean venue ships no stale or conflict signal gaps', () => {
  const doc = shippedGapsForVenue({
    venueId: 'park',
    pois: [{ n: 'Beast', i: 'beast', c: 'coaster', h: { min: 48 } }],
    attractions: {
      attractions: [
        {
          id: 'beast',
          name: 'The Beast',
          features: {
            queue_entrance: {
              confidence: 'high',
              evidence: [
                { source: 'official_map', at: { lat: 39.34, lng: -84.26 }, date: '2026-06-01' },
              ],
            },
          },
        },
      ],
    },
    adapterCaches: { 'queue-times': { fetched: '2026-08-26T12:00:00' } },
    declaredAdapters: ['queue-times'],
    asOf: AS_OF,
  });
  assert.ok(!doc.gaps.some((g) => g.target === 'queue-times'));
  assert.ok(!doc.gaps.some((g) => g.type === 'queue' && g.target === 'beast'));
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
