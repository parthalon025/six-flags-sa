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
import { mountMapView } from '../../apps/party-tracker/lib/mapView.js';
import {
  bandedWorldStyle,
  lineCollection,
  pointCollection,
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

  // A phone that has only opened the venue pack holds the mid band and nothing
  // else (ADR-0021 clause 5 makes it the offline floor), so that is the default
  // the seam plans against.
  assert.deepEqual(
    attached.view.plan,
    { primary: 'mid', placeholder: null, primaryReady: true, draw: ['mid'] },
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
  const gentle = mount({ maxPitch: 30 });
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
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  // Still inside mid's range: the same bands, so nothing to restyle.
  view.setCamera({ center: CENTRE, zoom: 15.4 });
  assert.equal(paints(renderer).length, 0, 'a move inside one band does not repaint');

  // Panning half a park at a fixed zoom must not restyle the world either —
  // the handoffs are placed at the World's latitude, not the camera's.
  view.setCamera({ center: { lng: -84.2801, lat: 39.3334 }, zoom: 15.4 });
  assert.equal(paints(renderer).length, 0, 'panning at a fixed zoom does not repaint');
  assert.equal(
    renderer.calls.filter((c) => c.call === 'camera').length,
    2,
    'both moves still reached the renderer as camera moves',
  );

  // Past the mid->close handoff the camera wants a band this phone has not
  // streamed yet, so the plan changes even though what gets drawn does not:
  // mid stays on screen as the placeholder underneath (ADR-0021 clause 4).
  view.setCamera({ center: CENTRE, zoom: 17 });
  assert.equal(paints(renderer).length, 1, 'crossing a handoff repaints exactly once');
  assert.deepEqual(paints(renderer)[0].plan, {
    primary: 'close',
    placeholder: 'mid',
    primaryReady: false,
    draw: ['mid'],
  });

  // The close band arrives from the network. Same camera, new plan: close on
  // top, mid still held underneath for the crossfade.
  view.setAvailableBands(['mid', 'close']);
  assert.equal(paints(renderer).length, 2, 'a band arriving repaints');
  assert.deepEqual(paints(renderer)[1].plan, {
    primary: 'close',
    placeholder: 'mid',
    primaryReady: true,
    draw: ['mid', 'close'],
  });
  assert.deepEqual(view.state().plan, paints(renderer)[1].plan);

  // Told the same thing twice, it does not repaint.
  view.setAvailableBands(['close', 'mid']);
  assert.equal(paints(renderer).length, 2, 'the same held bands in another order are the same set');
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
}

// ---------------------------------------------------------------------------
// The Overlay. Members, quest nodes and the route cross as Truth — positions in
// lng/lat — and the renderer decides only how they look.
// ---------------------------------------------------------------------------

const OVERLAY = {
  members: [{ id: 'm1', lng: -84.2688, lat: 39.3441, label: 'Dad', avatar: 'bear' }],
  nodes: [{ id: 'q7', lng: -84.2661, lat: 39.3402, kind: 'quest' }],
  route: [{ lng: -84.2688, lat: 39.3441 }, { lng: -84.2661, lat: 39.3402 }],
};

{
  const renderer = recordingRenderer();
  const view = mount({ renderer });
  renderer.calls.length = 0;

  view.setOverlay(OVERLAY);
  const [sent] = renderer.calls.filter((c) => c.call === 'overlay');
  assert.ok(sent, 'the overlay reaches the renderer');

  // A Member's colour or avatar is style the renderer needs; it rides along
  // untouched. What it must never be handed is a decision already made for it.
  assert.equal(sent.model.members[0].avatar, 'bear', 'style hints ride along');
  assert.deepEqual(sent.model, OVERLAY, 'as the same marks the caller handed over');

  // The Visual factory restyles and never writes truth, so the renderer gets a
  // frozen view of the Overlay rather than the caller's own array.
  assert.notEqual(sent.model.members, OVERLAY.members, 'the renderer gets a copy');
  assert.throws(() => { sent.model.members.push({ id: 'x' }); }, TypeError, 'a frozen list');
  assert.throws(() => { sent.model.members[0].lat = 0; }, TypeError, 'and frozen marks');
}

// A draw call is not data. This is the one the seam exists for: hand it a
// function and the renderer would be deciding what a Member's dot means.
{
  const view = mount();
  assert.throws(
    () => view.setOverlay({ members: [{ id: 'm1', lng: -84.2, lat: 39.3, draw: () => {} }] }),
    /draw call|function/i,
    'a function on a mark is refused',
  );
  assert.throws(
    () => view.setOverlay({ members: [], render: () => {} }),
    /draw call|function|unknown/i,
    'and so is one at the top level',
  );
}

// Positions come from Truth. A mark carrying screen or art coordinates is how
// an Overlay gets snapped to painted art, which ADR-0021 clause 3 forbids
// outright — at 0.15 m/px a metre of drift is seven pixels of blue line
// crossing painted lawn, and guests trust their eyes over the route.
{
  const view = mount();
  assert.throws(
    () => view.setOverlay({ members: [{ id: 'm1', lng: -84.2, lat: 39.3, x: 120, y: 240 }] }),
    /screen|lng|lat|truth/i,
    'a mark with screen coordinates is refused',
  );
  assert.throws(
    () => view.setOverlay({ members: [{ id: 'm1', lat: 39.3 }] }),
    /lng|lat/i,
    'and so is one with no position at all',
  );
  assert.throws(
    () => view.setOverlay({ members: [{ lng: -84.2, lat: 39.3 }] }),
    /id/i,
    'every mark is identified, so the renderer can be told the same one moved',
  );
  assert.throws(
    () => view.setOverlay({ route: [{ lng: -84.2, lat: 'north' }] }),
    /lng|lat|route/i,
    'a route point is held to the same rule',
  );
  assert.throws(
    () => view.setOverlay({ members: [], layers: [] }),
    /unknown|layers/i,
    'an unrecognised group is refused rather than silently dropped',
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
  for (const id of ['overlay-members', 'overlay-nodes', 'overlay-route', 'places']) {
    assert.equal(style.sources[id].type, 'geojson', `${id} is a geojson source`);
    assert.deepEqual(style.sources[id].data.features, [], `${id} starts empty`);
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
  /imagery/i,
  'a World with no band imagery at all has nothing to draw, and says so',
);

// GeoJSON is lng-then-lat and every position in this app is written lat-first
// in prose, so this is the one line where a Member ends up in the wrong
// hemisphere. Pinned.
{
  const [feature] = pointCollection([{ id: 'm1', lng: -84.2688, lat: 39.3441, avatar: 'bear' }]).features;
  assert.deepEqual(feature.geometry, { type: 'Point', coordinates: [-84.2688, 39.3441] });
  assert.equal(feature.properties.id, 'm1');
  assert.equal(feature.properties.avatar, 'bear', 'style hints reach the renderer');

  // A Place is identified by pois.json's `i`, an Overlay mark by `id`, and the
  // renderer should not have to know which it is holding.
  const [place] = pointCollection([{ i: 'beast', lng: -84.2688, lat: 39.3441 }]).features;
  assert.equal(place.properties.id, 'beast');

  // A Place carries nested rows — height rules, facts. MapLibre ships feature
  // properties to its worker, so they are left behind rather than serialised
  // onto every frame.
  const [rich] = pointCollection([
    { i: 'beast', lng: -84.2688, lat: 39.3441, h: { min: 48 }, tags: ['wood'] },
  ]).features;
  assert.deepEqual(Object.keys(rich.properties).sort(), ['i', 'id', 'lat', 'lng']);
}

{
  assert.deepEqual(
    lineCollection([{ lng: -84.2688, lat: 39.3441 }, { lng: -84.2661, lat: 39.3402 }]).features[0].geometry,
    { type: 'LineString', coordinates: [[-84.2688, 39.3441], [-84.2661, 39.3402]] },
  );
  // One point is not a line. A LineString of one coordinate is invalid GeoJSON
  // and MapLibre answers it with a style error rather than nothing drawn.
  assert.deepEqual(lineCollection([{ lng: -84.2688, lat: 39.3441 }]).features, []);
  assert.deepEqual(lineCollection([]).features, []);
}

console.log('map-view: ok');
