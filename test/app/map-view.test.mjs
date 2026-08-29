#!/usr/bin/env node
/* The map view seam (docs/train-h-seams.md seam 2).
 *
 * A caller mounts a view over a renderer and then speaks in Truth: a camera in
 * lng/lat and zoom, an overlay of Members and routes as data, a screen point to
 * hit-test. What a renderer draws, and which Zoom bands it draws it from, is
 * behind the seam — so this suite drives the seam with a recording stand-in
 * renderer and asserts on what crosses, which is the whole contract.
 *
 * Band expectations are the ones ADR-0021 fixes and test/app/band-plan derives
 * from the projection: at latitude 39.3422 a screen pixel covers 3.694648 m at
 * z14, 1.847324 m at z15 and 0.461831 m at z17, against a table of overview
 * 2.4 / mid 0.6 / close 0.15 m/px. They are not re-derived by running the
 * module under test.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountMapView } from '../../apps/party-tracker/lib/mapView.js';
import { closestPlaceId } from '../../apps/party-tracker/lib/mapViewMaplibre.js';
import { OVERLAY_LAYERS, overlayGeoJson } from '../../apps/party-tracker/lib/overlayGeo.js';
import { WORLD_LAYERS, worldGeoJson } from '../../apps/party-tracker/lib/worldGeo.js';
import {
  boundsOfPoints,
  cameraRequest,
  FOLLOW_RESUME_MS,
  followShouldResume,
  overlayModel,
  parkMapPalettes,
  worldFor,
  worldWithLandTints,
} from '../../apps/party-tracker/lib/parkMapView.js';
import {
  OVERLAY_SOURCES,
  PLACES_LAYER,
  bandedWorldStyle,
  worldCaseLayer,
  worldLayer,
  worldSource,
} from '../../apps/party-tracker/lib/mapViewStyle.js';

/** kings-island's latitude, centred so the World's own mid-latitude is the
 *  39.3422 the band arithmetic above was worked out at. */
const WORLD = Object.freeze({
  id: 'kings-island',
  bounds: Object.freeze({ west: -84.2801, south: 39.3334, east: -84.2555, north: 39.3510 }),
});

const PLACES = Object.freeze([
  Object.freeze({ i: 'beast', n: 'The Beast', c: 'ride', lat: 39.3441, lng: -84.2688 }),
  Object.freeze({ i: 'diamondback', n: 'Diamondback', c: 'ride', lat: 39.3402, lng: -84.2661 }),
]);

/** A renderer that draws nothing and remembers everything. */
function recordingRenderer(overrides = {}) {
  const calls = [];
  return {
    calls,
    attach(container, view) { calls.push({ call: 'attach', container, view }); },
    camera(camera) { calls.push({ call: 'camera', camera }); },
    paint(plan) { calls.push({ call: 'paint', plan }); },
    overlay(model) { calls.push({ call: 'overlay', model }); },
    world(geometry) { calls.push({ call: 'world', geometry }); },
    pick(point) { calls.push({ call: 'pick', point }); return null; },
    detach() { calls.push({ call: 'detach' }); },
    ...overrides,
  };
}

const CONTAINER = { nodeName: 'DIV' };

const mount = (opts = {}) =>
  mountMapView(CONTAINER, {
    renderer: recordingRenderer(),
    world: WORLD,
    skin: 'watercolor-quest',
    places: PLACES,
    camera: { center: { lng: -84.2678, lat: 39.3422 }, zoom: 15 },
    ...opts,
  });

// ---------------------------------------------------------------------------
// The renderer contract. A renderer that cannot answer the whole interface is
// caught at mount, by name, rather than at the first camera move.
// ---------------------------------------------------------------------------

const partial = recordingRenderer();
delete partial.pick;
assert.throws(
  () => mount({ renderer: partial }),
  /renderer.*pick/i,
  'a renderer missing pick() is refused at mount, naming the method',
);

assert.throws(() => mount({ renderer: null }), /renderer/i, 'no renderer at all is refused');

// ---------------------------------------------------------------------------
// Mounting. The renderer is handed one complete view — the World it draws, the
// Skin it wears, the camera, and the bands to paint — so a renderer that has to
// be constructed around a camera (MapLibre is) never has to invent one.
// ---------------------------------------------------------------------------

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });

  assert.equal(renderer.calls.length, 1, 'mount attaches once and does nothing else');
  const [attached] = renderer.calls;
  assert.equal(attached.call, 'attach');
  assert.equal(attached.container, CONTAINER, 'the renderer is attached to the caller container');
  assert.equal(attached.view.world, WORLD, 'the World crosses whole');
  assert.equal(attached.view.skin, 'watercolor-quest');

  // Places cross as positions, because a renderer that cannot see where a
  // Place is cannot draw a pin on it or answer a tap. What it does not get is
  // the authority to say what a Place *is* — hitTest answers from Truth below.
  assert.deepEqual(attached.view.places, PLACES, 'the Places of this venue cross as data');
  assert.throws(
    () => { attached.view.places.push({ i: 'invented' }); },
    TypeError,
    'and frozen, because the Visual factory never writes truth',
  );

  // z15 sits below the pitch ease's start (15.0224 at this latitude), so the
  // camera is flat. The caller never said so: pitch is the seam's to derive.
  assert.deepEqual(
    attached.view.camera,
    { center: { lng: -84.2678, lat: 39.3422 }, zoom: 15, pitch: 0, bearing: 0, ease: null },
    'the renderer gets a complete camera, with pitch and bearing filled in',
  );
  assert.equal(typeof attached.view.pitchAt, 'function', 'the pitch curve crosses so a pinch can tilt without setPitch');
  assert.equal(attached.view.pitchAt(15), 0, 'and it is the same curve the camera already used');

  // A phone that has only opened the venue pack holds the mid band and nothing
  // else (ADR-0021 clause 5 makes it the offline floor), so that is the default
  // the seam plans against. World LOD is the same plan: z15 is 1.847324 m/px
  // here, 0.54 px/m, below the SVG detail enter of 0.7 — buildings stay off.
  const PARK_WIDE_LOD = { detail: false, service: false, close: false };
  assert.deepEqual(
    attached.view.plan,
    { primary: 'mid', placeholder: null, primaryReady: true, draw: ['mid'], worldLod: PARK_WIDE_LOD },
    'the mid band is what a freshly-mounted view paints',
  );

  // The same two, readable back — what a HUD or a perf trace asks for.
  assert.deepEqual(view.state().camera, attached.view.camera);
  assert.deepEqual(view.state().plan, attached.view.plan);
}

// ---------------------------------------------------------------------------
// Moving the camera. The caller says where and how close; the tilt is the
// seam's to derive, from a curve staged clear of every band handoff.
// ---------------------------------------------------------------------------

/** Tolerance for a pitch read off the smoothstep — 1e-9 is far tighter than
 *  any transcription of the curve would land, and loose enough for a libm
 *  whose cos or log2 rounds the last bit differently. */
const near = (got, want, what) =>
  assert.ok(Math.abs(got - want) < 1e-9, `${what}: expected ${want}, got ${got}`);

const CENTRE = { lng: -84.2678, lat: 39.3422 };

/* The ease sits inside the gap between the two handoffs (14.6224026087 and
   16.6224026087), inset by the shared curve's 0.4 margin: 15.0224026087 to
   16.2224026087. Its midpoint is 15.6224026087, where smoothstep(0.5) is 0.5. */
const EASE_MIDPOINT = 15.622402608729476;

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  view.setCamera({ center: CENTRE, zoom: EASE_MIDPOINT });
  const moved = renderer.calls.find((c) => c.call === 'camera');
  assert.ok(moved, 'setCamera reaches the renderer');
  near(moved.camera.pitch, 22.5, 'half way through the ease is half the tilt');
  assert.equal(moved.camera.ease, null, 'setCamera jumps — the eased variant is its own call');
  near(view.state().camera.pitch, 22.5, 'and the view remembers where the camera got to');

  // Past the end of the ease the world is fully tilted, which is the state
  // every close-band zoom is seen in (ADR-0021 clause 4 stages it that way).
  view.setCamera({ center: CENTRE, zoom: 16.5 });
  near(view.state().camera.pitch, 45, 'the ease finishes before the mid->close handoff');
}

// A Skin's declared camera feel is a mount-time trait, not a per-frame argument.
{
  const renderer = recordingRenderer();
  const gentle = mount({ maxPitch: 30, renderer });
  const [attached] = renderer.calls;
  near(attached.view.pitchAt(EASE_MIDPOINT), 15, 'pitchAt carries the Skin\'s maxPitch');
  gentle.setCamera({ center: CENTRE, zoom: EASE_MIDPOINT });
  near(gentle.state().camera.pitch, 15, 'a gentler Skin eases to its own maximum');
  gentle.setCamera({ center: CENTRE, zoom: 16.5 });
  near(gentle.state().camera.pitch, 30, 'and tops out there');
}

// A renderer is also where camera moves come *from*: gestures happen inside it,
// and a caller that hears about one hands it straight back through setCamera.
// So a camera that has not moved is not a move — without that, one pinch is an
// unbounded echo between the two sides of the seam.
{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  view.setCamera({ center: { ...CENTRE }, zoom: 15 });
  assert.deepEqual(renderer.calls, [], 'the camera it is already at is not a move');

  view.setCamera({ center: CENTRE, zoom: 15.0001 });
  assert.equal(renderer.calls.length, 1, 'a tenth of a thousandth of a zoom is');

  // A twist on the spot changes nothing but the way up, so it is the one move
  // the echo guard could swallow whole without any other assertion noticing.
  view.setCamera({ center: CENTRE, zoom: 15.0001, bearing: 90 });
  const turned = renderer.calls.filter((c) => c.call === 'camera');
  assert.equal(turned.length, 2, 'a turn at the same place and zoom is a move too');
  assert.equal(turned[1].camera.bearing, 90, 'and it is the turn that reaches the renderer');
}

// A caller that sets pitch itself can land a tilt and a band handoff in the
// same instant, which is exactly what ADR-0021 clause 4 staged the ease to
// avoid. Refused, and told where the knob actually is.
{
  const view = mount();
  assert.throws(
    () => view.setCamera({ center: CENTRE, zoom: 16, pitch: 40 }),
    /pitch/i,
    'an explicit pitch is refused rather than quietly ignored',
  );
  // Bearing is a guest gesture, not a derived curve, so it does cross.
  view.setCamera({ center: CENTRE, zoom: 16, bearing: 90 });
  assert.equal(view.state().camera.bearing, 90, 'bearing is a gesture, so it crosses as given');
}

// Numbers that cannot reach a live map.setZoom() without breaking it.
{
  const view = mount();
  assert.throws(() => view.setCamera({ center: CENTRE, zoom: 'close' }), /zoom/i);
  assert.throws(() => view.setCamera({ center: CENTRE, zoom: NaN }), /zoom/i);
  assert.throws(() => view.setCamera({ center: { lng: -84.2, lat: null }, zoom: 16 }), /cent(re|er)/i);
  assert.throws(() => view.setCamera({ zoom: 16 }), /cent(re|er)/i);
}

// ---------------------------------------------------------------------------
// The band chooser underneath. A camera move is a paint only when it changes
// what there is to paint — every other move is a camera call and nothing else.
// ---------------------------------------------------------------------------

const paints = (renderer) => renderer.calls.filter((c) => c.call === 'paint');

{
  // A view that opens already past the SVG detail enter must remember that.
  // z15.3 is 0.67 px/m here: below enter (0.7) and above leave (0.62). If
  // lodShown stayed at the pre-mount zeros, the first zoom-out would hide
  // buildings one step earlier than a pinch that earned them.
  const renderer = recordingRenderer();
  const view = mount({
    renderer,
    camera: { center: CENTRE, zoom: 17 },
    available: ['mid', 'close'],
  });
  assert.deepEqual(view.state().plan.worldLod, {
    detail: true,
    service: true,
    close: true,
  });
  renderer.calls.length = 0;
  view.setCamera({ center: CENTRE, zoom: 15.3 });
  assert.equal(
    paints(renderer)[0].plan.worldLod.detail,
    true,
    'hysteresis keeps detail after a walking-zoom open',
  );
}

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  // Still inside mid's range and below the SVG detail enter (~z15.37 at this
  // latitude): the same bands and the same world LOD, so nothing to restyle.
  view.setCamera({ center: CENTRE, zoom: 15.2 });
  assert.equal(paints(renderer).length, 0, 'a move inside one band does not repaint');

  // Panning half a park at a fixed zoom must not restyle the world either —
  // the handoffs are placed at the World's latitude, not the camera's.
  view.setCamera({ center: { lng: -84.2801, lat: 39.3334 }, zoom: 15.2 });
  assert.equal(paints(renderer).length, 0, 'panning at a fixed zoom does not repaint');
  assert.equal(
    renderer.calls.filter((c) => c.call === 'camera').length,
    2,
    'both moves still reached the renderer as camera moves',
  );

  // Crossing the SVG detail enter restyles world layers without leaving mid.
  // z15.5 is 1.306 m/px here → 0.77 px/m, past 0.7 and short of service 1.4.
  view.setCamera({ center: CENTRE, zoom: 15.5 });
  assert.equal(paints(renderer).length, 1, 'crossing a world-LOD threshold repaints');
  assert.deepEqual(paints(renderer)[0].plan, {
    primary: 'mid',
    placeholder: null,
    primaryReady: true,
    draw: ['mid'],
    worldLod: { detail: true, service: false, close: false },
  });

  // Past the mid->close handoff the camera wants a band this phone has not
  // streamed yet, so the plan changes even though the placeholder stays mid
  // (ADR-0021 clause 4). z17 is 0.462 m/px → 2.17 px/m: every LOD group on.
  view.setCamera({ center: CENTRE, zoom: 17 });
  assert.equal(paints(renderer).length, 2, 'crossing a handoff repaints exactly once');
  assert.deepEqual(paints(renderer)[1].plan, {
    primary: 'close',
    placeholder: 'mid',
    primaryReady: false,
    draw: ['mid'],
    worldLod: { detail: true, service: true, close: true },
  });

  // The close band arrives from the network. Same camera, new plan: close on
  // top, mid still held underneath for the crossfade.
  view.setAvailableBands(['mid', 'close']);
  assert.equal(paints(renderer).length, 3, 'a band arriving repaints');
  assert.deepEqual(paints(renderer)[2].plan, {
    primary: 'close',
    placeholder: 'mid',
    primaryReady: true,
    draw: ['mid', 'close'],
    worldLod: { detail: true, service: true, close: true },
  });
  assert.deepEqual(view.state().plan, paints(renderer)[2].plan);

  // Told the same thing twice, it does not repaint.
  view.setAvailableBands(['close', 'mid']);
  assert.equal(paints(renderer).length, 3, 'the same held bands in another order are the same set');
}

// A band set the chooser refuses is refused whole. mount() validates before it
// attaches a renderer for the same reason: a view that half-adopted a bad set
// would carry it into every later frame, so one typo from the cache would brick
// the map for the rest of the session rather than for one call.
{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  const before = view.state().plan;
  assert.throws(() => view.setAvailableBands(['midd']), /unknown band/i,
    'a typo in the arriving bands is refused, as it is at mount');
  assert.deepEqual(view.state().plan, before, 'and the plan it could not use is not adopted');
  assert.deepEqual(renderer.calls, [], 'nothing reached the renderer');

  // Still a working view: the bands it holds are the ones it held before.
  view.setCamera({ center: CENTRE, zoom: 17 });
  assert.deepEqual(paints(renderer)[0].plan, {
    primary: 'close',
    placeholder: 'mid',
    primaryReady: false,
    draw: ['mid'],
    worldLod: { detail: true, service: true, close: true },
  }, 'a later camera move still plans against the bands it actually holds');

  view.setAvailableBands(['mid', 'close']);
  assert.equal(view.state().plan.primaryReady, true, 'and a good set still lands after a bad one');
}

// The eased variant of a camera move. Same plan, same derivation — the caller
// is only saying "take your time getting there".
{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;
  view.easeCamera({ center: CENTRE, zoom: 16.5 }, { durationMs: 600 });
  const [moved] = renderer.calls.filter((c) => c.call === 'camera');
  assert.deepEqual(moved.camera.ease, { durationMs: 600 }, 'the ease crosses as data too');
  near(moved.camera.pitch, 45, 'and the pitch comes off the same curve, eased or not');

  // A duration a renderer cannot animate over is refused here rather than
  // handed on: MapLibre reads a zero or a NaN duration as "no argument" and
  // jumps, which is the tilt-and-restyle-at-once the ease exists to avoid.
  renderer.calls.length = 0;
  for (const bad of [0, -100, NaN, '600', undefined]) {
    assert.throws(
      () => view.easeCamera({ center: CENTRE, zoom: 16 }, { durationMs: bad }),
      /durationMs/i,
      `an ease of ${String(bad)}ms is refused`,
    );
  }
  assert.throws(() => view.easeCamera({ center: CENTRE, zoom: 16 }), /durationMs/i,
    'and so is an ease with no duration at all');
  assert.deepEqual(renderer.calls, [], 'none of them moved the camera');
}

// ---------------------------------------------------------------------------
// The Overlay (ADR-0019 clause 4, ported in slice h11). Members, Marks, the
// pins somebody placed and the route cross as Truth — GeoJSON in lng/lat, one
// FeatureCollection per source — and the renderer decides only how they look.
//
// The collections come from lib/overlayGeo.js, which is now the *one* place
// the app's model becomes map data: ParkMap.jsx used to project the same rows
// a second time by hand into SVG, and two projections of one Truth is how a
// party dot and a route end up disagreeing about where a Member is.
// ---------------------------------------------------------------------------

const NOW = Date.UTC(2026, 7, 22, 15, 0, 0);
const OVERLAY = overlayGeoJson(
  {
    members: [{ id: 'm1', lat: 39.3441, lng: -84.2688, name: 'Dad', ts: NOW - 30000 }],
    pois: PLACES,
    meet: { lat: 39.3402, lng: -84.2661, label: 'Gate' },
    route: { points: [[39.3441, -84.2688], [39.3402, -84.2661]] },
  },
  { now: NOW },
);

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  view.setOverlay(OVERLAY);
  const [sent] = renderer.calls.filter((c) => c.call === 'overlay');
  assert.ok(sent, 'the overlay reaches the renderer');

  // All five, every time. A MapLibre geojson source is fed with setData once
  // it exists, so a collection that vanished when its list emptied would leave
  // the last frame's Members on screen with nothing left to clear them — which
  // is why a caller sending only what changed still gets all five out.
  assert.deepEqual(Object.keys(sent.model).sort(), [...OVERLAY_LAYERS].sort());
  view.setOverlay({ members: OVERLAY.members });
  const partialSend = renderer.calls.filter((c) => c.call === 'overlay').at(-1);
  assert.deepEqual(Object.keys(partialSend.model).sort(), [...OVERLAY_LAYERS].sort());
  assert.deepEqual(partialSend.model.places.features, [], 'and the ones left out arrive empty');
  assert.deepEqual(sent.model.members.features[0].geometry.coordinates, [-84.2688, 39.3441]);

  // A Member's name or staleness is style the renderer needs; it rides along
  // untouched. What it must never be handed is a decision already made for it.
  assert.equal(sent.model.members.features[0].properties.name, 'Dad', 'style hints ride along');
  assert.equal(sent.model.route.features[0].geometry.type, 'LineString');
  assert.equal(sent.model.places.features.length, PLACES.length, 'Places ride the same path');

  // The Visual factory restyles and never writes truth, so the renderer gets a
  // frozen view of the Overlay rather than the caller's own arrays.
  assert.notEqual(sent.model.members, OVERLAY.members, 'the renderer gets a copy');
  assert.throws(() => { sent.model.members.features.push({}); }, TypeError, 'a frozen list');
  assert.throws(() => { sent.model.members.features[0].id = 'x'; }, TypeError, 'and frozen features');
}

{
  const map = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/kings-island.map.json', import.meta.url)),
  );
  const base = worldFor(map);
  const tinted = worldWithLandTints(base, 'watercolor-quest', {
    Rivertown: { fill: '#C5BEAC', stroke: '#908779', label: '#2C2416' },
  });
  const renderer = recordingRenderer();
  const view = mount({ renderer, skin: 'watercolor-quest' });
  renderer.calls.length = 0;

  view.setWorldGeometry(tinted.geometry);
  const [sent] = renderer.calls.filter((c) => c.call === 'world');
  assert.ok(sent, 'Zone tone updates reach the renderer after mount');
  assert.equal(
    sent.geometry.lands.features.find((f) => f.properties?.name === 'Rivertown')?.properties?.tint,
    '#C5BEAC',
    'the lands source carries the Visual factory tint',
  );
}

// A draw call is not data. This is the one the seam exists for: hand it a
// function and the renderer would be deciding what a Member's dot means.
{
  const view = mount();
  const one = (properties) => ({
    members: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'm1',
        geometry: { type: 'Point', coordinates: [-84.2, 39.3] },
        properties,
      }],
    },
  });
  assert.throws(
    () => view.setOverlay(one({ draw: () => {} })),
    /draw call|function/i,
    'a function on a feature is refused',
  );
  assert.throws(
    () => view.setOverlay({ members: [], render: () => {} }),
    /draw call|function|unknown/i,
    'and so is one at the top level',
  );

  // Positions come from Truth. A feature carrying screen or art coordinates is
  // how an Overlay gets snapped to painted art, which ADR-0021 clause 3
  // forbids outright — at 0.15 m/px a metre of drift is seven pixels of blue
  // line crossing painted lawn, and guests trust their eyes over the route.
  assert.throws(
    () => view.setOverlay(one({ x: 120, y: 240 })),
    /screen|truth/i,
    'a feature with screen coordinates is refused',
  );
}

{
  const view = mount();
  const at = (coordinates, id = 'm1') => ({
    members: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id, geometry: { type: 'Point', coordinates }, properties: {} }],
    },
  });
  assert.throws(() => view.setOverlay(at([-84.2])), /position|lng|lat/i, 'half a position is not one');
  // The GeoJSON mistake this app is most exposed to: every position in its own
  // prose is `{lat, lng}`, and a geometry handed one of those is not geometry.
  assert.throws(
    () => view.setOverlay(at({ lng: -84.2, lat: 39.3 })),
    /is not a position/,
    'a {lng, lat} object is not a GeoJSON position',
  );
  assert.throws(() => view.setOverlay(at(['-84.2', 39.3])), /position|lng|lat/i, 'nor a stringified one');
  assert.throws(() => view.setOverlay(at([-84.2, 91])), /position|lat/i, 'nor one past the pole');
  assert.throws(
    () => view.setOverlay({
      route: {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          id: 'route',
          geometry: { type: 'LineString', coordinates: [[-84.2, 39.3], [-84.2, null]] },
          properties: {},
        }],
      },
    }),
    /position|lng|lat/i,
    'a route vertex is held to the same rule as a dot',
  );

  /* Only a Point or a LineString crosses. A Polygon is not a thing the Overlay
     draws — Members, Marks, pins and Places are dots and a route is a line —
     and a geometry whose positions are nested one level deeper than the
     checker expects would walk straight past every position guard above and
     reach MapLibre unvalidated. So the type is refused rather than skipped. */
  const shaped = (geometry) => ({
    members: {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'm1', geometry, properties: {} }],
    },
  });
  assert.throws(
    () => view.setOverlay(shaped({
      type: 'Polygon',
      coordinates: [[[-84.2, 39.3], [-84.1, 39.3], [-84.1, 39.4], [-84.2, 39.3]]],
    })),
    /Point or a LineString/i,
    'a Polygon is not an Overlay geometry, and is refused rather than waved through',
  );
  assert.throws(
    () => view.setOverlay(shaped({ type: 'MultiPoint', coordinates: [[-84.2, 39.3]] })),
    /Point or a LineString/i,
    'nor is any other GeoJSON type',
  );
  assert.throws(
    () => view.setOverlay(shaped(undefined)),
    /Point or a LineString/i,
    'and a feature with no geometry at all is the same refusal',
  );

  /* Ids have to be unique inside a collection, and that is the guard rather
     than "every feature has one". `overlayGeo` answers null for a mark nobody
     named, and a Party with two unnamed Members is an ordinary Party — but two
     features sharing an id is how MapLibre's feature-state lights the wrong
     dot, which reads as a Member teleporting. */
  const twin = (id) => ({ type: 'Feature', id, geometry: { type: 'Point', coordinates: [-84.2, 39.3] }, properties: {} });
  assert.throws(
    () => view.setOverlay({ members: { type: 'FeatureCollection', features: [twin('m1'), twin('m1')] } }),
    /id/i,
    'two features cannot share an id',
  );
  assert.doesNotThrow(
    () => view.setOverlay({ members: { type: 'FeatureCollection', features: [twin(null), twin(null)] } }),
    'but two unnamed Members are a Party, not an error',
  );

  assert.throws(
    () => view.setOverlay({ members: [], layers: [] }),
    /unknown|layers/i,
    'an unrecognised collection is refused rather than silently dropped',
  );
  assert.throws(
    () => view.setOverlay({ members: { type: 'Feature', features: [] } }),
    /FeatureCollection/i,
    'and a collection that is not one says so',
  );
}

// ---------------------------------------------------------------------------
// Hit testing. The renderer knows where a pixel is; only the seam knows what a
// Place is. So the renderer answers with an id and the Place comes back from
// Truth — a renderer can never hand a caller a Place the venue does not have.
// ---------------------------------------------------------------------------

{
  const renderer = recordingRenderer({ pick: () => 'beast' });
  const view = mount({ renderer });
  const hit = view.hitTest({ x: 120, y: 240 });
  assert.equal(hit, PLACES[0], 'the Place comes back from the venue, not from the renderer');
}

{
  const picked = [];
  const view = mount({
    renderer: recordingRenderer({ pick: (point) => { picked.push(point); return null; } }),
  });
  assert.equal(view.hitTest({ x: 1, y: 2 }), null, 'a tap on painted lawn hits no Place');
  assert.deepEqual(picked, [{ x: 1, y: 2 }], 'the screen point is handed to the renderer to resolve');
}

{
  const view = mount({ renderer: recordingRenderer({ pick: () => 'ghost-coaster' }) });
  assert.throws(
    () => view.hitTest({ x: 1, y: 2 }),
    /ghost-coaster/,
    'a renderer that picks a Place this World has not got is a bug, not a null',
  );
}

{
  const view = mount();
  assert.throws(() => view.hitTest({ x: 1 }), /point/i, 'a screen point needs both coordinates');
  assert.throws(() => view.hitTest({ x: NaN, y: 2 }), /point/i);
}

// ---------------------------------------------------------------------------
// Lifecycle. A React effect tears down on every remount, sometimes twice, and
// sometimes after the caller has already stopped caring.
// ---------------------------------------------------------------------------

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  view.destroy();
  assert.equal(renderer.calls.filter((c) => c.call === 'detach').length, 1, 'destroy detaches');
  view.destroy();
  assert.equal(
    renderer.calls.filter((c) => c.call === 'detach').length,
    1,
    'and destroying twice detaches once — a torn-down WebGL context is not re-torn',
  );

  // Anything else after that is a caller still holding a handle it let go of.
  // Saying so beats a call quietly reaching a dead renderer.
  assert.throws(() => view.setCamera({ center: CENTRE, zoom: 16 }), /destroyed/i);
  assert.throws(() => view.setOverlay(OVERLAY), /destroyed/i);
  assert.throws(() => view.hitTest({ x: 1, y: 2 }), /destroyed/i);
  assert.throws(() => view.setAvailableBands(['mid']), /destroyed/i);
  assert.equal(
    renderer.calls.filter((c) => c.call !== 'attach' && c.call !== 'detach').length,
    0,
    'and none of them reached the renderer',
  );

  // state() is the deliberate exception, and it is deliberate enough to pin.
  // A React render can outlive the effect that tore the renderer down, and
  // where the camera got to is a fact about the session rather than about the
  // GL context — so reading it after destroy must NOT throw. Without this,
  // adding assertAlive() to state() looks like consistency and silently breaks
  // the render path the exception exists for.
  const after = view.state();
  assert.equal(after.camera.zoom, 15, 'state() survives destroy and still reports the last camera');
  assert.ok(after.plan, 'and still reports the last band plan');

  // The plan handed out is frozen. It is derived per frame and shared with
  // whoever asked; a caller that mutated it would change what the next
  // comparison sees, and the repaint dedup would then skip a real change.
  assert.throws(() => { after.plan.bands = []; }, TypeError, 'the band plan is frozen');
}

// ---------------------------------------------------------------------------
// What a World has to bring. Each of these is caught at mount, before a
// renderer has been handed anything, because every one of them is a state the
// view would otherwise fail in later and further away.
// ---------------------------------------------------------------------------

assert.throws(
  () => mount({ world: { id: 'nowhere' } }),
  /bounds/i,
  'a World with no bounds has no latitude, and band handoffs move with latitude',
);

assert.throws(
  () => mountMapView(CONTAINER, { renderer: recordingRenderer(), world: WORLD }),
  /camera/i,
  'a view opens somewhere: there is no default camera to fall back on',
);

assert.throws(
  () => mount({ available: ['midd'] }),
  /unknown band/i,
  'a typo in the held bands is caught at mount, not at the first pinch',
);

{
  const renderer = recordingRenderer();
  assert.throws(
    () => mount({ renderer, places: [{ n: 'The Beast', lat: 39.3441, lng: -84.2688 }] }),
    /place/i,
    'a Place with no id could never be the answer to a hit test',
  );
  assert.deepEqual(renderer.calls, [], 'and the renderer was never attached to a view that failed');
}

// A World with no Places at all is ordinary — a venue mid-build, or a Skin
// preview — and hit-tests to nothing rather than refusing to mount.
{
  const view = mount({ places: [], renderer: recordingRenderer({ pick: () => null }) });
  assert.equal(view.hitTest({ x: 1, y: 2 }), null);
}

// ---------------------------------------------------------------------------
// The style a banded World draws through. This is where a band plan becomes
// something a GL renderer can act on, so it is the one part of the MapLibre
// adapter worth holding to assertions: the rest is imperative glue.
// ---------------------------------------------------------------------------

// One source per collection `overlayGeo` answers with, derived from that list
// rather than restated, so adding a collection there cannot leave a source
// uncreated here.
assert.deepEqual(
  Object.keys(OVERLAY_SOURCES).sort(),
  [...OVERLAY_LAYERS].sort(),
  'a source per overlay collection, named by the adapter that fills it',
);

const BANDED_WORLD = {
  ...WORLD,
  bands: {
    mid: { image: '/venues/kings-island/display/watercolor-quest.world.png' },
    close: { image: '/venues/kings-island/display/watercolor-quest.close.png' },
  },
};

{
  const style = bandedWorldStyle({ world: BANDED_WORLD });
  const { west, south, east, north } = WORLD.bounds;

  // ADR-0016's image-on-truth-bounds contract, in the corner order MapLibre
  // takes: clockwise from top-left.
  assert.deepEqual(style.sources['band-mid'], {
    type: 'image',
    url: BANDED_WORLD.bands.mid.image,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
  });

  // Coarsest first, so a finer band paints over the placeholder held beneath
  // it without anything having to reorder layers mid-pinch (ADR-0021 clause
  // 4). The shared table's order is what decides it, not this file's.
  const bandLayers = style.layers.filter((l) => l.id.startsWith('band-')).map((l) => l.id);
  assert.deepEqual(bandLayers, ['band-mid', 'band-close']);

  // Every band starts hidden: which of them is drawn is the band plan's
  // answer, and it arrives through paint() rather than through the style.
  for (const layer of style.layers.filter((l) => l.id.startsWith('band-'))) {
    assert.equal(layer.layout.visibility, 'none', `${layer.id} starts hidden`);
  }

  // The overlay's sources exist from the start and start empty, so a Member
  // arriving is a setData rather than a restyle.
  for (const name of OVERLAY_LAYERS) {
    const id = OVERLAY_SOURCES[name];
    assert.equal(style.sources[id].type, 'geojson', `${id} is a geojson source`);
    assert.deepEqual(style.sources[id].data.features, [], `${id} starts empty`);
    assert.ok(
      style.layers.some((l) => l.source === id),
      `${id} has something drawing it — a source with no layer is data nobody sees`,
    );
  }

  /* The layer a tap is resolved against is a layer this style actually builds.
     `mapViewMaplibre.pick` queries MapLibre by that id and answers null when
     the map has no layer with it, so a constant naming nothing is a map where
     no tap ever selects a Place — silent in the app, and invisible to every
     test that stubs `pick` on a stand-in renderer. */
  const placesLayer = style.layers.find((l) => l.id === PLACES_LAYER);
  assert.ok(placesLayer, `PLACES_LAYER is ${PLACES_LAYER}, which no layer in the style is called`);
  assert.equal(
    placesLayer.source,
    OVERLAY_SOURCES.places,
    'and the layer it names is the one drawing the Places collection',
  );

  // The live Overlay is never painted under the art. ADR-0021 clause 3 keeps
  // the route drawn from Truth rather than snapped to the band beneath it, and
  // a route the painted world covers is the same failure seen from above.
  const topBand = style.layers.findLastIndex((l) => l.id.startsWith('band-'));
  for (const name of OVERLAY_LAYERS) {
    const first = style.layers.findIndex((l) => l.source === OVERLAY_SOURCES[name]);
    assert.ok(first > topBand, `${name} draws over every band, not under one`);
  }
}

// A World that declares a band it has no bytes for gets no layer for it —
// a source pointing at nothing is a 404 per tile, not a placeholder.
{
  const style = bandedWorldStyle({ world: { ...BANDED_WORLD, bands: { mid: BANDED_WORLD.bands.mid } } });
  assert.deepEqual(
    style.layers.filter((l) => l.id.startsWith('band-')).map((l) => l.id),
    ['band-mid'],
  );
}

assert.throws(
  () => bandedWorldStyle({ world: { ...WORLD, bands: {} } }),
  /nothing to draw/i,
  'a World with neither band imagery nor geometry has nothing to draw, and says so',
);

// ---------------------------------------------------------------------------
// The World's static geometry, as GeoJSON (slice h11). `lib/worldGeo.js` is
// the base-map half of the SVG retirement — what ParkMapSvg.jsx's `<path
// d="M…">` soup becomes once MapLibre is the renderer. Its sibling
// `overlayGeo.js` does the same for the live Overlay, and the two share one
// discipline: a coordinate that is not two finite numbers is *dropped*, never
// defaulted to zero.
// ---------------------------------------------------------------------------

const layerIds = WORLD_LAYERS.map((l) => l.id);
const layerAt = (id) => layerIds.indexOf(id);

/* The table *is* the paint order, and it is the order ParkMapStaticWorld
   painted its <g> groups in. Getting it wrong does not error — it buries the
   midway under the lake, which is the kind of bug only an eye catches. */
assert.equal(layerIds[0], 'sea', 'the sea is the bottom of the world');
assert.ok(layerAt('water') < layerAt('path'), 'a path crosses water, not the other way round');
assert.ok(layerAt('path') < layerAt('building'), 'buildings sit on the midway');
assert.ok(layerAt('building') < layerAt('coaster'), 'coaster track flies over the buildings');
assert.ok(layerAt('park') < layerAt('lands'), 'districts tint the park, so they go over it');

// Every layer says which geometry it makes, because a ring drawn as a line and
// a ring drawn as a polygon have different validity rules below.
for (const layer of WORLD_LAYERS) {
  assert.ok(['polygon', 'line'].includes(layer.geometry), `${layer.id} declares its geometry`);
}
assert.equal(WORLD_LAYERS.find((l) => l.id === 'path').geometry, 'line');
assert.equal(WORLD_LAYERS.find((l) => l.id === 'building').geometry, 'polygon');

/* A square of park with a lake in it, one walkway across, and a boundary ring
   — the smallest venue that exercises every rule. Coordinates are [lng, lat],
   which is how map.json already stores them and how GeoJSON wants them. */
const SQUARE = [[-84.28, 39.333], [-84.255, 39.333], [-84.255, 39.351], [-84.28, 39.351]];
const LAKE = [[-84.27, 39.34], [-84.265, 39.34], [-84.265, 39.345], [-84.27, 39.345]];
const WALKWAY = [[-84.279, 39.334], [-84.268, 39.341], [-84.256, 39.35]];

const tiny = worldGeoJson({
  meta: { id: 'kings-island' },
  landAnchors: {},
  park: [{ r: SQUARE, n: 'Kings Island' }],
  lands: [{ r: LAKE, n: 'Coney Mall' }],
  water: [{ r: LAKE }],
  path: [{ r: WALKWAY }],
  boundary: SQUARE,
});

// One source per layer, always all of them — the rule overlayGeo.js keeps for
// the same reason: a key that vanished when its list emptied would leave the
// previous frame's geometry on screen with nothing left to clear it.
assert.deepEqual(Object.keys(tiny).sort(), [...layerIds].sort(), 'every layer, present or not');
for (const id of layerIds) {
  assert.equal(tiny[id].type, 'FeatureCollection', `${id} is a FeatureCollection`);
}
assert.deepEqual(tiny.sea.features, [], 'a layer this venue has none of is empty, not missing');

// map.json carries more than geometry. `meta` and `landAnchors` are not layers
// and must not become sources.
assert.equal(tiny.meta, undefined);
assert.equal(tiny.landAnchors, undefined);

{
  const [lake] = tiny.water.features;
  assert.equal(lake.geometry.type, 'Polygon');
  // A GeoJSON linear ring is closed: the last position repeats the first.
  // map.json does not store the repeat, so this has to add it — an open ring
  // is invalid GeoJSON and MapLibre answers it with a style error.
  const ring = lake.geometry.coordinates[0];
  assert.deepEqual(ring[ring.length - 1], ring[0], 'the ring closes');
  assert.equal(ring.length, LAKE.length + 1, 'closed by repeating the first position, not by more');
  // Straight through, lng first: map.json is already in GeoJSON's order, so a
  // swap here would be a bug introduced rather than one inherited.
  assert.deepEqual(ring.slice(0, LAKE.length), LAKE);
}

// A ring that already closes is not closed twice — a duplicated final position
// is a zero-length segment, which is what makes a fill's outline flicker.
{
  const closed = [...LAKE, LAKE[0]];
  const [f] = worldGeoJson({ water: [{ r: closed }] }).water.features;
  assert.equal(f.geometry.coordinates[0].length, closed.length, 'an already-closed ring is left alone');
}

// Three distinct corners is the least a polygon can be. Two is a line with a
// fill rule, which MapLibre renders as nothing and reports as nothing.
assert.deepEqual(
  worldGeoJson({ water: [{ r: [[-84.27, 39.34], [-84.265, 39.34]] }] }).water.features,
  [],
  'a two-point polygon is dropped',
);

{
  const [walk] = tiny.path.features;
  assert.equal(walk.geometry.type, 'LineString');
  assert.deepEqual(walk.geometry.coordinates, WALKWAY, 'no closing position on a line');
}
assert.deepEqual(
  worldGeoJson({ path: [{ r: [[-84.27, 39.34]] }] }).path.features,
  [],
  'a one-point line is dropped',
);

/* The rule overlayGeo.js states and worldGeo.js inherits: a coordinate that is
   not two finite numbers is dropped rather than defaulted. `p[0] || 0` lands
   the vertex on the prime meridian, which for a ring is worse than for a point
   — it reads as a lake with a spike through it reaching the Gulf of Guinea.
   And the whole ring goes, not the one vertex: deleting a corner silently
   reshapes the polygon into a different, plausible, wrong one. */
assert.deepEqual(
  worldGeoJson({
    water: [{ r: [[-84.27, 39.34], [-84.265, null], [-84.265, 39.345], [-84.27, 39.345]] }],
  }).water.features,
  [],
  'one bad vertex drops the whole ring',
);
assert.deepEqual(
  worldGeoJson({ path: [{ r: [['-84.27', '39.34'], [-84.265, 39.34]] }] }).path.features,
  [],
  'a stringified ordinate is not an ordinate',
);
// Zero is a real coordinate off the coast of Ghana, so the finite test must not
// be a truthiness test.
assert.equal(
  worldGeoJson({ path: [{ r: [[0, 0], [0.001, 0.001]] }] }).path.features.length,
  1,
  'a venue on the equator still draws',
);

/* Off the planet. MapLibre wraps a longitude past 180 rather than complaining
   and clamps a latitude past its Mercator limit, so an ordinate that is not on
   Earth draws a plausible-looking ghost somewhere else instead of an error.
   This catches only the pairs that leave the planet — a lat/lng written the
   wrong way round inside range lands in Antarctica and no structural check can
   see it, which is why the pass-through above is pinned instead. */
assert.deepEqual(
  worldGeoJson({ path: [{ r: [[-84.27, 91], [-84.26, 92]] }] }).path.features,
  [],
  'a latitude past the pole is not a latitude',
);
assert.deepEqual(
  worldGeoJson({ path: [{ r: [[181, 39.34], [182, 39.35]] }] }).path.features,
  [],
  'a longitude past 180 is not on Earth',
);

/* `boundary` is the one layer map.json stores as a bare ring rather than as a
   list of rows, and ParkMapSvg.jsx wrapped it by hand at the call site.
   Reading it wrong turns one park outline into four two-element "rings". */
assert.equal(tiny.boundary.features.length, 1, 'one bare ring is one feature, not one per corner');
assert.equal(tiny.boundary.features[0].geometry.type, 'Polygon');
assert.deepEqual(tiny.boundary.features[0].geometry.coordinates[0].slice(0, 4), SQUARE);

{
  const [park] = tiny.park.features;
  assert.equal(park.properties.name, 'Kings Island', 'a named ring keeps its name');
  assert.equal(tiny.water.features[0].properties.name, null, 'an unnamed one says so rather than undefined');
  // Identified, so a style can address one ring and feature-state can light it.
  assert.ok(park.id != null, 'every feature is identified');
  assert.equal(park.properties.id, park.id, 'and the id is reachable from a filter expression');
  assert.equal(park.properties.layer, 'park', 'the layer rides along, so one source could serve many');
}

// A World with no geometry at all draws nothing — not a crash. `map.json` is
// fetched over the network and can arrive late.
{
  const nothing = worldGeoJson(null);
  assert.deepEqual(Object.keys(nothing).sort(), [...layerIds].sort());
  for (const id of layerIds) assert.deepEqual(nothing[id].features, [], `${id} empty`);
}

// ---------------------------------------------------------------------------
// The vector tier (slice h11). ADR-0019's consequences keep it "the never-fails
// fallback under every Skin": Truth geometry, no baked band, no network. That
// is what a World with no display pack draws, and it is what a band that has
// not streamed in yet is showing through.
// ---------------------------------------------------------------------------

const GEOMETRY = worldGeoJson({
  park: [{ r: [[-84.28, 39.333], [-84.255, 39.333], [-84.255, 39.351], [-84.28, 39.351]] }],
  water: [{ r: [[-84.27, 39.34], [-84.265, 39.34], [-84.265, 39.345], [-84.27, 39.345]] }],
  path: [{ r: [[-84.279, 39.334], [-84.268, 39.341], [-84.256, 39.35]] }],
});

{
  // No bands at all, and it still draws — the baked art is the improvement,
  // not the requirement.
  const style = bandedWorldStyle({ world: { ...WORLD, geometry: GEOMETRY } });
  assert.deepEqual(style.layers.filter((l) => l.id.startsWith('band-')), []);
  assert.equal(style.sources[worldSource('park')].type, 'geojson');
  assert.equal(
    style.sources[worldSource('park')].data.features.length,
    1,
    'the geometry is seeded into the style rather than waiting on a setData',
  );

  // A layer only for what this World has any of: drawing nothing still costs a
  // layer per frame, and most venues never fill most of the fourteen. The
  // source is created anyway, so geometry arriving late has somewhere to land
  // rather than needing a restyle.
  assert.ok(style.layers.some((l) => l.id === worldLayer('path')));
  assert.ok(!style.layers.some((l) => l.id === worldLayer('coaster')), 'no coaster, no coaster layer');
  assert.deepEqual(
    style.sources[worldSource('coaster')],
    { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    'and its source is there and empty, waiting for a setData',
  );

  // Bottom to top in WORLD_LAYERS' own order, which is the order the SVG
  // renderer painted its groups in. Reordering does not error — it buries the
  // midway under the lake.
  const drawn = WORLD_LAYERS.map((l) => l.id).filter((id) => style.layers.some((l) => l.id === worldLayer(id)));
  const inStyle = style.layers.filter((l) => l.id.startsWith('world-') && !l.id.endsWith('-case'))
    .map((l) => l.id.replace('world-', ''));
  assert.deepEqual(inStyle, drawn, 'the world paints in the table order');

  // A walkway needs its casing under it — one line drawn wide in the ground
  // colour, then the path over it — or a midway crossing a lawn has no edge.
  const path = style.layers.findIndex((l) => l.id === worldLayer('path'));
  const casing = style.layers.findIndex((l) => l.id === worldCaseLayer('path'));
  assert.ok(casing >= 0 && casing < path, 'the path casing is drawn first, under the path');
}

{
  // Painted bands sit over the vector tier: the vector tier is the fallback,
  // and a fallback drawn on top of the thing it stands in for is not one.
  const style = bandedWorldStyle({ world: { ...BANDED_WORLD, geometry: GEOMETRY } });
  const topWorld = style.layers.findLastIndex((l) => l.id.startsWith('world-'));
  const firstBand = style.layers.findIndex((l) => l.id.startsWith('band-'));
  assert.ok(firstBand > topWorld, 'the baked band paints over the vector tier it improves on');
}

// A Skin restyles and never repositions (CONTEXT: Visual factory). The paint
// pack is the Skin's own — the same one the SVG renderer read — so switching
// Skins is a colour change and never a geometry change.
{
  const skinned = bandedWorldStyle({
    world: { ...WORLD, geometry: GEOMETRY },
    palette: { ground: '#101010', waterFill: '#004080', path: { stroke: '#ffcc00', width: 3, casing: '#101010', casingWidth: 6 } },
  });
  const layerFor = (id) => skinned.layers.find((l) => l.id === worldLayer(id));
  assert.equal(layerFor('water').paint['fill-color'], '#004080', "the Skin's water is the water drawn");
  assert.equal(layerFor('path').paint['line-color'], '#ffcc00');
  /* The Skin's own width leads the zoom ramp rather than being replaced by
     it: at walking scale the midway is exactly the 3px this Skin asked for,
     and the wide end is a proportion of that. A Skin that draws a wider
     midway still gets a wider midway — it just thins out on the way out. */
  {
    const width = layerFor('path').paint['line-width'];
    assert.ok(Array.isArray(width) && width[0] === 'interpolate', 'the midway ramps with zoom');
    const at = (zoom) => {
      const stops = width.slice(3);
      for (let i = 0; i < stops.length; i += 2) if (stops[i] === zoom) return stops[i + 1];
      return null;
    };
    assert.equal(at(16), 3, "the Skin's width is the walking-scale width");
    assert.ok(at(12) < 3, 'and it is thinner when the whole park is on screen');
  }
  assert.equal(skinned.layers.find((l) => l.id === 'bg').paint['background-color'], '#101010');

  const plain = bandedWorldStyle({ world: { ...WORLD, geometry: GEOMETRY } });
  assert.deepEqual(
    plain.layers.map((l) => l.id),
    skinned.layers.map((l) => l.id),
    'and a Skin changes what is painted, never which layers exist',
  );
}

/* A change of renderer, not of look — the Overlay half. The block above pins
   the World's paint against the Skin's pack; the live Overlay's colours, the
   stale fade and the casing under the route are just as much "what the SVG
   renderer drew", and every one of them can be deleted with a green suite
   unless something here says otherwise. */
{
  const style = bandedWorldStyle({
    world: { ...WORLD, geometry: GEOMETRY },
    palette: {
      member: '#00ff99', route: '#ff00aa', place: '#123456', mark: '#abcdef', pin: '#654321',
    },
  });
  const layerFor = (id) => style.layers.find((l) => l.id === id);

  // Every live thing wears the Skin's own colour for it, not one this file
  // chose. A party dot painted a hardcoded purple under a daylight Skin is the
  // renderer deciding what a Member looks like, which is the seam's whole point.
  assert.equal(
    layerFor(OVERLAY_SOURCES.members).paint['circle-color'],
    '#00ff99',
    'a Member is painted the Skin s member colour',
  );
  assert.equal(layerFor(OVERLAY_SOURCES.route).paint['line-color'], '#ff00aa');
  assert.equal(layerFor(OVERLAY_SOURCES.places).paint['circle-color'], '#123456');
  assert.equal(layerFor(OVERLAY_SOURCES.places).paint['circle-opacity'], 0, 'MapLibre places are hit targets; SVG draws the pin');
  assert.equal(layerFor(OVERLAY_SOURCES.marks).paint['circle-color'], '#abcdef');
  assert.equal(layerFor(OVERLAY_SOURCES.pins).paint['circle-color'], '#654321');

  /* A stale fix is drawn faded rather than dropped: where someone was is worth
     more than nothing, and Location keeps the last-known fix marked stale
     rather than hiding it. `coalesce` inside the `case` because a `case`
     handed a missing property is a style error, and a style error is a layer
     that draws nothing — the whole Party gone rather than one dot dimmed. */
  assert.deepEqual(
    layerFor(OVERLAY_SOURCES.members).paint['circle-opacity'],
    ['case', ['coalesce', ['get', 'stale'], false], 0.45, 1],
    'a stale Member dims, and one with no `stale` property still draws',
  );

  // An unused Mark fades; the Contribution it celebrates does not. The opacity
  // is the Mark's own property, so the fade is Truth's answer rather than a
  // timer the renderer keeps.
  assert.deepEqual(
    layerFor(OVERLAY_SOURCES.marks).paint['circle-opacity'],
    ['coalesce', ['get', 'opacity'], 1],
  );

  /* The route's casing, the same decision the path casing makes one tier down:
     a bright line over bright painted art has no edge, and a route a guest
     cannot pick out of the midway is a route they do not follow. */
  const route = layerFor(OVERLAY_SOURCES.route);
  const casing = layerFor(`${OVERLAY_SOURCES.route}-case`);
  assert.ok(casing, 'the route is drawn over a casing');
  assert.equal(casing.source, OVERLAY_SOURCES.route, 'from the route s own geometry');
  assert.ok(
    casing.paint['line-width'] > route.paint['line-width'],
    `a casing is the wider of the two, and is ${casing.paint['line-width']} under ${route.paint['line-width']}`,
  );
  assert.ok(
    style.layers.indexOf(casing) < style.layers.indexOf(route),
    'and is drawn first, under the route rather than over it',
  );

  /* `lineMetrics` on every Overlay source. The walked-vs-remaining split of a
     running route is a line-gradient over the route's own `fraction`, and
     MapLibre refuses a line-gradient on a source without it — so dropping the
     flag does not warn, it silently stops the split from ever drawing. One
     flag across all five beats five source shapes; it is harmless on points. */
  for (const name of OVERLAY_LAYERS) {
    assert.equal(
      style.sources[OVERLAY_SOURCES[name]].lineMetrics,
      true,
      `${name}'s source carries lineMetrics, which the route gradient needs`,
    );
  }
}

// ---------------------------------------------------------------------------
// The caller side (slice h11). ParkMap.jsx turns what the app knows into what
// this seam takes. That shaping is the part of a React component most worth
// asserting and the part hardest to reach through one, so it lives in
// lib/parkMapView.js and the component only calls it.
// ---------------------------------------------------------------------------

const MAP_JSON = {
  meta: { id: 'kings-island', bounds: WORLD.bounds },
  path: [{ r: [[-84.279, 39.334], [-84.268, 39.341]] }],
};

{
  const shaped = worldFor(MAP_JSON);
  assert.equal(shaped.id, 'kings-island');
  assert.equal(shaped.bounds, WORLD.bounds, 'the venue keeps its own truth bounds');
  assert.equal(shaped.geometry.path.features.length, 1, 'and arrives with its geometry');

  // Each of these is a World the ported renderer cannot open on, so it says so
  // rather than framing a camera on a guess — the caller falls back.
  assert.equal(worldFor(null), null, 'map.json has not arrived yet');
  assert.equal(worldFor({ path: [] }), null, 'no meta at all');
  assert.equal(worldFor({ meta: { id: 'x' } }), null, 'no bounds');
  assert.equal(
    worldFor({ meta: { id: 'x', bounds: { west: 1, east: 1, south: 2, north: 2 } } }),
    null,
    'a box of no ground has no camera that frames it',
  );
}

{
  const withLands = {
    meta: { id: 'kings-island', bounds: WORLD.bounds },
    lands: [{ r: [[-84.279, 39.334], [-84.268, 39.341], [-84.270, 39.350]], n: 'Rivertown' }],
  };
  const tinted = worldWithLandTints(worldFor(withLands), 'watercolor-quest', {
    Rivertown: { fill: '#C6BCAF', stroke: '#908779', label: '#2C2416' },
  });
  assert.equal(tinted.geometry.lands.features[0].properties.tint, '#C6BCAF');
  const generated = worldWithLandTints(worldFor(withLands), 'day', null);
  assert.match(generated.geometry.lands.features[0].properties.tint, /^hsl\(/);
}

{
  // Framing a whole route while a guest is deciding. Points are [lat, lng],
  // which is how routing.js writes them and the reverse of the box.
  assert.deepEqual(
    boundsOfPoints([[39.3441, -84.2688], [39.3402, -84.2661], [39.3420, -84.2700]]),
    { west: -84.27, south: 39.3402, east: -84.2661, north: 39.3441 },
  );
  // A point that is not a place is skipped rather than stretching the box to
  // the Gulf of Guinea — the same rule overlayGeo keeps.
  assert.deepEqual(
    boundsOfPoints([[39.3441, -84.2688], [null, -84.2], [39.3402, -84.2661]]),
    { west: -84.2688, south: 39.3402, east: -84.2661, north: 39.3441 },
  );
  assert.equal(boundsOfPoints([]), null, 'nothing to frame');
  assert.equal(boundsOfPoints(null), null);
  assert.equal(boundsOfPoints([[39.3441, -84.2688]]), null, 'one point is a place, not a box');
}

{
  const base = { members: [{ id: 'm1', lat: 39.34, lng: -84.26, ts: NOW }], pois: PLACES };
  // This phone's own Member is a Member, not a second kind of dot.
  const withMe = overlayModel({ ...base, me: { lat: 39.3441, lng: -84.2688 } }, { now: NOW });
  assert.equal(withMe.members.length, 2);
  assert.equal(withMe.members[1].id, 'me', 'and is identified, so it can be told it moved');
  assert.equal(withMe.members[1].self, true, 'the map key treats this phone as the pulsing self mark');
  assert.equal(withMe.members[1].ts, NOW, 'a fix with no clock on it is this one, not a stale one');

  const named = overlayModel(
    { ...base, me: { id: 'phone-a', lat: 39.3441, lng: -84.2688 } },
    { now: NOW },
  );
  assert.equal(named.members[1].id, 'phone-a');
  assert.equal(named.members[1].self, true, 'a session id must not drop the self mark');

  // While a route runs, the snapped puck is where this phone is — the same
  // choice Follow makes, so the dot and the camera cannot disagree.
  const walking = overlayModel(
    { ...base, me: { lat: 39.3441, lng: -84.2688 }, puck: { lat: 39.3450, lng: -84.2690 } },
    { now: NOW },
  );
  assert.equal(walking.members.length, 2);
  assert.equal(walking.members[1].lat, 39.3450, 'the puck, not the raw fix');

  const alone = overlayModel(base, { now: NOW });
  assert.equal(alone.members.length, 1, 'a phone with no fix adds no dot for itself');
  assert.equal(alone.pois, PLACES, 'Places cross untouched');
}

{
  const anchor = { lat: 39.3441, lng: -84.2688 };
  const focus = { lat: 39.3402, lng: -84.2661 };

  // Follow outranks a focus request: a guest walking somewhere has already said
  // what they are looking at.
  const following = cameraRequest({ follow: true, anchor, focusPoint: focus });
  assert.deepEqual(following.center, { lng: -84.2688, lat: 39.3441 });
  assert.equal(following.easeMs, 480, 'a glide, because a fix lands every few seconds');
  assert.ok(following.deadbandMetres > 0, 'and a deadband, because GPS jitters in place');

  assert.deepEqual(cameraRequest({ follow: true, anchor: null, focusPoint: focus }).center, {
    lng: -84.2661, lat: 39.3402,
  }, 'Follow with nowhere to follow to is not Follow');

  /* The camera stays where the guest left it — driven by the arguments page.js
     actually hands ParkMap once somebody has panned, not by an empty object.
     Follow is off (onUserPan cleared it), a fix has just landed, and nothing
     is focused. The World's centre is where the map *opens* — ParkMapGl frames
     the truth bounds at mount — so nothing here may move the camera. It
     re-centring on the park would undo the pan within seconds, and with
     nothing chased there is no ease, so it would land as a jump.

     `center` is passed deliberately, though ParkMap no longer sends it. That
     key is the bug: page.js hands page-level `venue.center` down on every
     render, cameraRequest used to fold it in, and every GPS fix threw the
     guest back to the park. Keeping it here says the parameter is ignored
     rather than merely absent, so re-adding it upstream cannot quietly bring
     the jump back. Dropping the key would make this pass for the weaker
     reason. */
  const panned = cameraRequest({
    follow: false,
    anchor: { lat: 39.3441, lng: -84.2688 },
    focusPoint: null,
    center: { lat: 39.3422, lng: -84.2678 },
    fit: null,
    scale: null,
    bearing: 0,
    lift: 0,
  });
  assert.equal(panned.center, null, 'a fix with Follow off does not re-centre the park');
  assert.equal(panned.easeMs, null, 'and gets there by not moving');

  // Framing a route is a statement about the whole route, so it outranks both
  // a centre and a closeness.
  const fit = { west: -84.27, south: 39.34, east: -84.26, north: 39.345 };
  const framing = cameraRequest({ fit, focusPoint: anchor, scale: 3 });
  assert.equal(framing.fit, fit);
  assert.equal(framing.center, null);
  assert.equal(framing.resolution, null);

  // Go's walking zoom, converted rather than re-chosen: the SVG renderer
  // counted pixels per metre, MapLibre counts ground per pixel, and three
  // pixels to the metre is a third of a metre to the pixel.
  assert.ok(Math.abs(cameraRequest({ scale: 3 }).resolution - 1 / 3) < 1e-12);
  assert.equal(cameraRequest({}).resolution, null, 'no walking zoom, no zoom change');

  // Course-up and the compass ride straight through.
  const going = cameraRequest({ follow: true, anchor, bearing: 217, lift: 0.2 });
  assert.equal(going.bearing, 217);
  assert.equal(going.lift, 0.2);
  assert.equal(cameraRequest({}).bearing, 0, 'north-up unless told otherwise');
  assert.equal(cameraRequest({}).lift, 0);

  /* Free look is a pause, not a new home. A gesture that is still fresh
     leaves the camera where the guest put it; once they have been still
     long enough, Follow comes back so the next request recentres them.
     Previewing a route is not free look — framing the walk is a statement
     about the walk. An explicit look-at has no gesture time, so the clock
     does not steal it. */
  assert.equal(followShouldResume({ gesturedAt: null, now: NOW }), false, 'no gesture is not a resume');
  assert.equal(
    followShouldResume({ gesturedAt: NOW - 400, now: NOW }),
    false,
    'a fresh pan is still free look',
  );
  assert.equal(
    followShouldResume({ gesturedAt: NOW - FOLLOW_RESUME_MS, now: NOW }),
    true,
    'after the pause, snap back to this phone',
  );
  assert.equal(
    followShouldResume({ gesturedAt: NOW - FOLLOW_RESUME_MS, now: NOW, previewing: true }),
    false,
    'framing a route is not free look',
  );
  assert.throws(
    () => followShouldResume({ gesturedAt: NOW, now: Number.NaN }),
    /finite `now`/,
    'must not read the clock itself',
  );
}

// ---------------------------------------------------------------------------
// End to end on a shipped World (slice h11). Everything above drives fixtures;
// this drives big-kahunas' own `map.json` and `pois.json` through the whole
// ported path — Truth in, a style and an Overlay a renderer could draw out —
// and asserts the run's output rather than that it did not throw.
// ---------------------------------------------------------------------------

const VENUES = new URL('../../apps/party-tracker/public/venues/', import.meta.url);
const read = (name) => JSON.parse(readFileSync(new URL(name, VENUES), 'utf8'));

{
  const map = read('big-kahunas.map.json');
  const venuePois = read('big-kahunas.pois.json');
  const bounds = map.meta.bounds;
  const geometry = worldGeoJson(map);

  // What this venue has, and what it has none of. Both matter: a layer built
  // for an empty source costs a draw per frame, and a layer missing for a full
  // one is geometry a guest never sees.
  const style = bandedWorldStyle({ world: { id: map.meta.id, bounds, geometry } });
  const built = new Set(style.layers.filter((l) => l.id.startsWith('world-')).map((l) => l.id));
  for (const id of ['path', 'building', 'water', 'grass', 'service', 'slide', 'pool', 'wood', 'park', 'boundary']) {
    assert.ok(built.has(worldLayer(id)), `big-kahunas has ${id}, so it is drawn`);
  }
  for (const id of ['sea', 'lands', 'parking', 'coaster']) {
    assert.ok(!built.has(worldLayer(id)), `big-kahunas has no ${id}, so nothing draws it`);
  }

  /* Every vertex inside the World it belongs to. This is the assertion that
     catches a swapped lat/lng or a dropped rebase: a projection bug does not
     throw, it draws the park somewhere else. The margin is a tenth of a degree
     because map.json's rings include roads running out past the boundary. */
  let vertices = 0;
  for (const { id } of WORLD_LAYERS) {
    for (const feature of geometry[id].features) {
      const rings = feature.geometry.type === 'Polygon'
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
      for (const ring of rings) {
        for (const [lng, lat] of ring) {
          vertices += 1;
          assert.ok(
            lng > bounds.west - 0.1 && lng < bounds.east + 0.1
              && lat > bounds.south - 0.1 && lat < bounds.north + 0.1,
            `${id} vertex [${lng}, ${lat}] is nowhere near ${map.meta.id}`,
          );
        }
      }
    }
  }
  assert.ok(vertices > 1000, `a real venue is thousands of vertices, got ${vertices}`);

  // Truth through the seam, as the component does it. `pois.json` is what a
  // guest taps, so a Place has to come back out of a pick by its own id.
  const renderer = recordingRenderer({ pick: () => venuePois[3].i });
  const view = mountMapView(CONTAINER, {
    renderer,
    world: { id: map.meta.id, bounds, geometry },
    places: venuePois,
    camera: { center: map.meta.center, zoom: 16 },
  });
  view.setOverlay(overlayGeoJson({ pois: venuePois, members: [] }, { now: NOW }));
  const drawn = renderer.calls.filter((c) => c.call === 'overlay').at(-1).model;
  assert.equal(drawn.places.features.length, venuePois.length, 'every Place crosses');
  assert.deepEqual(
    drawn.places.features[0].geometry.coordinates,
    [venuePois[0].lng, venuePois[0].lat],
    'lng first, and the Place is where pois.json says it is',
  );
  assert.equal(view.hitTest({ x: 10, y: 10 }), venuePois[3], 'a pick resolves to that Place');
  view.destroy();
}

{
  // The map key reads pin colours (`palette.categories.coaster`). The World
  // surface reads a Skin paint pack (`ground`, `path`). Those are not the
  // same object — handing mapPaint to MapLegend throws on first render
  // (`Cannot read properties of undefined (reading 'coaster')`).
  const { surface, pins } = parkMapPalettes('night');
  assert.ok(surface.ground, 'surface pack paints the World');
  assert.ok(pins.categories.coaster, 'pin palette names every category the key draws');
  assert.equal(surface.categories, undefined, 'mapPaint is not a pin palette');

  const tycoon = parkMapPalettes('pixel-tycoon');
  assert.ok(tycoon.surface.ground);
  assert.ok(tycoon.pins.categories.coaster);
}

{
  const features = [
    { geometry: { coordinates: [-84.27, 39.35] }, properties: { id: 'aruba-tuba' } },
    { geometry: { coordinates: [-84.26, 39.34] }, properties: { id: 'castaway-cove' } },
  ];
  const project = ({ lng, lat }) => ({ x: lng * -1, y: lat });
  assert.equal(
    closestPlaceId(features, { x: 84.27, y: 39.35 }, project),
    'aruba-tuba',
    'overlapping hits resolve to the nearer Place, not source order',
  );
  assert.equal(
    closestPlaceId(features, { x: 0, y: 0 }, project, 1),
    null,
    'a max distance rejects hits outside the slop budget',
  );
}

{
  const { worldLodGroups, worldLodVisibility } = await import('../../apps/party-tracker/lib/worldLod.js');
  const parkWide = worldLodGroups(0.25);
  assert.equal(parkWide.detail, false, 'buildings and track wait for a pinch');
  assert.equal(parkWide.service, false, 'service roads wait longer');
  assert.equal(parkWide.close, false, 'path casing and slides wait with detail');
  const mid = worldLodGroups(0.7);
  assert.equal(mid.detail, true);
  assert.equal(mid.close, false, 'close stroke waits until 0.85 even after detail enters');
  const walking = worldLodGroups(1.4);
  assert.equal(walking.detail, true);
  assert.equal(walking.service, true);
  assert.equal(walking.close, true);
  assert.equal(worldLodGroups(0.69).detail, false);
  assert.equal(worldLodGroups(0.62, { detail: true }).detail, true, 'hysteresis keeps detail across the boundary');
  assert.equal(worldLodGroups(0.61, { detail: true }).detail, false);

  const hidden = worldLodVisibility(parkWide);
  assert.equal(hidden.grass, false);
  assert.equal(hidden.building, false);
  assert.equal(hidden.service, false);
  assert.equal(hidden.slide, false);
  assert.equal(hidden['path-case'], false);
  const shown = worldLodVisibility(walking);
  assert.equal(shown.grass, true);
  assert.equal(shown.building, true);
  assert.equal(shown.service, true);
  assert.equal(shown.slide, true);
  assert.equal(shown['path-case'], true);

  /* Coaster track is in no LOD group, at either end. A layer this table does
     not name is never toggled, which is how it stays drawn at every zoom —
     the park-wide view of a coaster park has coasters in it. Quieting it at
     the wide end is paint's job (mapViewStyle.js ramps width and opacity),
     and `test/app/map-decisions.json` holds that. Asserted at both ends
     because "always drawn" is the decision, not "drawn at the zoom I
     happened to check". */
  assert.equal(hidden.coaster, undefined, 'track is not hidden at park-wide');
  assert.equal(shown.coaster, undefined, 'and is not toggled when walking either');

  /* A loaded bake takes the whole vector tier off screen — the Visual
     factory's image IS the map at that point, and Truth geometry drawn under
     it is work for nobody and a bleed risk through the bake's soft edges.
     Every layer, not just the ones the LOD table names. */
  const { worldTierVisibility } = await import('../../apps/party-tracker/lib/worldLod.js');
  const { WORLD_LAYERS: TIER } = await import('../../apps/party-tracker/lib/worldGeo.js');
  const baked = worldTierVisibility(walking, { covered: true });
  for (const { id } of TIER) assert.equal(baked[id], false, `${id} is hidden under a loaded bake`);
  assert.equal(baked['path-case'], false, 'including the midway casing');

  /* And ADR-0019's fallback survives: with no bake on screen the tier draws,
     so a pack that never downloads leaves a working map rather than an empty
     one. This is why the renderer asks isSourceLoaded rather than trusting a
     Skin's declaration. */
  const unbaked = worldTierVisibility(walking, { covered: false });
  assert.equal(unbaked.path, true, 'no bake on screen, so Truth still draws');
  assert.equal(unbaked.coaster, true);
  assert.equal(worldTierVisibility(parkWide, { covered: false }).grass, false, 'and zoom LOD still applies under it');

  const seam = readFileSync(new URL('../../apps/party-tracker/lib/mapView.js', import.meta.url), 'utf8');
  assert.match(seam, /worldLodGroups/, 'LOD groups live on the zoom seam, next to the band plan');
  const adapter = readFileSync(new URL('../../apps/party-tracker/lib/mapViewMaplibre.js', import.meta.url), 'utf8');
  assert.match(adapter, /plan\.worldLod/, 'the adapter paints the seam\'s LOD, it does not choose it');
  assert.match(adapter, /worldTierVisibility/, 'layer ids come from the lod table, not a second list');
  assert.doesNotMatch(adapter, /WORLD_LAYERS/, 'and the adapter does not enumerate the tier itself');
  assert.doesNotMatch(adapter, /worldLodGroups/, 'the adapter does not recompute groups mid-pinch');
}

console.log('map-view: ok');
