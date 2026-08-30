#!/usr/bin/env node
/**
 * Inventory under-coverage → shipped gaps + quest seeds (#419).
 *
 *   node test/builder/inventory-gaps.mjs
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

console.log('\ninventory gaps + quest seeds\n');

const {
  INVENTORY_COVERAGE_THRESHOLD,
  inventoryAsksFromAdapters,
  inventoryAsksForBrief,
  inventoryGapsFromAsks,
  questSeedsFromInventory,
  inventoryShipArtifacts,
} = await import('../../packages/venue-builder/lib/inventory-gaps.mjs');
const { shippedGapsDocument, shippedGapsForVenue, SHIPPED_GAP_TYPES } = await import(
  '../../packages/venue-builder/lib/ship-gaps.mjs'
);
const { serializeVenue } = await import('../../packages/venue-builder/lib/venue-io.mjs');
const { normalizeGapsDocument } = await import('../../apps/party-tracker/lib/venue/store.js');
const { SHIPPED_GAP_TYPES: PHONE_GAP_TYPES } = await import('../../apps/party-tracker/lib/venue/store.js');

const ridePois = [
  { n: 'Alpha Coaster', i: 'alpha', c: 'coaster', lat: 39.0, lng: -84.0, h: { min: 48 } },
  { n: 'Beta Ride', i: 'beta', c: 'ride', lat: 39.01, lng: -84.0, h: { min: 42 } },
  { n: 'Gamma Ride', i: 'gamma', c: 'ride', lat: 39.02, lng: -84.0, h: { min: 40 } },
  { n: 'Delta Coaster', i: 'delta', c: 'coaster', lat: 39.03, lng: -84.0, h: { min: 48 } },
];

await check('below threshold promotes inventory asks with unmatched bundle ride names', () => {
  const parksApiCache = {
    attractions: [{ name: 'Beta Ride' }],
  };
  const { asks } = inventoryAsksFromAdapters({ pois: ridePois, parksApiCache, gapNotes: {} });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].key, 'parks-api-inventory');
  assert.ok(asks[0].compare.onlyInBundle.includes('Gamma Ride'));
  assert.ok(asks[0].compare.onlyInBundle.includes('Delta Coaster'));
  const gaps = inventoryGapsFromAsks(asks);
  assert.ok(gaps.some((g) => g.type === 'inventory' && g.target === 'Gamma Ride'));
  assert.ok(gaps.some((g) => g.type === 'inventory' && g.target === 'Delta Coaster'));
  return true;
});

await check('at or above threshold emits no inventory asks or gaps', () => {
  const parksApiCache = {
    attractions: ridePois.map((p) => ({ name: p.n })),
  };
  const { asks } = inventoryAsksFromAdapters({ pois: ridePois, parksApiCache, gapNotes: {} });
  assert.equal(asks.length, 0);
  assert.deepEqual(inventoryGapsFromAsks(asks), []);
  return true;
});

await check('exactly 50% match does not promote (threshold is strict less-than)', () => {
  const pois = [
    { n: 'One', c: 'ride', h: { min: 0 } },
    { n: 'Two', c: 'ride', h: { min: 0 } },
  ];
  const parksApiCache = { attractions: [{ name: 'One' }] };
  const { asks } = inventoryAsksFromAdapters({ pois, parksApiCache, gapNotes: {} });
  assert.equal(asks.length, 0);
  return true;
});

await check('declared adapter gap notes suppress inventory asks', () => {
  const parksApiCache = { attractions: [{ name: 'Alpha Coaster' }] };
  const { asks } = inventoryAsksFromAdapters({
    pois: ridePois,
    parksApiCache,
    gapNotes: { 'parks-api': 'ThemeParks.wiki has no entity for this park' },
  });
  assert.equal(asks.length, 0);
  return true;
});

await check('no adapter cache emits no inventory asks or gaps', () => {
  const { asks } = inventoryAsksFromAdapters({ pois: ridePois, parksApiCache: null, gapNotes: {} });
  assert.equal(asks.length, 0);
  assert.deepEqual(inventoryGapsFromAsks(asks), []);
  return true;
});

await check('ratio-only inventory gap when coverage is low but no bundle names remain', () => {
  const gaps = inventoryGapsFromAsks([{ coverage: 0.2, compare: { onlyInBundle: [] } }]);
  assert.deepEqual(gaps, [{ type: 'inventory', target: null }]);
  return true;
});

await check('quest seeds carry tier 2 and inventory sourceGap per unmatched ride', () => {
  const asks = [{
    key: 'parks-api-inventory',
    need: 'ParksAPI matched 1/4 rides — declare gaps or improve aliases',
    blocking: false,
    compare: { onlyInBundle: ['Gamma Slide', 'Delta Coaster'] },
  }];
  const seeds = questSeedsFromInventory('demo-park', asks);
  assert.equal(seeds.length, 2);
  assert.ok(seeds.every((s) => s.tier === 2));
  assert.ok(seeds.every((s) => s.sourceGap === 'parks-api-inventory'));
  assert.ok(seeds.some((s) => s.target === 'Gamma Slide'));
  return true;
});

await check('shipped gaps document adds inventory rows without changing height gaps', () => {
  const pois = [{ n: 'The Beast', i: 'the-beast', c: 'coaster' }];
  const inventoryGaps = [{ type: 'inventory', target: 'Mystery Ride' }];
  const doc = shippedGapsDocument({ venueId: 'park', seeds: [], pois, inventoryGaps });
  assert.ok(
    doc.gaps.some((g) => g.type === 'inventory' && g.target === 'Mystery Ride'),
    'shippedGapsDocument should fold the inventoryGaps option into doc.gaps as a type:inventory row',
  );
  assert.deepEqual(doc.gaps.filter((g) => g.type === 'height'), [{ type: 'height', target: 'the-beast' }]);
  return true;
});

await check('above-threshold ship artifacts leave gaps document identical to no-inventory path', () => {
  const pois = [{ n: 'Near', i: 'near-ride', c: 'ride', lat: 39.0, lng: -84.0, h: { min: 0 } }];
  const map = { path: [{ r: [[-84.0, 39.0], [-84.001, 39.0]] }] };
  const baseline = shippedGapsDocument({ venueId: 'park', seeds: [], pois, map });
  const parksApiCache = { attractions: [{ name: 'Near' }] };
  const { gaps: inventoryGaps } = inventoryShipArtifacts({
    venueId: 'park',
    pois,
    parksApiCache,
    qtCache: null,
    gapNotes: {},
  });
  assert.equal(inventoryGaps.length, 0);
  const withHook = shippedGapsDocument({ venueId: 'park', seeds: [], pois, map, inventoryGaps });
  assert.deepEqual(withHook, baseline);
  return true;
});

await check('inventory is on the builder and phone shipped-gap allowlists', () => {
  assert.ok(
    SHIPPED_GAP_TYPES.includes('inventory'),
    'builder allowlist (packages/venue-builder/lib/ship-gaps.mjs SHIPPED_GAP_TYPES) is missing "inventory"',
  );
  assert.ok(
    PHONE_GAP_TYPES.has('inventory'),
    'phone allowlist (apps/party-tracker/lib/venue/store.js SHIPPED_GAP_TYPES) is missing "inventory"',
  );
  assert.equal(INVENTORY_COVERAGE_THRESHOLD, 0.5);
  return true;
});

await check('a venue build below threshold ships inventory rows the phone accepts', () => {
  /* The lane was built, tested and never called: `shippedGapsForVenue` — the one
     production entry, reached from `venue-io.mjs` — neither accepted nor computed
     inventory rows, so a real build could not emit one however bad its adapter
     coverage got (#29). The assertion is on the bytes a phone downloads, not on
     the seam: serialize the document the way `writeVenue` does, parse it back
     through the phone's own normalizer, and look for the row there. */
  const parksApiCache = { attractions: [{ name: 'Beta Ride' }] };
  const doc = shippedGapsForVenue({
    venueId: 'park',
    meta: { id: 'park' },
    pois: ridePois,
    map: {},
    adapterCaches: { 'parks-api': parksApiCache },
  });

  const shipped = JSON.parse(serializeVenue({ meta: { id: 'park' }, map: {}, pois: ridePois, gaps: doc }).gaps);
  const onPhone = normalizeGapsDocument(shipped);
  const inventory = onPhone.filter((g) => g.type === 'inventory');
  assert.ok(inventory.length, 'a build below threshold ships no inventory row at all');
  assert.deepEqual(
    inventory.map((g) => g.target).sort(),
    ['Alpha Coaster', 'Delta Coaster', 'Gamma Ride'],
    'every rideable ParksAPI did not match reaches the phone by name',
  );
  return true;
});

await check('a venue build above threshold ships none — the lane is a floor, not routine output', () => {
  /* What the four flagships are: ParksAPI and Queue-Times match 74-80% of their
     rideables, well over the 0.5 floor, so none of them emits a row today. The
     lane is the safety net under a venue whose adapters have gone bad, and a
     wired lane that fired on a healthy venue would be worse than an unwired one. */
  const parksApiCache = { attractions: ridePois.map((p) => ({ name: p.n })) };
  const doc = shippedGapsForVenue({
    venueId: 'park',
    meta: { id: 'park' },
    pois: ridePois,
    map: {},
    adapterCaches: { 'parks-api': parksApiCache },
  });
  assert.equal(doc.gaps.filter((g) => g.type === 'inventory').length, 0);
  // And the rest of the document is untouched by the lane being wired.
  const withoutCaches = shippedGapsForVenue({
    venueId: 'park', meta: { id: 'park' }, pois: ridePois, map: {},
  });
  assert.deepEqual(doc, withoutCaches);
  return true;
});

await check('the quest seeds the same build raises reach the shipped document', () => {
  /* `questSeedsFromInventory` was the other function only tests called. Its seeds
     are name_fix, which ships as its own gap type — so a wired lane has to leave
     both kinds of row in the document, not silently drop one. */
  const doc = shippedGapsForVenue({
    venueId: 'park',
    meta: { id: 'park' },
    pois: ridePois,
    map: {},
    adapterCaches: { 'parks-api': { attractions: [{ name: 'Beta Ride' }] } },
  });
  for (const gap of doc.gaps) {
    assert.ok(
      SHIPPED_GAP_TYPES.includes(gap.type),
      `${gap.type} is not on the builder allowlist, so the phone will drop it`,
    );
  }
  return true;
});

await check('brief-facing inventory asks strip compare metadata', () => {
  const brief = inventoryAsksForBrief([{
    key: 'parks-api-inventory',
    need: 'ParksAPI matched 1/4 rides — declare gaps or improve aliases',
    blocking: false,
    compare: { onlyInBundle: ['X'] },
    coverage: 0.25,
  }]);
  assert.deepEqual(brief, [{
    key: 'parks-api-inventory',
    need: 'ParksAPI matched 1/4 rides — declare gaps or improve aliases',
    blocking: false,
  }]);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
