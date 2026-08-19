#!/usr/bin/env node
/**
 * geo.js — Web Mercator projection and the venue-origin rebase.
 *
 * localMetres() is the reference implementation the display-pipeline parity
 * check calls independently of both renderers (issue #527): ParkMap.jsx's
 * SVG and the MapLibre spike must each land a Place at the same point this
 * says they should, without calling this function themselves at render time.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { project, unproject, localMetres } = await import('../../apps/party-tracker/lib/geo.js');

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

// Big Kahuna's gate, from apps/party-tracker/public/venues/big-kahunas.map.json.
const ORIGIN_LATLNG = { lat: 30.3883, lng: -86.473 };
const ORIGIN = project(ORIGIN_LATLNG.lat, ORIGIN_LATLNG.lng);

check('localMetres at the origin is (0, 0)', () => {
  const [x, y] = localMetres(ORIGIN_LATLNG.lat, ORIGIN_LATLNG.lng, ORIGIN);
  assert.ok(Math.abs(x) < 1e-6, `x too large: ${x}`);
  assert.ok(Math.abs(y) < 1e-6, `y too large: ${y}`);
});

check('localMetres is project() rebased — matches manual subtraction', () => {
  const at = { lat: 30.388482, lng: -86.472952 }; // Big Kahuna's Backyard
  const [px, py] = project(at.lat, at.lng);
  const [ox, oy] = ORIGIN;
  const [x, y] = localMetres(at.lat, at.lng, ORIGIN);
  assert.equal(x, px - ox);
  assert.equal(y, py - oy);
});

check('localMetres moves east for a larger lng, at a known scale', () => {
  // One arc-second east of the origin, same latitude.
  const east = { lat: ORIGIN_LATLNG.lat, lng: ORIGIN_LATLNG.lng + 1 / 3600 };
  const [x, y] = localMetres(east.lat, east.lng, ORIGIN);
  assert.ok(x > 0, `expected east to be positive x, got ${x}`);
  // ~30.87m per arc-second of longitude at this latitude (R=6371000).
  assert.ok(Math.abs(x - 30.87) < 0.1, `unexpected east offset: ${x}`);
  assert.ok(Math.abs(y) < 1e-6, `latitude unchanged should keep y at 0, got ${y}`);
});

check('localMetres moves north for a larger lat, at a known scale', () => {
  const north = { lat: ORIGIN_LATLNG.lat + 1 / 3600, lng: ORIGIN_LATLNG.lng };
  const [x, y] = localMetres(north.lat, north.lng, ORIGIN);
  assert.ok(y > 0, `expected north to be positive y, got ${y}`);
  // Mercator y stretches by sec(lat); ~30.9m per arc-second of latitude at the
  // equator becomes ~35.8m at Big Kahuna's ~30.39°N (sec(30.39°) ≈ 1.159).
  assert.ok(Math.abs(y - 35.81) < 0.1, `unexpected north offset: ${y}`);
  assert.ok(Math.abs(x) < 1e-6, `longitude unchanged should keep x at 0, got ${x}`);
});

check('localMetres is translation-only: shifting the origin shifts the result by exactly that much', () => {
  const at = { lat: 30.388012, lng: -86.472376 }; // Big Kahuna's Tropical Mini Golf
  const [x0, y0] = localMetres(at.lat, at.lng, ORIGIN);
  const shiftedOrigin = project(ORIGIN_LATLNG.lat + 0.001, ORIGIN_LATLNG.lng + 0.001);
  const [x1, y1] = localMetres(at.lat, at.lng, shiftedOrigin);
  const [dox, doy] = [shiftedOrigin[0] - ORIGIN[0], shiftedOrigin[1] - ORIGIN[1]];
  assert.ok(Math.abs(x0 - dox - x1) < 1e-6);
  assert.ok(Math.abs(y0 - doy - y1) < 1e-6);
});

check('localMetres round-trips through unproject', () => {
  const at = { lat: 30.39, lng: -86.469 };
  const [x, y] = localMetres(at.lat, at.lng, ORIGIN);
  const [ox, oy] = ORIGIN;
  const [lat, lng] = unproject(x + ox, y + oy);
  assert.ok(Math.abs(lat - at.lat) < 1e-9);
  assert.ok(Math.abs(lng - at.lng) < 1e-9);
});

if (FAIL.length) {
  console.error(`geo tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`geo tests: ${PASS.length} passed`);
}
