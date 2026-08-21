#!/usr/bin/env node
/**
 * overlayGeo.js — the live overlay as GeoJSON (ADR-0019 clause 4).
 *
 * The overlay is moving out of ParkMap.jsx's hand-rolled SVG and into MapLibre
 * sources. This is the data half: party members, the walking route, Marks,
 * chosen pins and Places become FeatureCollections a symbol/line layer can
 * read. Nothing here touches a map — the point of the seam is that the shapes
 * can be proven before a renderer exists to draw them.
 *
 * Every expected value below is a literal written out by hand from the fixture
 * at the top, never a value read back out of the module. The fixture's
 * coordinates are real Kings Island Places from
 * apps/party-tracker/public/venues/kings-island.pois.json.
 *
 *   node test/app/overlay-geo.test.mjs
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { lngLat, overlayGeoJson, OVERLAY_LAYERS } = await import('../../apps/party-tracker/lib/overlayGeo.js');

/* A fixed clock. Staleness is the only thing in here that depends on time, and
   a test that reads the real clock cannot state a known answer for it.
   1787335200000 is 2026-08-21T18:00:00.000Z. */
const NOW = 1787335200000;

/* Kings Island, three members plus one whose fix never arrived.
   - Ada: 30 s old            -> fresh
   - Bo: 10 min old           -> older than mapSymbols' STALE_AFTER_MS (5 min)
   - Cy: 5 s old              -> fresh
   - Dot: lat null            -> must never reach the map at all
   Member coordinates are {lat, lng} objects; route points are [lat, lng]
   pairs. Two input orderings, one output ordering, which is exactly the bug
   this collection of assertions exists to catch. */
const MEMBERS = [
  {
    id: 'm_ada',
    name: 'Ada',
    initials: 'AD',
    colour: '#2E7D32',
    lat: 39.34,
    lng: -84.269,
    ts: NOW - 30000,
    heading: 90,
    live: true,
    kit: 'first-aid',
    place: { name: 'Rivertown' },
  },
  {
    id: 'm_bo',
    name: 'Bo',
    initials: 'BO',
    colour: '#1565C0',
    lat: 39.343,
    lng: -84.263,
    ts: NOW - 600000,
    heading: 180,
    live: true,
    kit: null,
    place: null,
  },
  {
    id: 'm_cy',
    name: 'Cy',
    initials: 'CY',
    colour: '#C62828',
    lat: 39.3415,
    lng: -84.266,
    ts: NOW - 5000,
    heading: null,
    live: true,
    status: 'NEED HELP',
    kit: null,
    place: { name: 'Coney Mall' },
  },
  {
    id: 'm_dot',
    name: 'Dot',
    initials: 'DO',
    colour: '#6A1B9A',
    lat: null,
    lng: -84.264,
    ts: NOW - 1000,
    heading: 45,
    live: true,
  },
];

/* Five points, so four legs. routing.js's assemble() builds exactly this
   shape: [lat, lng] pairs plus metres/seconds/mode. */
const ROUTE = {
  points: [
    [39.34, -84.269],
    [39.3405, -84.268],
    [39.3412, -84.267],
    [39.3418, -84.266],
    [39.3425, -84.265],
  ],
  metres: 600,
  seconds: 480,
  mode: 'path',
  via: 'Coney Mall',
};

/* routeProgress()'s answer: on leg 1 (the second of four), 240 m walked of
   600, 360 m to go. */
const PROGRESS = {
  leg: 1,
  snapped: [39.3409, -84.2676],
  travelled: 240,
  remaining: 360,
  arrived: false,
};

const POIS = [
  { i: 'adventure-express', n: 'Adventure Express', lat: 39.344465, lng: -84.264865, c: 'coaster', a: 'Adventure Port' },
  { i: 'antique-photos', n: 'Antique Photos', lat: 39.341072, lng: -84.267249, c: 'shop', a: 'Rivertown' },
  // A Place the venue file lists without a fix. Same rule as a member: drop it.
  { i: 'ghost-ride', n: 'Ghost Ride', lat: null, lng: -84.26, c: 'ride', a: 'Rivertown' },
];

const MODEL = {
  members: MEMBERS,
  route: ROUTE,
  progress: PROGRESS,
  pois: POIS,
  // world.js makeMark() leaves lat/lng null when the Mark was left at a Place;
  // ParkMap resolves that through the Place list, and so must this.
  marks: [
    {
      id: 'mk_quest',
      type: 'sign',
      placeId: 'adventure-express',
      lat: null,
      lng: null,
      phrase: 'Meet by the gate',
      opacity: 0.6,
    },
    // Neither a fix nor a Place that exists: unresolvable, so dropped.
    { id: 'mk_orphan', type: 'sign', placeId: 'no-such-place', lat: null, lng: null, phrase: 'Nowhere' },
  ],
  meet: { lat: 39.3435, lng: -84.2645, label: 'Rally Point' },
  car: { lat: 39.337, lng: -84.273 },
  overlayPins: [{ id: 'op_shortcut', kind: 'path', label: 'Shortcut', lat: 39.3402, lng: -84.2675 }],
};

// --------------------------------------------------------------- the primitive

/* `lngLat` is the one conversion this module exists to centralise — swap the
   order and every guest moves to Antarctica; fall back to zero on half a
   coordinate and they move to the Gulf of Guinea. Both other adapters in the
   repo (display-tiles.mjs displayGeoJson, DisplayMap.jsx placesGeoJson) write
   this out longhand today and should end up calling this instead. */
assert.deepEqual(lngLat({ lat: 39.344465, lng: -84.264865 }), [-84.264865, 39.344465]);
assert.equal(lngLat({ lat: null, lng: -84.264865 }), null, 'half a coordinate is not a coordinate');
assert.equal(lngLat({ lat: 39.344465, lng: null }), null);
assert.equal(lngLat({ lat: 39.344465, lng: Number.NaN }), null);
assert.equal(lngLat({ lat: '39.34', lng: '-84.26' }), null, 'a stringified fix is not a fix');
assert.equal(lngLat(null), null);
assert.equal(lngLat(undefined), null);
// Zero is a real coordinate off the coast of Ghana, so the finite test must
// not be a truthiness test.
assert.deepEqual(lngLat({ lat: 0, lng: 0 }), [0, 0]);

const out = overlayGeoJson(MODEL, { now: NOW });

// ---------------------------------------------------------------- collections

// One source per collection, always all of them. A MapLibre source is added
// once and fed with setData afterwards, so a key that vanishes when its list
// empties leaves the last frame's features on screen forever.
assert.deepEqual(Object.keys(out).sort(), ['marks', 'members', 'pins', 'places', 'route']);
assert.deepEqual([...OVERLAY_LAYERS].sort(), ['marks', 'members', 'pins', 'places', 'route']);
for (const name of OVERLAY_LAYERS) {
  assert.equal(out[name].type, 'FeatureCollection', `${name} is a FeatureCollection`);
}

// ------------------------------------------------------------------- members

// Four members in, three out: Dot has no latitude.
assert.equal(out.members.features.length, 3, 'three members carry a usable fix');
assert.deepEqual(
  out.members.features.map((f) => f.id),
  ['m_ada', 'm_bo', 'm_cy'],
);

// The one that matters most. A non-finite lat must drop the member, not fall
// back to zero — [0, 0] is in the Gulf of Guinea, and a guest teleported there
// reads as a real fix rather than as missing data.
assert.ok(
  !out.members.features.some((f) => f.id === 'm_dot'),
  'a member with a null lat is dropped, never emitted',
);
/* Half a fallback is still a fallback: `Number(lng) || 0` on a null latitude
   emits [-84.264, 0], which is not [0, 0] and is still in the Gulf of Guinea.
   So the rule is stated as the rule — two finite numbers, and no ordinate is
   zero, because neither of Kings Island's is. */
for (const f of out.members.features) {
  const [lng, lat] = f.geometry.coordinates;
  assert.ok(Number.isFinite(lng) && Number.isFinite(lat), `${f.id} has two finite ordinates`);
  assert.ok(lng !== 0 && lat !== 0, `${f.id} must not be parked on a null-island ordinate`);
}

// lng first, lat second — GeoJSON's order, and the opposite of how every
// member record in this app stores it.
assert.deepEqual(out.members.features[0].geometry.type, 'Point');
assert.deepEqual(out.members.features[0].geometry.coordinates, [-84.269, 39.34]);
assert.deepEqual(out.members.features[1].geometry.coordinates, [-84.263, 39.343]);
assert.deepEqual(out.members.features[2].geometry.coordinates, [-84.266, 39.3415]);

// Staleness, from mapSymbols' one rule: a fix older than five minutes.
assert.equal(out.members.features[0].properties.stale, false, 'Ada is 30 s old');
assert.equal(out.members.features[1].properties.stale, true, 'Bo is 10 min old');
assert.equal(out.members.features[2].properties.stale, false, 'Cy is 5 s old');

// Age in milliseconds, so a style can fade or label it. Known answers from the
// fixture's own offsets.
assert.equal(out.members.features[0].properties.ageMs, 30000);
assert.equal(out.members.features[1].properties.ageMs, 600000);
assert.equal(out.members.features[2].properties.ageMs, 5000);

// Heading is only worth drawing while the fix behind it is fresh, and Cy has
// none at all.
assert.equal(out.members.features[0].properties.facing, 90);
assert.equal(out.members.features[1].properties.facing, null, 'a stale fix carries no heading');
assert.equal(out.members.features[2].properties.facing, null);

// The rest of what a symbol layer needs to paint one.
assert.equal(out.members.features[2].properties.help, true, 'Cy asked for help');
assert.equal(out.members.features[0].properties.help, false);
assert.equal(out.members.features[0].properties.name, 'Ada');
assert.equal(out.members.features[0].properties.initials, 'AD');
assert.equal(out.members.features[0].properties.colour, '#2E7D32');
assert.equal(out.members.features[0].properties.kit, 'first-aid');
assert.equal(out.members.features[0].properties.place, 'Rivertown');
assert.equal(out.members.features[1].properties.place, null);

// A member who has never reported: age is unbounded, but the feature still has
// to survive JSON, so the unbounded age is null rather than Infinity.
const never = overlayGeoJson(
  { members: [{ id: 'm_ever', name: 'Ever', lat: 39.34, lng: -84.269 }] },
  { now: NOW },
);
assert.equal(never.members.features[0].properties.stale, true, 'no fix is stale');
assert.equal(never.members.features[0].properties.ageMs, null, 'an unbounded age is null, not Infinity');

// --------------------------------------------------------------------- route

// One line, not one per leg: the route is a single geometry so a line layer can
// dash and case it in one pass.
assert.equal(out.route.features.length, 1);
const line = out.route.features[0];
assert.equal(line.geometry.type, 'LineString');
// Five points, four legs.
assert.equal(line.geometry.coordinates.length, 5);
assert.equal(line.properties.legs, 4, 'five points make four legs');
assert.equal(line.geometry.coordinates.length, line.properties.legs + 1);

// route.points are [lat, lng]; the line is [lng, lat].
assert.deepEqual(line.geometry.coordinates[0], [-84.269, 39.34]);
assert.deepEqual(line.geometry.coordinates[4], [-84.265, 39.3425]);

// How far along the party is: which leg, how much walked, how much left, and
// the fraction a progress style would interpolate on. 240 of 600 m is 0.4.
assert.equal(line.properties.leg, 1);
assert.equal(line.properties.travelledMetres, 240);
assert.equal(line.properties.remainingMetres, 360);
assert.equal(line.properties.fraction, 0.4);
assert.equal(line.properties.metres, 600);
assert.equal(line.properties.mode, 'path');
assert.equal(line.properties.via, 'Coney Mall');
assert.equal(line.properties.arrived, false);

// No progress yet — the route still draws, and nothing pretends to know how
// far along anyone is.
const unstarted = overlayGeoJson({ route: ROUTE }, { now: NOW });
assert.equal(unstarted.route.features.length, 1);
assert.equal(unstarted.route.features[0].properties.leg, null);
assert.equal(unstarted.route.features[0].properties.fraction, null);

// A one-point line is not a LineString. Emit nothing rather than something
// MapLibre will reject at load.
assert.equal(overlayGeoJson({ route: { points: [[39.34, -84.269]] } }, { now: NOW }).route.features.length, 0);
assert.equal(
  overlayGeoJson({ route: { points: [[39.34, -84.269], [null, -84.268]] } }, { now: NOW }).route.features.length,
  0,
  'a route whose only other point is broken has no line left',
);

// --------------------------------------------------------------------- marks

// The quest Mark was left at a Place and carries no fix of its own, so it
// borrows the Place's. The orphan Mark names a Place this venue does not have.
assert.equal(out.marks.features.length, 1, 'the unresolvable Mark is dropped');
assert.equal(out.marks.features[0].id, 'mk_quest');
assert.deepEqual(out.marks.features[0].geometry.coordinates, [-84.264865, 39.344465]);
assert.equal(out.marks.features[0].properties.type, 'sign');
assert.equal(out.marks.features[0].properties.phrase, 'Meet by the gate');
assert.equal(out.marks.features[0].properties.placeId, 'adventure-express');
assert.equal(out.marks.features[0].properties.opacity, 0.6);

// ---------------------------------------------------------------------- pins

// Points somebody chose rather than Places the park has: the Rally Point, the
// car, a tapped spot, and Overlay's own pins — one source, told apart by kind.
assert.deepEqual(
  out.pins.features.map((f) => f.id),
  ['meet', 'car', 'op_shortcut'],
);
assert.deepEqual(
  out.pins.features.map((f) => f.properties.kind),
  ['meet', 'car', 'path'],
);
assert.deepEqual(out.pins.features[0].geometry.coordinates, [-84.2645, 39.3435]);
assert.equal(out.pins.features[0].properties.label, 'Rally Point');
assert.deepEqual(out.pins.features[1].geometry.coordinates, [-84.273, 39.337]);
assert.deepEqual(out.pins.features[2].geometry.coordinates, [-84.2675, 39.3402]);
assert.equal(out.pins.features[2].properties.label, 'Shortcut');

// A Rally Point with a broken coordinate is the same failure as a broken
// member: drop it. A pin at null island is worse than no pin.
assert.equal(
  overlayGeoJson({ meet: { lat: 39.3435, lng: null, label: 'Rally Point' } }, { now: NOW }).pins.features.length,
  0,
);

// -------------------------------------------------------------------- places

assert.deepEqual(
  out.places.features.map((f) => f.id),
  ['adventure-express', 'antique-photos'],
);
assert.deepEqual(out.places.features[0].geometry.coordinates, [-84.264865, 39.344465]);
assert.equal(out.places.features[0].properties.name, 'Adventure Express');
assert.equal(out.places.features[0].properties.category, 'coaster');
assert.equal(out.places.features[0].properties.land, 'Adventure Port');

// ------------------------------------------------------------------ contract

// Same input, same answer — including the ids. MapLibre's feature-state (hover,
// selection) is keyed on the id, so an id that is regenerated per call throws
// away the selection on every position tick.
const again = overlayGeoJson(MODEL, { now: NOW });
assert.deepEqual(again, out, 'two calls on one input agree exactly');
for (const name of OVERLAY_LAYERS) {
  assert.deepEqual(
    again[name].features.map((f) => f.id),
    out[name].features.map((f) => f.id),
    `${name} ids are stable across calls`,
  );
}

// MapLibre's geojson source is handed this over a structured clone or a URL.
// Infinity, NaN and undefined all survive a deepEqual against themselves and
// none of them survives JSON, so the round trip is the assertion.
assert.deepEqual(JSON.parse(JSON.stringify(out)), out, 'every collection survives JSON');

// The id is also a property, because a geojson source only exposes an id to
// feature-state through promoteId, which reads a property.
for (const name of OVERLAY_LAYERS) {
  for (const f of out[name].features) {
    assert.equal(f.properties.id, f.id, `${name} mirrors its id into properties`);
  }
}

// An empty model still answers with all five, so the sources can be created
// before a party exists.
const empty = overlayGeoJson(null, { now: NOW });
assert.deepEqual(Object.keys(empty).sort(), ['marks', 'members', 'pins', 'places', 'route']);
for (const name of OVERLAY_LAYERS) assert.equal(empty[name].features.length, 0);

// The clock is an argument, never a read. A caller that forgets it would
// otherwise get whatever Date.now() said, and staleness would stop being
// reproducible.
assert.throws(() => overlayGeoJson(MODEL), /now/i);
assert.throws(() => overlayGeoJson(MODEL, { now: null }), /now/i);
assert.throws(() => overlayGeoJson(MODEL, { now: Number.NaN }), /now/i);

console.log('overlay-geo: ok');
