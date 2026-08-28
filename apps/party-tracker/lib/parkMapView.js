/**
 * What ParkMap hands the map view.
 *
 * The caller side of the seam (docs/train-h-seams.md seam 2), and deliberately
 * not inside the component. Turning what the app knows into a World, an
 * Overlay model and a camera request is the part of a map component most worth
 * asserting and the part hardest to reach through one — a React render, a
 * canvas and a WebGL context stand between a test and three lines of
 * arithmetic. Pure here, driven from plain Node, and the component only calls
 * it.
 *
 * Nothing in this file draws, projects or reads a clock. `now` is an argument
 * for the same reason `overlayGeo.js` takes one: staleness is the only thing
 * here that depends on time, and a function that reads `Date.now()` cannot be
 * given a known answer.
 */

import { mapThemePack } from './mapThemeTokens.js';
import { landTint, paletteFor } from './theme.js';
import { worldGeoJson } from './worldGeo.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The two palettes a ParkMap render needs. They are not interchangeable:
 * the surface pack has no category pin colours, and the pin palette has no
 * ground/path paint. Handing `mapPaint` to the map key throws on first
 * render (`categories` is missing).
 *
 * @param {string|null|undefined} theme a Skin id or `day`/`night`
 */
export function parkMapPalettes(theme) {
  return { surface: mapThemePack(theme), pins: paletteFor(theme) };
}

/** A glide, not a jump, when a person moves. Fixes land every few seconds and
 *  a teleporting map is how a guest loses track of where they were looking. */
export const FOLLOW_EASE_MS = 480;

/** Nothing has moved far enough to chase. GPS and graph snapping jitter by a
 *  metre or two; at walking zoom that is a few pixels, and a camera following
 *  it reads as the map bouncing in place. */
export const FOLLOW_DEADBAND_METRES = 2;

/** Free look lasts this long after the last guest gesture, then Follow
 *  snaps back to this phone. */
export const FOLLOW_RESUME_MS = 3200;

/**
 * Whether a paused Follow should come back.
 *
 * A gesture is free look. Once the guest has been still for `resumeMs`,
 * the camera snaps back to this phone. Previewing a route is not free
 * look: framing the whole walk is a statement about the walk, and
 * recentring the puck would undo it. An explicit look-at (a Place) has
 * no gesture time, so this stays false until they pan or tap Locate.
 *
 * @param {object} state
 * @param {number|null} [state.gesturedAt] when the guest last moved the camera
 * @param {number} state.now
 * @param {boolean} [state.previewing]
 * @param {number} [state.resumeMs]
 */
export function followShouldResume({
  gesturedAt = null,
  now,
  previewing = false,
  resumeMs = FOLLOW_RESUME_MS,
} = {}) {
  if (previewing) return false;
  if (gesturedAt == null) return false;
  if (!finite(now)) {
    throw new TypeError('followShouldResume needs a finite `now` in ms — it must not read the clock itself');
  }
  return now - gesturedAt >= resumeMs;
}

/**
 * The World the map view draws, or null when this venue cannot be drawn yet.
 *
 * `bounds` is the venue's own — ADR-0016's image-on-truth-bounds contract, and
 * what every band is baked against. Without it there is no camera to open on
 * and no coordinates to hang a band from, so this answers null and the caller
 * falls back rather than framing a map on a guess.
 *
 * @param {object|null} map a venue's `map.json`
 */
export function worldFor(map) {
  const bounds = map?.meta?.bounds;
  if (typeof map?.meta?.id !== 'string' || !map.meta.id || !bounds) return null;
  const { west, south, east, north } = bounds;
  if (![west, south, east, north].every(finite)) return null;
  // A box of no ground has no camera that frames it, and a World arriving with
  // one is a builder bug rather than something to open a map on.
  if (!(east > west) || !(north > south)) return null;
  const declared = map.meta.center;
  const center = declared && finite(declared.lat) && finite(declared.lng)
    ? { lat: declared.lat, lng: declared.lng }
    : null;
  return { id: map.meta.id, bounds, geometry: worldGeoJson(map), center };
}

/**
 * Stamp each land feature with the tint MapLibre reads (`mapViewStyle.js`).
 *
 * Zone tones from the Visual factory arrive asynchronously; until they land
 * `landTint` falls back to the renderer's name-hue, which is the same answer
 * the SVG path used to paint inline.
 *
 * @param {ReturnType<typeof worldFor>} world
 * @param {string|null|undefined} theme
 * @param {Record<string, {fill: string}>|null} zoneTones
 */
export function worldWithLandTints(world, theme, zoneTones = null) {
  if (!world?.geometry?.lands?.features?.length) return world;
  const features = world.geometry.lands.features.map((feature) => {
    const name = feature.properties?.name;
    if (!name) return feature;
    const tint = landTint(name, theme, zoneTones).fill;
    return {
      ...feature,
      properties: { ...feature.properties, tint },
    };
  });
  return {
    ...world,
    geometry: {
      ...world.geometry,
      lands: { ...world.geometry.lands, features },
    },
  };
}

/**
 * The box a list of `[lat, lng]` pairs sits in, or null if there is no box.
 *
 * Pairs are lat-first, which is how `routing.js` writes a route and the
 * reverse of the bounds this answers with. A pair that is not two finite
 * numbers is skipped rather than stretching the box to the Gulf of Guinea —
 * the same rule `overlayGeo.js` states.
 */
export function boundsOfPoints(points) {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const pair of points || []) {
    const [lat, lng] = Array.isArray(pair) ? pair : [];
    if (!finite(lat) || !finite(lng)) continue;
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (!finite(west)) return null;
  // One place is a place, not a box: a camera cannot frame a point, and the
  // caller wants "leave the camera alone" rather than infinite zoom.
  if (west === east && south === north) return null;
  return { west, south, east, north };
}

/**
 * The Overlay's model, from what the app knows.
 *
 * The one thing it decides: this phone's own position joins the roster rather
 * than becoming a second kind of dot. It is a Member — the Party sees it as
 * one — and drawing it through the same source is what keeps it in the same
 * camera as everyone else.
 *
 * @param {object} state members, me/puck, route, marks, Places and the pins
 *   somebody placed
 * @param {{now: number}} options
 * @returns {object} the model `overlayGeo.overlayGeoJson` takes
 */
export function overlayModel(
  { members, me = null, puck = null, route = null, progress = null, marks = [], pois = [], meet = null, spot = null, car = null, overlayPins = [] },
  { now },
) {
  if (!finite(now)) {
    throw new TypeError('overlayModel needs a finite `now` in ms — it must not read the clock itself');
  }
  /* The snapped puck while a route runs, the raw fix otherwise: the same
     choice Follow makes, so the dot and the camera cannot disagree about where
     this phone is. `ts` defaults to now because a puck is derived from the fix
     that just landed — it is never a stale one, and with no timestamp it would
     draw faded from its first frame. */
  const here = puck ?? me;
  return {
    members: here
      ? [...(members || []), { ...here, id: here.id ?? 'me', self: true, ts: here.ts ?? now }]
      : (members || []),
    route,
    progress,
    marks,
    pois,
    meet,
    spot,
    car,
    overlayPins,
  };
}

/**
 * One camera request, from every prop that has an opinion about where the
 * camera should be.
 *
 * `null` means "leave it". A Follow that also re-zoomed would undo every
 * pinch, and a map that re-centred on each render would never let a guest look
 * anywhere.
 *
 * @param {object} intent
 * @param {boolean} [intent.follow] keep this phone centred
 * @param {{lat, lng}|null} [intent.anchor] where this phone is
 * @param {{lat, lng}|null} [intent.focusPoint] a Place, a Member, the Rally
 *   Point — something the guest asked to look at
 * @param {{west, south, east, north}|null} [intent.fit] a box to frame
 * @param {number|null} [intent.scale] the SVG renderer's pixels-per-metre
 * @param {number} [intent.bearing]
 * @param {number} [intent.lift] fraction of the viewport the centre moves
 *   forward along the bearing, so the puck sits low during Go
 */
export function cameraRequest({
  follow = false,
  anchor = null,
  focusPoint = null,
  fit = null,
  scale = null,
  bearing = 0,
  lift = 0,
} = {}) {
  const at = (point) => (point && finite(point.lat) && finite(point.lng)
    ? { lng: point.lng, lat: point.lat }
    : null);
  // Follow outranks a focus request: a guest walking somewhere has already
  // said what they are looking at.
  const chased = follow ? at(anchor) : null;
  const target = chased ?? at(focusPoint);

  /* Framing a route is a statement about the whole route rather than about one
     point of it, so a fit clears both the centre and the closeness rather than
     racing them. Two effects fighting over the camera is what made the SVG
     renderer's preview snap back mid-pan.

     And nothing stands behind a target as a fallback — the World's own centre
     least of all. That is where a map *opens*, which `ParkMapGl` does by
     framing the truth bounds at mount; re-asserted here it would be re-asserted
     on every GPS fix, because the anchor this is rebuilt from is a fresh object
     each time one lands. With Follow off that undid a guest's pan within
     seconds, and with nothing chased there is no ease either, so it arrived as
     a jump. Nobody asking for anything has to mean nobody moves the camera. */
  return {
    center: fit ? null : target,
    // Ground metres per pixel. The SVG renderer counted pixels per metre;
    // MapLibre's zoom means different ground at different latitudes, and
    // "walking zoom" is a statement about ground. Converted, not re-chosen, so
    // the two renderers agree about how close "close" is.
    resolution: fit || !finite(scale) || scale <= 0 ? null : 1 / scale,
    fit,
    bearing,
    lift,
    easeMs: chased || at(focusPoint) ? FOLLOW_EASE_MS : null,
    deadbandMetres: FOLLOW_DEADBAND_METRES,
  };
}
