#!/usr/bin/env node
/** esa-worldcover adapter — land-cover classification (aerial evidence). */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
  worldcoverCacheFile,
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

/* ── The aerial claim reaches the evidence graph ───────────────────────────
 *
 * `worldcoverClaims` has always been emitted by this adapter's `run()` and
 * then dropped on the floor: `loadExternalCaches` in external-claims.mjs read
 * every other adapter's cache and not this one, so the only live COG source in
 * the repo produced evidence nobody ingested. These checks cover the wiring —
 * and, more importantly, cover what the wiring must NOT do.                */

const VENUE_PKG_DIR = new URL('../../packages/venue-builder/data/venues/', import.meta.url);

/** Write a venue-level worldcover cache exactly as the adapter's writeCache would. */
function writeWorldcoverFixture(id, payload) {
  const file = worldcoverCacheFile(id);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  return file;
}

const dropVenueDir = (id) => {
  try {
    rmSync(new URL(id, VENUE_PKG_DIR), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
};

await check('`aerial` already has a weight in evidence.mjs — this slice mints none', async () => {
  const { WEIGHTS, bandOf, fuse } = await import('../../packages/venue-builder/lib/evidence.mjs');
  // Known answer, read off evidence.mjs: aerial sits with osm_entrance and
  // mapillary at 4, one below the park's own map.
  assert.equal(WEIGHTS.aerial, 4);
  assert.equal(bandOf(4), 'low');
  assert.equal(fuse([{ source: 'aerial' }]).score, 4);
  assert.deepEqual(fuse([{ source: 'aerial' }]).sources, ['aerial']);
  // No new source key for this adapter — the claim rides the existing weight.
  for (const minted of ['esa_worldcover', 'worldcover', 'land_cover', 'landcover']) {
    assert.equal(minted in WEIGHTS, false, `must not mint a "${minted}" weight`);
  }
  return true;
});

await check('collectExternalClaims ingests the worldcover cache as one aerial metadata claim', async () => {
  const { collectExternalClaims } = await import('../../packages/venue-builder/lib/external-claims.mjs');
  const id = '__test-worldcover-ingest__';
  try {
    // Known answer: 41 > 12 > 7, so class 10 wins and it is `tree_cover`.
    writeWorldcoverFixture(id, {
      fetched: '2026-08-18',
      source: 'esa-worldcover.org',
      license: 'CC BY 4.0',
      tile: 'ESA_WorldCover_10m_2021_v200_N39W087_Map',
      center: { lat: 39.343828, lng: -84.265811 },
      histogram: { 10: 41, 50: 12, 80: 7 },
      dominant: { code: 10, name: 'tree_cover', count: 41 },
    });

    const out = collectExternalClaims(id, []);
    const aerial = out.claims.filter((c) => c.source === 'aerial');
    assert.equal(aerial.length, 1, 'exactly one venue-level aerial claim');
    assert.equal(out.stats.bySource.aerial, 1);
    assert.equal(aerial[0].kind, 'metadata');
    assert.equal(aerial[0].type, null);
    assert.deepEqual(aerial[0].at, { lat: 39.343828, lng: -84.265811 });
    assert.equal(aerial[0].date, '2026-08-18');
    assert.equal(
      aerial[0].note,
      'ESA WorldCover: venue bbox classifies predominantly as tree_cover (class 10).',
    );
    // Metadata, never entrance — `entrance` is the list that publishes geometry.
    assert.equal(out.entrance.some((c) => c.source === 'aerial'), false);
    assert.equal(out.metadata.filter((c) => c.source === 'aerial').length, 1);
    return true;
  } finally {
    dropVenueDir(id);
  }
});

await check('loadExternalResearch carries the aerial claim into the research packet, once', async () => {
  const { loadExternalResearch } = await import('../../packages/venue-builder/lib/external-research.mjs');
  const id = '__test-worldcover-research__';
  try {
    // Known answer: 5120 > 900, so class 80 wins and it is `permanent_water`.
    writeWorldcoverFixture(id, {
      fetched: '2026-08-19',
      source: 'esa-worldcover.org',
      license: 'CC BY 4.0',
      center: { lat: 41.482602, lng: -82.686185 },
      histogram: { 50: 900, 80: 5120 },
      dominant: { code: 80, name: 'permanent_water', count: 5120 },
    });

    const res = await loadExternalResearch(id, { pois: [] });
    assert.equal(res.worldcoverRaw.dominant.name, 'permanent_water');
    assert.equal(res.normalised.stats.bySource.aerial, 1);
    const aerial = res.claims.filter((c) => c.source === 'aerial');
    // The packet's `claims` list re-spreads several adapters' raw claims beside
    // the normalised ones; this must arrive through exactly one of those paths.
    assert.equal(aerial.length, 1, 'one aerial claim — not zero, not double-counted');
    assert.equal(aerial[0].kind, 'metadata');
    assert.equal(
      aerial[0].note,
      'ESA WorldCover: venue bbox classifies predominantly as permanent_water (class 80).',
    );
    return true;
  } finally {
    dropVenueDir(id);
  }
});

await check('a venue with no worldcover cache gains no aerial claim', async () => {
  const { collectExternalClaims } = await import('../../packages/venue-builder/lib/external-claims.mjs');
  const id = '__test-worldcover-absent__';
  try {
    const out = collectExternalClaims(id, []);
    assert.equal(out.claims.some((c) => c.source === 'aerial'), false);
    assert.equal(out.stats.bySource.aerial, undefined);
    return true;
  } finally {
    dropVenueDir(id);
  }
});

await check('a ride standing on the venue centre never inherits the aerial claim as an entrance', async () => {
  // The trap this wiring has to avoid: snapClaimsToRides treats
  // `source === 'aerial'` as queue-entrance corroboration for any ride within
  // SNAP_RADIUS_M. A claim anchored at the middle of the park is a statement
  // about the park, so routing it through that path would hand a queue
  // entrance — and +4 of confidence — to whichever ride happens to stand near
  // the centroid. At Kings Island that ride is Hang Time, 46 m out.
  const { collectExternalClaims, ingestExternalClaims } = await import(
    '../../packages/venue-builder/lib/external-claims.mjs'
  );
  const { addEvidence, attractionFor } = await import('../../packages/venue-builder/lib/attractions.mjs');
  const id = '__test-worldcover-snap__';
  try {
    const centre = { lat: 39.343828, lng: -84.265811 };
    writeWorldcoverFixture(id, {
      fetched: '2026-08-18',
      center: centre,
      histogram: { 50: 900 },
      dominant: { code: 50, name: 'built_up', count: 900 },
    });
    const pois = [{ n: 'Hang Time', i: 'hang-time', c: 'ride', lat: centre.lat, lng: centre.lng }];

    const out = collectExternalClaims(id, pois);
    assert.equal(out.entrance.length, 0, 'nothing entrance-shaped came out of a metadata cache');

    const record = attractionFor(pois[0], id);
    const ingest = ingestExternalClaims([record], out.claims, {
      asOf: '2026-08-18',
      addEvidence,
      recordFor: () => record,
    });
    assert.equal(ingest.applied, 0, 'no entrance published from a venue-centre claim');
    assert.equal(record.features.queue_entrance.at, null);
    assert.equal(record.features.queue_entrance.confidence, 'unknown');
    assert.equal(record.features.queue_entrance.evidence.length, 0);
    // It did arrive — as a graph node, which is where metadata belongs.
    assert.equal(ingest.graphNodes.filter((n) => n.claims[0].source === 'aerial').length, 1);
    return true;
  } finally {
    dropVenueDir(id);
  }
});

await check("kings-island's published attractions output is byte-identical with the aerial claim", async () => {
  // The load-bearing one. A venue-centre metadata claim must add evidence to
  // the graph without moving a single place or shifting one confidence band.
  const { inventory, publish } = await import('../../packages/venue-builder/bin/attractions.mjs');
  const { PUBLISH_AT } = await import('../../packages/venue-builder/lib/evidence.mjs');
  const { trim } = await import('../../packages/venue-builder/lib/attractions.mjs');

  const id = 'kings-island';
  const cacheFile = worldcoverCacheFile(id);
  const hadCache = existsSync(cacheFile);
  const priorBytes = hadCache ? readFileSync(cacheFile) : null;

  const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const bands = (records) => {
    const tally = {};
    for (const r of records) {
      const b = r.features.queue_entrance.confidence;
      tally[b] = (tally[b] || 0) + 1;
    }
    return tally;
  };
  const snapshot = () => {
    const state = inventory(id, {});
    publish(id, state.pois, state.records, PUBLISH_AT);
    return {
      attractions: JSON.stringify(state.records.map(trim), null, 2),
      pois: JSON.stringify(state.pois, null, 2),
      bands: bands(state.records),
      count: state.records.length,
      aerial: state.externalStats.bySource.aerial,
    };
  };

  try {
    if (hadCache) rmSync(cacheFile);
    const before = snapshot();

    // Guard against a vacuous comparison: this venue really does carry a large
    // inventory with a spread of confidence bands, so "identical" means
    // something.
    assert.ok(before.count >= 60, `kings-island should have ~68 rides, saw ${before.count}`);
    assert.ok(before.attractions.length > 50000, 'attractions payload must be substantial');
    assert.ok(Object.keys(before.bands).length >= 2, 'more than one confidence band in play');
    assert.equal(
      Object.values(before.bands).reduce((a, b) => a + b, 0),
      before.count,
      'every ride is counted in exactly one band',
    );
    assert.equal(before.aerial, undefined, 'baseline has no aerial claim');

    writeWorldcoverFixture(id, {
      fetched: '2026-08-18',
      source: 'esa-worldcover.org',
      license: 'CC BY 4.0',
      tile: 'ESA_WorldCover_10m_2021_v200_N39W087_Map',
      center: { lat: 39.343828, lng: -84.265811 },
      histogram: { 10: 2461, 30: 611, 50: 9042, 80: 137 },
      dominant: { code: 50, name: 'built_up', count: 9042 },
    });
    const after = snapshot();

    // Half one: the claim actually arrived. Without this the byte comparison
    // below would pass by doing nothing at all.
    assert.equal(after.aerial, 1, 'the aerial claim must reach the evidence graph');

    // Half two: and it moved nothing.
    assert.deepEqual(after.bands, before.bands, 'no confidence band may shift');
    assert.equal(after.count, before.count);
    assert.equal(sha(after.attractions), sha(before.attractions), 'attractions.json bytes must not move');
    assert.equal(sha(after.pois), sha(before.pois), 'published pois bytes must not move');
    assert.equal(after.attractions, before.attractions);
    assert.equal(after.pois, before.pois);
    return true;
  } finally {
    if (hadCache) writeFileSync(cacheFile, priorBytes);
    else rmSync(cacheFile, { force: true });
  }
});

await check('cedar-point republishes its committed bundle byte-for-byte with the aerial claim live', async () => {
  // Cedar Point is the one venue carrying a real esa-worldcover histogram on
  // disk, and the one whose bundle actually has published entrance coordinates
  // (three `fused` ones). No fixture and no file mutation here: the committed
  // bundle was generated before this slice existed, so reproducing it exactly
  // *while* the aerial claim is in the graph is the before/after comparison.
  const { inventory, publish } = await import('../../packages/venue-builder/bin/attractions.mjs');
  const { PUBLISH_AT } = await import('../../packages/venue-builder/lib/evidence.mjs');
  const { VENUE_DIR } = await import('../../packages/venue-builder/lib/venue-io.mjs');

  const id = 'cedar-point';
  const state = inventory(id, {});
  assert.equal(state.externalStats.bySource.aerial, 1, 'the real worldcover cache must be read');

  // On real data, no ride anywhere may end up citing the venue-centre claim as
  // evidence about itself — published or merely proposed. Rougarou stands 46 m
  // from Cedar Point's centroid, which is inside SNAP_RADIUS_M.
  const borrowed = state.records.filter(
    (r) => Object.values(r.features).some((f) => (f.sources || []).includes('aerial')),
  );
  assert.deepEqual(borrowed.map((r) => r.name), [], 'no ride may take the venue-centre claim as its own');

  const changed = publish(id, state.pois, state.records, PUBLISH_AT);
  assert.equal(changed, 3, 'three fields still clear the publish bar');
  const fused = state.pois.filter((p) => (p.e || []).some((x) => x.src?.by === 'fused'));
  assert.deepEqual(
    fused.map((p) => p.n).sort(),
    ['Gemini', 'Millennium Force', 'Top Thrill 2'],
    'the same three rides publish a fused entrance as before',
  );

  const bundle = readFileSync(path.join(VENUE_DIR, `${id}.pois.json`), 'utf8');
  // Anti-vacuity: this is a ~70 KB bundle of 425 places, not two empty strings.
  /* 425 after the 2026-08-28 rebuild from current OSM (was 427 on main).
     Two food POIs dropped from OSM between builds; routing connector work
     re-ran the builder and picked up the live graph. See ticket 23 / 30. */
  assert.ok(bundle.length > 60000, `bundle should be ~72 KB, saw ${bundle.length}`);
  assert.equal(state.pois.length, 425);
  assert.equal(
    `${JSON.stringify(state.pois, null, 2)}\n`,
    bundle,
    'republished bundle must equal the committed one byte for byte',
  );
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
