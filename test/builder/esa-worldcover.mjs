#!/usr/bin/env node
/** esa-worldcover adapter — land-cover classification (aerial evidence). */
import assert from 'node:assert/strict';
import {
  tileNameFor,
  tileUrlFor,
  dominantClass,
  worldcoverClaims,
  classHistogram,
  CLASS_NAMES,
  run,
  boundsFromRing,
  classifyLands,
  classifyVenueLands,
  worldcoverLandsCacheFile,
} from '../../packages/venue-builder/lib/adapters/esa-worldcover.mjs';

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

console.log('\nesa-worldcover adapter suite\n');

await check('tileNameFor computes the correct 3°×3° SW-corner tile name', () => {
  // Cedar Point, OH — confirmed live against the real S3 bucket this session.
  assert.equal(tileNameFor(41.482602, -82.686185), 'ESA_WorldCover_10m_2021_v200_N39W084_Map');
  // Southern/eastern hemisphere signs.
  assert.equal(tileNameFor(-33.9, 151.2), 'ESA_WorldCover_10m_2021_v200_S36E150_Map');
  // Exactly on a grid line floors down, not to the nearest tile.
  assert.equal(tileNameFor(0, 6), 'ESA_WorldCover_10m_2021_v200_N00E006_Map');
});

await check('tileUrlFor builds the real public S3 URL', () => {
  const url = tileUrlFor(41.48, -82.68);
  assert.equal(
    url,
    'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39W084_Map.tif',
  );
});

await check('dominantClass picks the highest-count class and names it from the real legend', () => {
  const d = dominantClass({ 10: 3, 80: 259, 50: 120 });
  assert.equal(d.code, 80);
  assert.equal(d.name, 'permanent_water');
  assert.equal(d.count, 259);
  assert.equal(CLASS_NAMES[50], 'built_up');
});

await check('dominantClass handles an empty histogram', () => {
  assert.equal(dominantClass({}), null);
});

await check('worldcoverClaims emits one aerial claim anchored at the venue center', () => {
  const claims = worldcoverClaims({ 50: 400 }, { lat: 41.48, lng: -82.68 }, { date: '2026-01-01' });
  assert.equal(claims.length, 1);
  assert.equal(claims[0].source, 'aerial');
  assert.equal(claims[0].kind, 'metadata');
  assert.deepEqual(claims[0].at, { lat: 41.48, lng: -82.68 });
  assert.equal(claims[0].date, '2026-01-01');
  assert.ok(claims[0].note.includes('built_up'));
});

await check('worldcoverClaims returns nothing without a center or histogram', () => {
  assert.deepEqual(worldcoverClaims({}, { lat: 1, lng: 2 }), []);
  assert.deepEqual(worldcoverClaims({ 50: 1 }, null), []);
});

await check('classHistogram computes a pixel window from the image origin/resolution and reads it', async () => {
  // Real WorldCover COG geo-transform: 10 m pixels, origin at the tile's NW corner.
  const origin = [-84, 42];
  const resolution = [0.00008333333333333333, -0.00008333333333333333];
  const fakeImage = {
    getOrigin: () => origin,
    getResolution: () => resolution,
    readRasters: async ({ window }) => {
      // Matches the real window computed live against Cedar Point's bbox this session.
      assert.deepEqual(window, [15640, 6088, 15898, 6297]);
      return [new Uint8Array([80, 80, 50, 50, 80, 80, 50, 50, 10, 10, 50, 50, 10, 10, 50, 50])];
    },
  };
  const fakeOpenTiff = async (url) => {
    assert.ok(url.includes('N39W084'));
    return { getImage: async () => fakeImage };
  };
  const histogram = await classHistogram(
    { north: 41.4926, south: 41.4753, east: -82.67521, west: -82.69661 },
    { openTiff: fakeOpenTiff },
  );
  assert.deepEqual(histogram, { 80: 4, 50: 8, 10: 4 });
});

await check('run() requires a venueId', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');
});

await check('run() requires bounds and a center, and gaps rather than erroring', async () => {
  const res = await run({ venueId: '__test-esa-worldcover__' });
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('bounds'));

  const { rmSync } = await import('node:fs');
  try {
    rmSync(new URL('../../packages/venue-builder/data/venues/__test-esa-worldcover__', import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup
  }
});

await check('run() treats a bbox touching the equator/prime-meridian as valid, not missing', async () => {
  // bounds.north === 0 and center.lng === 0 are legitimate values a naive
  // truthiness check (`!bounds?.north`) would wrongly reject as "missing".
  const fakeImage = {
    getOrigin: () => [0, 0], // tile S03E000's NW corner: lng 0 (west edge), lat 0 (north edge)
    getResolution: () => [0.0000833, -0.0000833],
    readRasters: async () => [new Uint8Array([50, 50])],
  };
  const fakeOpenTiff = async () => ({ getImage: async () => fakeImage });
  const res = await run(
    {
      venueId: '__test-esa-worldcover-equator__',
      bounds: { north: 0, south: -0.01, east: 0.01, west: 0 },
      center: { lat: -0.005, lng: 0.005 },
    },
    { openTiff: fakeOpenTiff },
  );
  assert.equal(res.error, undefined);
  assert.equal(res.ok, true);

  const { rmSync } = await import('node:fs');
  try {
    rmSync(new URL('../../packages/venue-builder/data/venues/__test-esa-worldcover-equator__', import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup
  }
});

await check('boundsFromRing computes a bbox from a [lng,lat] ring', () => {
  assert.deepEqual(
    boundsFromRing([[-82.69, 41.48], [-82.68, 41.49], [-82.70, 41.50]]),
    { north: 41.5, south: 41.48, east: -82.68, west: -82.70 },
  );
  return true;
});

await check('boundsFromRing skips non-finite points rather than poisoning the box', () => {
  assert.deepEqual(
    boundsFromRing([[-82.69, 41.48], [null, undefined], [-82.68, 41.49]]),
    { north: 41.49, south: 41.48, east: -82.68, west: -82.69 },
  );
  return true;
});

await check('classifyLands samples each land\'s own bbox, not the venue bbox', async () => {
  // Two districts, two different fake rasters — proves each land gets its
  // own window/read rather than one shared venue-wide histogram.
  const seenUrls = [];
  const fakeOpenTiff = async (url) => {
    seenUrls.push(url);
    return {
      getImage: async () => ({
        getOrigin: () => [-84, 42],
        getResolution: () => [0.00008333333333333333, -0.00008333333333333333],
        readRasters: async () => (seenUrls.length === 1
          ? [new Uint8Array([50, 50, 50, 50])] // built-up
          : [new Uint8Array([10, 10, 10, 10])]), // tree cover
      }),
    };
  };
  const lands = [
    { n: 'Midway', r: [[-82.693, 41.486], [-82.692, 41.486], [-82.692, 41.487], [-82.693, 41.487]] },
    { n: 'Backcountry', r: [[-82.680, 41.480], [-82.679, 41.480], [-82.679, 41.481], [-82.680, 41.481]] },
    { n: 'Too Small', r: [[0, 0], [1, 1]] }, // fewer than 3 points — skipped
  ];
  const out = await classifyLands(lands, { openTiff: fakeOpenTiff });
  assert.equal(out.Midway.name, 'built_up');
  assert.equal(out.Backcountry.name, 'tree_cover');
  assert.equal(out['Too Small'], undefined);
  assert.equal(seenUrls.length, 2, 'one raster read per land, not a shared venue-wide read');
  return true;
});

await check('classifyLands leaves a failing land unclassified instead of failing the batch', async () => {
  const flaky = async () => { throw new Error('range read failed'); };
  const out = await classifyLands([{ n: 'Ghost Town', r: [[0, 0], [1, 0], [1, 1]] }], { openTiff: flaky });
  assert.deepEqual(out, {});
  return true;
});

await check('classifyVenueLands offline reads back what was cached, ok:false when nothing cached', async () => {
  const missing = await classifyVenueLands('__test-esa-worldcover-lands-missing__', [], { offline: true });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.data.lands, {});

  const fakeOpenTiff = async () => ({
    getImage: async () => ({
      getOrigin: () => [-84, 42],
      getResolution: () => [0.00008333333333333333, -0.00008333333333333333],
      readRasters: async () => [new Uint8Array([80, 80, 80, 80])],
    }),
  });
  const id = '__test-esa-worldcover-lands__';
  const online = await classifyVenueLands(id, [
    { n: 'Lagoon', r: [[-82.693, 41.486], [-82.692, 41.486], [-82.692, 41.487]] },
  ], { openTiff: fakeOpenTiff });
  assert.equal(online.ok, true);
  assert.equal(online.data.lands.Lagoon.name, 'permanent_water');

  const { existsSync, readFileSync, rmSync } = await import('node:fs');
  assert.ok(existsSync(worldcoverLandsCacheFile(id)), 'cache file must be written');
  assert.equal(JSON.parse(readFileSync(worldcoverLandsCacheFile(id), 'utf8')).lands.Lagoon.code, 80);

  const readBack = await classifyVenueLands(id, [], { offline: true });
  assert.equal(readBack.ok, true);
  assert.equal(readBack.data.lands.Lagoon.name, 'permanent_water');

  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${id}`, import.meta.url), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
