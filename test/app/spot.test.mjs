#!/usr/bin/env node
/**
 * spot.js — naming a tapped patch of ground.
 *
 * The two things that are easy to get wrong here and expensive to notice
 * later: a spot must never claim a Zone the venue did not draw (placeContext
 * owns that rule), and it must survive having no fix, because the app runs
 * denied, indoors and on a manual pin.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { spotAt, SPOT_NEAR_M } = await import('../../apps/party-tracker/lib/spot.js');

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

/* Kings Island's own numbers, near enough: a tenth of a degree of latitude is
   about 11.1 km, so 0.0001° ≈ 11.1 m north. That is the ruler every offset
   below is measured with. */
const M_PER_DEG_LAT = 111_320;
const north = (lat, metres) => lat + metres / M_PER_DEG_LAT;

const RESTROOM = { i: 'kings-island-restroom-1', n: 'Restrooms', lat: 39.3446, lng: -84.269, a: 'Adventure Port' };
const BEAST = { i: 'kings-island-the-beast', n: 'The Beast', lat: 39.35, lng: -84.272, a: 'Rivertown' };
// `a` is a named OSM area the venue never drew as a Zone — placeContext must
// fall back to the World rather than repeat it.
const OFF_MAP = { i: 'kings-island-lot-a', n: 'Lot A', lat: 39.34, lng: -84.262, a: 'Landen' };
const POIS = [RESTROOM, BEAST, OFF_MAP];
const VENUE = { id: 'kings-island', name: 'Kings Island' };
const MAP = { lands: [{ n: 'Adventure Port' }, { n: 'Rivertown' }] };

check('a tap inside the threshold is named by the Place it is standing at', () => {
  const s = spotAt({ lat: north(RESTROOM.lat, 10), lng: RESTROOM.lng, pois: POIS, venue: VENUE, map: MAP });
  assert.equal(s.name, 'By Restrooms');
  assert.equal(s.near, 'Restrooms');
  assert.equal(s.placeId, RESTROOM.i);
  assert.equal(s.zone, 'Adventure Port');
});

check('a tap past the threshold is open ground, and says how far the Place is', () => {
  const s = spotAt({ lat: north(RESTROOM.lat, SPOT_NEAR_M + 20), lng: RESTROOM.lng, pois: POIS, venue: VENUE, map: MAP });
  assert.equal(s.name, 'Open ground');
  assert.equal(s.placeId, null, 'unanchored ground must not file against a neighbour');
  assert.match(s.near, /^\d+ ft from Restrooms$/);
  assert.equal(s.zone, 'Adventure Port');
});

check('the Zone is only ever one the venue drew — otherwise the World', () => {
  const s = spotAt({ lat: north(OFF_MAP.lat, 5), lng: OFF_MAP.lng, pois: POIS, venue: VENUE, map: MAP });
  assert.equal(s.name, 'By Lot A');
  assert.equal(s.zone, 'Kings Island', 'Landen is a named area, not a mapped Zone');
});

check('walk, distance and reach are omitted with no fix', () => {
  const s = spotAt({ lat: RESTROOM.lat, lng: RESTROOM.lng, pois: POIS, venue: VENUE, map: MAP, me: null });
  assert.equal(s.metres, null);
  assert.equal(s.walk, null);
  assert.equal(s.dist, null);
  assert.equal(s.reach, null);
  // Everything that does not need a fix still answers.
  assert.equal(s.name, 'By Restrooms');
});

check('with a fix, reach reads "<walk> walk · <distance>"', () => {
  const me = { lat: north(RESTROOM.lat, -400), lng: RESTROOM.lng };
  const s = spotAt({ lat: RESTROOM.lat, lng: RESTROOM.lng, pois: POIS, venue: VENUE, map: MAP, me });
  assert.ok(Math.abs(s.metres - 400) < 2, `expected ~400 m, got ${s.metres}`);
  assert.equal(s.reach, `${s.walk} walk · ${s.dist}`);
  assert.equal(s.walk, '6 min');
});

check('a venue with no Places still yields a usable spot', () => {
  const s = spotAt({ lat: 39.3446, lng: -84.269, pois: [], venue: VENUE, map: MAP });
  assert.equal(s.name, 'Open ground');
  assert.equal(s.near, null);
  assert.equal(s.placeId, null);
  assert.equal(s.zone, 'Kings Island');
});

check('the tap is stored as coordinates, never as screen position', () => {
  const s = spotAt({ lat: 39.3446, lng: -84.269, pois: POIS, venue: VENUE, map: MAP });
  assert.equal(s.lat, 39.3446);
  assert.equal(s.lng, -84.269);
  assert.equal(s.x, undefined);
  assert.equal(s.y, undefined);
});

if (FAIL.length) {
  console.error(`spot tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`spot tests: ${PASS.length} passed`);
}
