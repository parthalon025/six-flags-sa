#!/usr/bin/env node
/**
 * Tippecanoe GeoJSON export — `exportTileGeoJson` reads way geometry from
 * the shipped `map.json` contract (ring `r` of `[lng, lat]` pairs), not the
 * stale `{lng, lat}` object shape once expected under `p`. Regression cover
 * for #504: that mismatch made `wayToLine` return null for every way, so
 * every exported layer was silently empty.
 *
 *   node test/builder/tiles-export.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
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

const { exportTileGeoJson } = await import('../../packages/venue-builder/lib/tiles-export.mjs');

const LAYER_KEYS = ['path', 'building', 'water', 'coaster', 'slide', 'parking', 'pool'];

await check('exports a LineString from a way.r-shaped fixture', () => {
  const map = {
    path: [{ r: [[-84.265, 39.344], [-84.264, 39.345], [-84.263, 39.346]], n: 'Test Path' }],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-'));
  const written = exportTileGeoJson(dir, map, []);
  const file = written.find((f) => f.endsWith('path.geojson'));
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
  const written = exportTileGeoJson(dir, { path: [{ n: 'Ghost way' }] }, []);
  assert.equal(written.find((f) => f.endsWith('path.geojson')), undefined);
  return true;
});

await check('falls back to the legacy way.p {lng,lat} shape', () => {
  const map = {
    path: [{ p: [{ lng: -84.265, lat: 39.344 }, { lng: -84.264, lat: 39.345 }], n: 'Legacy way' }],
  };
  const dir = mkdtempSync(path.join(tmpdir(), 'tiles-export-'));
  const written = exportTileGeoJson(dir, map, []);
  const file = written.find((f) => f.endsWith('path.geojson'));
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
  const written = exportTileGeoJson(dir, map, pois);
  assert.ok(written.length > 0, 'exportTileGeoJson should write at least one file');

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
    for (const feature of geojson.features) {
      assert.equal(feature.geometry.type, 'LineString');
      assert.ok(feature.geometry.coordinates.length > 0, `${fileName} feature should have coordinates`);
    }
    nonEmptyLayers += 1;
  }
  assert.ok(nonEmptyLayers > 0, 'kings-island.map.json should have at least one non-empty layer');

  assert.ok(filesOnDisk.includes('places.geojson'), 'places.geojson should be written from pois');
  const places = JSON.parse(readFileSync(path.join(dir, 'places.geojson'), 'utf8'));
  assert.ok(places.features.length > 0, 'places.geojson should have a non-zero feature count');

  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
