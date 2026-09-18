#!/usr/bin/env node
/** osmium adapter — regional PBF extract for air-gapped OSM geometry builds. */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import {
  OSM_WANTED_KEYS,
  bboxArg,
  tagsFilterArgs,
  cliAvailable,
  resolvePbfPath,
  geojsonSeqToOverpass,
  queryPbf,
  overpassQuery,
  run,
} from '../../packages/venue-builder/lib/adapters/osmium.mjs';

const TEST_VENUE = '__test-osmium__';
const TEST_VENUE_2 = '__test-osmium-2__';
const TEST_VENUE_3 = '__test-osmium-3__';

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

console.log('\nosmium adapter suite\n');

await check('bboxArg formats west,south,east,north for osmium extract', () => {
  assert.equal(bboxArg({ west: -84.3, south: 39.33, east: -84.25, north: 39.35 }), '-84.3,39.33,-84.25,39.35');
});

await check('tagsFilterArgs mirrors the Overpass wanted-key list as nwr/ filters', () => {
  const args = tagsFilterArgs();
  assert.equal(args.length, OSM_WANTED_KEYS.length);
  assert.ok(args.includes('nwr/highway'));
  assert.ok(args.includes('nwr/roller_coaster'));
});

await check('overpassQuery still unions the same keys the PBF path filters on', () => {
  const q = overpassQuery({ south: 1, west: 2, north: 3, east: 4 });
  for (const key of OSM_WANTED_KEYS) {
    assert.ok(q.includes(`way["${key}"]`), `missing way filter for ${key}`);
    assert.ok(q.includes(`node["${key}"]`), `missing node filter for ${key}`);
  }
});

await check('resolvePbfPath prefers --from-pbf over VENUE_OSM_PBF', () => {
  assert.equal(resolvePbfPath({ pbf: '/flag.pbf', env: { VENUE_OSM_PBF: '/env.pbf' } }), '/flag.pbf');
  assert.equal(resolvePbfPath({ env: { VENUE_OSM_PBF: '/env.pbf' } }), '/env.pbf');
  assert.equal(resolvePbfPath({}), null);
});

await check('cliAvailable reports false when osmium is not on PATH', async () => {
  const failing = async () => {
    throw new Error('ENOENT: osmium not found');
  };
  assert.equal(await cliAvailable(failing), false);
});

await check('geojsonSeqToOverpass maps export features to Overpass element shapes', () => {
  const lines = [
    JSON.stringify({
      type: 'Feature',
      properties: { '@id': 'n42', name: 'Gate', amenity: 'entrance' },
      geometry: { type: 'Point', coordinates: [-84.27, 39.34] },
    }),
    JSON.stringify({
      type: 'Feature',
      properties: { '@id': 'w99', highway: 'footway' },
      geometry: { type: 'LineString', coordinates: [[-84.27, 39.34], [-84.26, 39.35]] },
    }),
  ].join('\n');
  const { elements } = geojsonSeqToOverpass(lines);
  assert.equal(elements.length, 2);
  assert.equal(elements[0].type, 'node');
  assert.equal(elements[0].id, 42);
  assert.equal(elements[0].lat, 39.34);
  assert.equal(elements[0].tags.name, 'Gate');
  assert.equal(elements[1].type, 'way');
  assert.equal(elements[1].geometry[0].lon, -84.27);
});

await check('queryPbf runs extract → tags-filter → export with injected exec', async () => {
  const calls = [];
  const fakeExec = async (cmd, args) => {
    calls.push([cmd, ...args]);
    return { stdout: '', stderr: '' };
  };
  const bounds = { west: -1, south: 0, east: 1, north: 2 };
  const geojson = [
    JSON.stringify({
      type: 'Feature',
      properties: { '@id': 'w1', building: 'yes' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    }),
  ].join('\n');
  const res = await queryPbf('/region.pbf', bounds, {
    exec: fakeExec,
    readExport: async () => geojson,
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], 'osmium');
  assert.equal(calls[0][1], 'extract');
  assert.ok(calls[0].includes('-b'));
  assert.ok(calls[0].includes('/region.pbf'));
  assert.equal(calls[1][1], 'tags-filter');
  assert.ok(calls[1].includes('nwr/building'));
  assert.equal(calls[2][1], 'export');
  assert.equal(res.elements.length, 1);
  assert.equal(res.elements[0].type, 'way');
});

await check('run() requires a venueId', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');
});

await check('run() gaps when no PBF path is configured', async () => {
  const res = await run({ venueId: TEST_VENUE, bounds: { north: 1, south: 0, east: 1, west: 0 } });
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('pbf'));
});

await check('run() gaps when the osmium CLI is unavailable', async () => {
  const failingExec = async () => {
    throw new Error('ENOENT');
  };
  const res = await run(
    { venueId: TEST_VENUE_2, bounds: { north: 1, south: 0, east: 1, west: 0 }, pbfPath: '/x.pbf' },
    { exec: failingExec },
  );
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('osmium CLI not found'));
});

await check('run() returns elements when exec and export succeed', async () => {
  const fakeExec = async () => ({ stdout: '', stderr: '' });
  const geojson = JSON.stringify({
    type: 'Feature',
    properties: { '@id': 'n7', tourism: 'theme_park', name: 'Test Park' },
    geometry: { type: 'Point', coordinates: [1, 2] },
  });
  const res = await run(
    { venueId: TEST_VENUE_3, bounds: { north: 3, south: 1, east: 2, west: 0 }, pbfPath: '/region.pbf' },
    { exec: fakeExec, readExport: async () => geojson },
  );
  assert.equal(res.ok, true);
  assert.equal(res.meta.count, 1);
  assert.equal(res.data.elements.length, 1);
});

for (const id of [TEST_VENUE, TEST_VENUE_2, TEST_VENUE_3]) {
  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${id}`, import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup
  }
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
