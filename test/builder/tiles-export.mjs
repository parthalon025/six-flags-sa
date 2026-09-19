#!/usr/bin/env node
/**
 * Tippecanoe GeoJSON export — `exportTileGeoJson` reads way geometry from
 * the shipped `map.json` contract (ring `r` of `[lng, lat]` pairs), not the
 * stale `{lng, lat}` object shape once expected under `p`. Regression cover
 * for #504: that mismatch produced null for every way, so every exported
 * layer was silently empty. Area layers (building, water, parking, pool)
 * export as closed Polygons; the rest as LineStrings.
 *
 *   node test/builder/tiles-export.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

console.log('\ntiles-export\n');

const { exportTileGeoJson, runTippecanoePerLayer } = await import('../../packages/venue-builder/lib/tiles-export.mjs');
const { tippecanoeAvailable } = await import('../../packages/venue-builder/lib/display-tiles.mjs');

const LAYER_KEYS = ['path', 'building', 'water', 'coaster', 'slide', 'parking', 'pool'];
const AREA_KEYS = new Set(['building', 'water', 'parking', 'pool']);

await check('exports a LineString from a way.r-shaped fixture', () => {
  const map = {
    path: [{ r: [[-84.265, 39.344], [-84.264, 39.345], [-84.263, 39.346]], n: 'Test Path' }],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-'));
  const { files } = exportTileGeoJson(dir, map, []);
  const file = files.find((f) => f.endsWith('path.geojson'));
  assert.ok(file, 'path.geojson should be written');
  const geojson = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(geojson.features.length, 1);
  assert.equal(geojson.features[0].geometry.type, 'LineString');
  assert.deepEqual(geojson.features[0].geometry.coordinates, [
    [-84.265, 39.344],
    [-84.264, 39.345],
    [-84.263, 39.346],
  ]);
  return true;
});

await check('returns null for a way with no r and no p', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-'));
  const { files } = exportTileGeoJson(dir, { path: [{ n: 'Ghost way' }] }, []);
  assert.equal(files.find((f) => f.endsWith('path.geojson')), undefined);
  return true;
});

await check('falls back to the legacy way.p {lng,lat} shape', () => {
  const map = {
    path: [{ p: [{ lng: -84.265, lat: 39.344 }, { lng: -84.264, lat: 39.345 }], n: 'Legacy way' }],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-'));
  const { files } = exportTileGeoJson(dir, map, []);
  const file = files.find((f) => f.endsWith('path.geojson'));
  const geojson = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(geojson.features[0].geometry.coordinates, [
    [-84.265, 39.344],
    [-84.264, 39.345],
  ]);
  return true;
});

await check('produces non-null, non-empty features for every layer of a real shipped bundle', () => {
  const map = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/kings-island.map.json', import.meta.url), 'utf8'),
  );
  const pois = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/kings-island.pois.json', import.meta.url), 'utf8'),
  );

  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-kings-island-'));
  const { files } = exportTileGeoJson(dir, map, pois);
  assert.ok(files.length > 0, 'exportTileGeoJson should write at least one file');

  const filesOnDisk = readdirSync(dir);
  let nonEmptyLayers = 0;
  for (const key of LAYER_KEYS) {
    const ways = map[key] || [];
    if (!ways.length) continue;
    const fileName = `${key}.geojson`;
    assert.ok(
      filesOnDisk.includes(fileName),
      `${fileName} should be written since map.${key} has ${ways.length} way(s)`,
    );
    const geojson = JSON.parse(readFileSync(path.join(dir, fileName), 'utf8'));
    assert.ok(geojson.features.length > 0, `${fileName} should have a non-zero feature count`);
    const wantType = AREA_KEYS.has(key) ? 'Polygon' : 'LineString';
    for (const feature of geojson.features) {
      assert.equal(feature.geometry.type, wantType, `${fileName} features should be ${wantType}s`);
      const coords = wantType === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
      assert.ok(coords.length > 0, `${fileName} feature should have coordinates`);
    }
    nonEmptyLayers += 1;
  }
  assert.ok(nonEmptyLayers > 0, 'kings-island.map.json should have at least one non-empty layer');

  assert.ok(filesOnDisk.includes('places.geojson'), 'places.geojson should be written from pois');
  const places = JSON.parse(readFileSync(path.join(dir, 'places.geojson'), 'utf8'));
  assert.ok(places.features.length > 0, 'places.geojson should have a non-zero feature count');

  return true;
});

await check('tippecanoe adapter ok follows gap vs failure (#414)', async () => {
  const { runAdapter } = await import('../../packages/venue-builder/lib/adapters/runner.mjs');
  const r = await runAdapter('tippecanoe', { venueId: 'kings-island' });
  assert.equal(r.adapterId, 'tippecanoe');
  assert.ok(r.artifacts?.length, 'should write geojson artifacts');
  if (r.meta.tiles.gap) {
    assert.equal(r.ok, true, 'missing tippecanoe is a gap, not an adapter failure');
    assert.equal(r.meta.tiles.ok, false);
  } else {
    assert.equal(r.ok, r.meta.tiles.ok, 'adapter ok must match tippecanoe result when not a gap');
    assert.equal(r.meta.tiles.ok, true, r.error || r.meta.tiles.reason);
  }
  return true;
});

await check('runTippecanoePerLayer records gap when binary is absent (#414)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-gap-'));
  const geojson = path.join(dir, 'path.geojson');
  writeFileSync(geojson, '{"type":"FeatureCollection","features":[]}\n');
  const tiles = runTippecanoePerLayer(dir, [geojson], { isAvailable: () => false });
  assert.equal(tiles.ok, false);
  assert.equal(tiles.gap, true);
  assert.match(tiles.reason, /tippecanoe/);
  assert.equal(readdirSync(dir).some((f) => f.endsWith('.mbtiles')), false);
  return true;
});

await check('runTippecanoePerLayer runs each layer when binary is present (#414)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-run-'));
  const geojson = path.join(dir, 'path.geojson');
  writeFileSync(geojson, '{"type":"FeatureCollection","features":[]}\n');
  const tiles = runTippecanoePerLayer(dir, [geojson], {
    isAvailable: () => true,
    runLayer: (outFile) => {
      writeFileSync(outFile, 'mbtiles-stub');
      return { status: 0 };
    },
  });
  assert.equal(tiles.ok, true, tiles.reason);
  assert.deepEqual(tiles.mbtiles, [path.join(dir, 'path.mbtiles')]);
  assert.ok(existsSync(tiles.mbtiles[0]));
  return true;
});

await check('tippecanoe run or gap is recorded honestly in exportTileGeoJson (#414)', () => {
  const map = {
    path: [{ r: [[-84.265, 39.344], [-84.264, 39.345], [-84.263, 39.346]], n: 'Test Path' }],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-tippecanoe-'));
  const { files, tiles } = exportTileGeoJson(dir, map, []);
  assert.ok(files.some((f) => f.endsWith('tippecanoe.sh')), 'recipe should always be written');
  if (tippecanoeAvailable()) {
    assert.equal(tiles.ok, true, tiles.reason);
    assert.ok(tiles.mbtiles.length >= 1, 'path.mbtiles should be produced');
    assert.ok(existsSync(tiles.mbtiles[0]), 'mbtiles file should exist on disk');
    assert.ok(files.some((f) => f.endsWith('.mbtiles')), 'mbtiles paths included in files');
  } else {
    assert.equal(tiles.ok, false);
    assert.equal(tiles.gap, true);
    assert.match(tiles.reason, /tippecanoe/);
    assert.equal(readdirSync(dir).some((f) => f.endsWith('.mbtiles')), false);
  }
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
