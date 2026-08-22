/**
 * The map view seam (docs/train-h-seams.md seam 2).
 *
 * A caller — a React component, a perf trace, a design review page — speaks to
 * a map in Truth: a camera in lng/lat and zoom, an Overlay of Members and
 * routes as data, a screen point to hit-test. Everything on the other side of
 * that sentence is a renderer's business: which engine draws, which Zoom bands
 * it draws from, how a band that has not arrived is stood in for, what pitch
 * the camera holds at this zoom.
 *
 * This module is that sentence. It sits over the band chooser (lib/bandPlan.js)
 * and the camera curve (packages/shared/mapCamera.js) and hands a renderer one
 * plan per frame, as data. Two things follow that are worth stating outright,
 * because they are the reason the seam is here rather than in the component:
 *
 *   The Overlay crosses as data, never as draw calls. ADR-0021 clause 1 says
 *   the paint carries no fact Truth does not have; if a caller could hand the
 *   renderer a draw call, the renderer would be deciding what a Member's dot
 *   *means*. It gets positions in lng/lat and decides only how they look —
 *   which is also what keeps clause 3 enforceable, since an Overlay that
 *   cannot carry a screen coordinate cannot be snapped to art. Since slice h11
 *   that data is `lib/overlayGeo.js`'s FeatureCollections rather than bare
 *   marks: GeoJSON is still Truth in lng/lat, still renderer-neutral, and it
 *   is now the *one* conversion — ParkMap.jsx used to project the same rows a
 *   second time by hand into SVG, and two projections of one Truth is how a
 *   party dot and the route it is walking end up disagreeing on screen.
 *
 *   Pitch is derived, never passed. ADR-0019 clause 2 makes pitch a function of
 *   zoom and ADR-0021 clause 4 stages that ease clear of every band handoff, so
 *   a caller that could set pitch could land a tilt and a restyle in the same
 *   instant. A Skin's declared camera feel enters at mount, as `maxPitch`,
 *   which is where a per-Skin trait belongs.
 *
 * No renderer import, no DOM, no fetch: the renderer arrives as an argument.
 * That is what lets this be driven from plain Node, and it is the same seam the
 * SVG map, the MapLibre map and ADR-0013's real-time PBR tier all sit behind.
 */
import { pitchForZoom } from '@party-tracker/shared/mapCamera.js';
import { bandDrawPlan } from './bandPlan.js';
import { OVERLAY_LAYERS } from './overlayGeo.js';

/** What a renderer must answer before it can be mounted. */
export const RENDERER_METHODS = Object.freeze([
  'attach',
  'camera',
  'paint',
  'overlay',
  'pick',
  'detach',
]);

/** The bands a phone holds before it has streamed anything: the venue pack's
 *  mid bake, which ADR-0021 clause 5 makes the offline floor. */
export const PACKED_BANDS = Object.freeze(['mid']);

function assertRenderer(renderer) {
  if (renderer == null || typeof renderer !== 'object') {
    throw new Error('a map view needs a renderer to draw through');
  }
  for (const name of RENDERER_METHODS) {
    if (typeof renderer[name] !== 'function') {
      throw new Error(`renderer is missing ${name}()`);
    }
  }
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The World's own mid-latitude, which is what the band handoffs are computed
 *  at rather than the camera's.
 *
 *  Mercator pixels cover less ground away from the equator, so band boundaries
 *  really do move with latitude — but across a park they move by nothing worth
 *  having: 5 km of north-south travel at kings-island shifts a handoff by about
 *  0.001 zoom levels. Reading the camera's latitude instead would buy that and
 *  cost the invariant that matters — that for one World a band handoff is a
 *  function of zoom alone, so panning at a fixed zoom can never restyle the
 *  world underneath a guest who did not ask for it. */
function worldLatitude(world) {
  const bounds = world?.bounds;
  if (!bounds || !finite(bounds.north) || !finite(bounds.south)) {
    throw new Error('world.bounds needs finite north and south to place its band handoffs');
  }
  return (bounds.north + bounds.south) / 2;
}

/** The Overlay's collections — `overlayGeo.js`'s own list, so a collection
 *  added there cannot arrive at a seam that does not know the name. A model
 *  with anything else in it is refused rather than partly drawn: an
 *  unrecognised key is either a typo or a caller trying to smuggle
 *  instructions past the seam, and both want saying out loud. */
export const OVERLAY_GROUPS = OVERLAY_LAYERS;

/** Keys that mean "I have already worked out where this goes on screen".
 *  ADR-0021 clause 3: the live overlay draws from Truth and is never snapped
 *  to art, so a position the seam cannot check against Truth cannot cross it. */
const SCREEN_KEYS = Object.freeze(['x', 'y', 'px', 'py', 'screen', 'point']);

/** A GeoJSON position, checked against Truth rather than trusted.
 *
 *  The range test is not belt-and-braces: MapLibre wraps a longitude past 180
 *  and clamps a latitude past its Mercator limit, so an ordinate that is not
 *  on Earth draws a plausible-looking mark somewhere else instead of failing. */
function assertPosition(position, where) {
  if (!Array.isArray(position)) {
    throw new Error(`${where} is not a position: overlay geometry is [lng, lat] in Truth`);
  }
  const [lng, lat] = position;
  if (!finite(lng) || !finite(lat)) {
    throw new Error(`${where} needs a finite lng and lat, and has ${JSON.stringify(position)}`);
  }
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
    throw new Error(`${where} is not a position on Earth: ${JSON.stringify(position)}`);
  }
}

function assertGeometry(geometry, where) {
  if (geometry?.type === 'Point') {
    assertPosition(geometry.coordinates, `${where}.coordinates`);
    return;
  }
  if (geometry?.type === 'LineString') {
    if (!Array.isArray(geometry.coordinates)) {
      throw new Error(`${where}.coordinates must be a list of positions`);
    }
    geometry.coordinates.forEach((p, i) => assertPosition(p, `${where}.coordinates[${i}]`));
    return;
  }
  throw new Error(`${where} must be a Point or a LineString, and is ${geometry?.type}`);
}

function frozenFeature(feature, where) {
  if (feature == null || typeof feature !== 'object' || Array.isArray(feature)) {
    throw new Error(`${where} must be a GeoJSON Feature`);
  }
  const properties = feature.properties ?? {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === 'function') {
      throw new Error(
        `${where}.properties.${key} is a function: the overlay crosses this seam as data, never `
          + 'as a draw call — the renderer decides how a mark looks, not what it means',
      );
    }
    if (SCREEN_KEYS.includes(key)) {
      throw new Error(
        `${where}.properties.${key} is a screen coordinate: overlay positions are Truth in `
          + 'lng/lat, never a place on the painted art (ADR-0021 clause 3)',
      );
    }
  }
  assertGeometry(feature.geometry, `${where}.geometry`);
  // A copy, not the caller's own object frozen in place: the seam checks what
  // crosses it, it does not reach back and change what the caller is holding.
  return Object.freeze({ ...feature });
}

function frozenCollection(collection, where) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error(`overlay ${where} must be a GeoJSON FeatureCollection`);
  }
  const seen = new Set();
  const features = collection.features.map((feature, i) => {
    const frozen = frozenFeature(feature, `${where}[${i}]`);
    /* Unique inside the collection, and that is the rule rather than "every
       feature has one". `overlayGeo` answers null for a mark nobody named and
       a Party with two unnamed Members is an ordinary Party — but two features
       sharing an id is how MapLibre's feature-state lights the wrong dot,
       which on a map of people reads as a Member teleporting. */
    if (frozen.id != null) {
      if (seen.has(frozen.id)) {
        throw new Error(`overlay ${where} has two features with id ${JSON.stringify(frozen.id)}`);
      }
      seen.add(frozen.id);
    }
    return frozen;
  });
  return Object.freeze({ type: 'FeatureCollection', features: Object.freeze(features) });
}

function normalizeOverlay(model) {
  if (model == null || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error(`an overlay is overlayGeoJson()'s answer: { ${OVERLAY_GROUPS.join(', ')} }`);
  }
  for (const key of Object.keys(model)) {
    if (!OVERLAY_GROUPS.includes(key)) {
      throw new Error(
        `unknown overlay collection: ${key}. The overlay crosses as data — `
          + `${OVERLAY_GROUPS.join(', ')} — never as draw calls or layers`,
      );
    }
  }
  return Object.freeze(
    Object.fromEntries(
      OVERLAY_GROUPS.map((name) => [
        name,
        frozenCollection(model[name] ?? { type: 'FeatureCollection', features: [] }, name),
      ]),
    ),
  );
}

export function mountMapView(
  container,
  { renderer, world, skin = null, palette = null, places = [], camera, available, maxPitch } = {},
) {
  assertRenderer(renderer);
  const latitude = worldLatitude(world);
  let held = [...(available ?? PACKED_BANDS)];

  const cameraFor = (next, ease = null) => {
    if (next == null || typeof next !== 'object') {
      throw new Error('a camera is { center: { lng, lat }, zoom } — a view opens somewhere');
    }
    const { center, zoom, bearing = 0, pitch } = next;
    if (pitch !== undefined) {
      throw new Error(
        'pitch is derived from zoom, not set: a tilt that can land on a band handoff is '
          + "what ADR-0021 clause 4 stages against. A Skin's camera feel is mountMapView({ maxPitch }).",
      );
    }
    if (!finite(zoom)) throw new Error(`camera zoom must be a finite number: ${zoom}`);
    if (!center || !finite(center.lng) || !finite(center.lat)) {
      throw new Error('camera centre must be a { lng, lat } of finite numbers');
    }
    if (!finite(bearing)) throw new Error(`camera bearing must be a finite number: ${bearing}`);
    return Object.freeze({
      center: Object.freeze({ lng: center.lng, lat: center.lat }),
      zoom,
      pitch: pitchForZoom(zoom, { latitude, ...(maxPitch == null ? {} : { maxPitch }) }),
      bearing,
      ease,
    });
  };

  const planFor = (zoom, bands = held) =>
    Object.freeze(bandDrawPlan(zoom, { latitude, available: bands }));

  /** Truth, indexed the way a hit test asks for it. `i` is pois.json's own id
   *  key, and a row without one cannot be the answer to anything — it would
   *  make every tap on it read as a tap on empty ground. */
  const byId = new Map(
    places.map((place) => {
      if (typeof place?.i !== 'string' || place.i === '') {
        throw new Error(`every place needs its pois.json id: ${JSON.stringify(place)}`);
      }
      return [place.i, place];
    }),
  );

  let current = cameraFor(camera);
  let plan = planFor(current.zoom);

  // Everything the view needs has now been checked, so a renderer is only ever
  // attached to a view that can actually run. A renderer left attached to a
  // half-built view is a WebGL context nobody holds a handle to.
  renderer.attach(
    container,
    Object.freeze({
      world,
      skin,
      palette,
      camera: current,
      plan,
      // Positions, so the renderer can draw a pin and answer a tap on one.
      // Frozen: what a Place *is* stays this side of the seam, and hitTest
      // answers out of the same list rather than out of the renderer.
      places: Object.freeze([...places]),
    }),
  );

  /** Two plans are the same when they name the same bands in the same roles.
   *  Comparing rather than repainting on every frame is not a micro-optimisation:
   *  a repaint is a restyle, and a renderer told to restyle mid-pinch is a
   *  renderer that flickers. */
  const sameAs = (a, b) =>
    a.primary === b.primary
    && a.placeholder === b.placeholder
    && a.primaryReady === b.primaryReady
    && a.draw.length === b.draw.length
    && a.draw.every((id, i) => id === b.draw[i]);

  const repaint = (next = planFor(current.zoom)) => {
    if (sameAs(next, plan)) return;
    plan = next;
    renderer.paint(plan);
  };

  /** Same place, same closeness, same way up. Pitch is left out because it is
   *  derived from zoom, so two cameras that agree on zoom cannot disagree on
   *  it, and `ease` is left out because how you get somewhere you already are
   *  is not a question. */
  const sameCamera = (a, b) =>
    a.center.lng === b.center.lng
    && a.center.lat === b.center.lat
    && a.zoom === b.zoom
    && a.bearing === b.bearing;

  const move = (next, ease) => {
    const wanted = cameraFor(next, ease);
    // A renderer owns gestures, so it is also where camera moves come from: a
    // guest's pinch arrives back here through setCamera. Applying one that
    // changes nothing would move the map, which would fire another gesture
    // event, which would arrive back here — a pinch that never settles.
    if (sameCamera(wanted, current)) return;
    current = wanted;
    renderer.camera(current);
    repaint();
  };

  let alive = true;
  const assertAlive = () => {
    if (!alive) throw new Error('this map view has been destroyed');
  };

  return {
    setCamera: (next) => {
      assertAlive();
      move(next, null);
    },

    /** Ease to a camera rather than jump. `ease` is data the renderer applies
     *  — this seam does not run the animation, it only says how long. */
    easeCamera: (next, { durationMs } = {}) => {
      assertAlive();
      if (!finite(durationMs) || durationMs <= 0) {
        throw new Error(`an eased camera move needs a positive durationMs: ${durationMs}`);
      }
      move(next, Object.freeze({ durationMs }));
    },

    /** Members, Marks, placed pins, Places and the route, as Truth —
     *  `overlayGeoJson()`'s five FeatureCollections. A caller may send only
     *  what changed; the ones it leaves out cross empty, because a collection
     *  that simply went missing would leave the last frame's features on
     *  screen with nothing left to clear them. */
    setOverlay: (model) => {
      assertAlive();
      renderer.overlay(normalizeOverlay(model));
    },

    /** What the device holds, as the cache learns it. ADR-0021 clause 5 has
     *  bands streaming by viewport, so this is the call that arrives when one
     *  lands — and the only way the plan changes without the camera moving. */
    setAvailableBands: (ids) => {
      assertAlive();
      const arriving = [...ids];
      // Planned before it is held, for the reason mount() validates before it
      // attaches a renderer: a set the chooser refuses must cost this one call
      // and nothing after it. Held first, a single typo out of the cache would
      // sit in `held` and throw out of every later camera move — one bad frame
      // becomes a dead map for the rest of the session.
      const next = planFor(current.zoom, arriving);
      held = arriving;
      repaint(next);
    },

    /** The Place at a screen point, or null.
     *
     *  The renderer answers with an id because it is the only one that knows
     *  where a pixel landed, and the Place comes back out of this World's own
     *  Truth because it is the only one that knows what a Place is. An id the
     *  venue has not got is a renderer bug and says so: a view that quietly
     *  returned null there would hide a projection that had drifted. */
    hitTest: (point) => {
      assertAlive();
      if (!point || !finite(point.x) || !finite(point.y)) {
        throw new Error('a hit test needs a screen point of finite { x, y }');
      }
      const id = renderer.pick(Object.freeze({ x: point.x, y: point.y }));
      if (id == null) return null;
      const place = byId.get(id);
      if (!place) {
        throw new Error(`renderer picked "${id}", which is not a Place in this World`);
      }
      return place;
    },

    /** The last camera and band plan. Still readable after destroy: a React
     *  render can outlive the effect that tore the renderer down, and where
     *  the camera got to is a fact about the session rather than the GL
     *  context. */
    state: () => Object.freeze({ camera: current, plan }),

    project: (lngLat) => {
      if (!alive || typeof renderer.project !== 'function') return null;
      return renderer.project(lngLat);
    },

    destroy: () => {
      if (!alive) return;
      alive = false;
      renderer.detach();
    },
  };
}
