/** Camera arithmetic for the banded world (ADR-0019 clause 2, ADR-0021 clause 4).
 *
 * The curve first: flat top-down when zoomed out, easing toward a tilt as a
 * guest zooms in. The ease is *staged*: it sits inside a gap between Zoom band
 * handoffs, never across one, so a single pinch never tilts the world and
 * restyles it at the same moment. Because band boundaries move with latitude,
 * the range is asked for rather than hardcoded.
 *
 * Then two answers the ported map view needs and the SVG renderer worked out
 * inline: `frameBounds`, what camera shows a box of ground, and `offsetCentre`,
 * where the centre goes when the puck should sit low on the glass during Go.
 *
 * Pure — no renderer, no DOM. The map view applies the result; a perf trace or
 * a test can ask the same question without a browser.
 */
import { bandBoundaryZooms, metresPerPixel, zoomForResolution } from './zoomBands.js';

/** Zoom levels of clearance kept between the ease and the nearest handoff. */
export const DEFAULT_EASE_MARGIN = 0.4;

/** Tilt at the end of the ease, degrees. ADR-0019 clause 2 asks for 30-45. */
export const DEFAULT_MAX_PITCH = 45;

/* ------------------------------------------------- per-Skin camera feel
 *
 * ADR-0019 clause 2: "Camera feel (bearing/pitch presets) is a per-Skin
 * declared trait of the design request." Clause 6 then makes one of those
 * presets load-bearing rather than decorative. pixel-tycoon used to be drawn
 * by a live isometric painter on its own camera; the clause retires that
 * projection and hands the Skin "the iso flavor painted into the sprites (the
 * G5 pixel-overworld reference's own convention) plus a camera preset" in
 * exchange. This is the second half of that exchange.
 *
 * Why a bearing does the work. MapLibre's pitch is measured from straight
 * down, so the 35.264-degree camera elevation that makes a true isometric
 * view would be a pitch of 54.7 — outside the 30-45 clause 2 fixed, and
 * ADR-0021 rejected reopening that door ("not two renderers forever"). The
 * quarter-turn is the part of the iso read that IS reachable: an RCT-shaped
 * world seen corner-on rather than face-on, with every degree of tilt the ADR
 * allows. Everything else is the kit's job.
 *
 * A preset is a CEILING on the ease, not an offset onto it: every Skin is
 * still flat top-down when zoomed out, and still eases inside the gap between
 * band handoffs that ADR-0021 clause 4 requires. It enters the map view once,
 * at mount (`mountMapView` derives it from the Skin it was handed), and never
 * per frame — a caller that could set pitch per frame could land a tilt and a
 * restyle in one instant, which is the thing clause 4 exists to prevent.
 *
 * Deliberately not a kit field. `skin-distinct.mjs` records A6 (projection and
 * camera) as unmapped precisely because "the pitch/zoom preset lives in
 * mapCamera, not the kit", and giving the kit schema a camera is a decision
 * about what a kit should be able to say rather than a mechanical move.
 */

/** North-up, and the full ease. What a Skin gets by saying nothing. */
export const DEFAULT_CAMERA_PRESET = Object.freeze({ maxPitch: DEFAULT_MAX_PITCH, bearing: 0 });

/** Camera feel each Skin declares. Absent means `DEFAULT_CAMERA_PRESET`.
 *
 *  Declared as a contrasting set rather than one by one: an atlas and a
 *  painted-paper brochure are things you read flat, so they take the bottom of
 *  clause 2's range, and pixel-tycoon takes the top plus the turn. That
 *  contrast is itself part of what makes them read as separate worlds — on an
 *  axis `skin-distinct.mjs` cannot see, which is why it is written down here.
 *
 *  pixel-tycoon's row is a camera, not a bake: clause 6 owes the Skin this
 *  preset for the projection it gave up, and that debt is settled here whether
 *  or not a certified kings-island world PNG exists to preview it on
 *  (`PIXEL_TYCOON_SHIP_NOTE`). Guests wearing it ride the vector tier, on this
 *  camera. */
export const SKIN_CAMERA_PRESETS = Object.freeze({
  'pixel-tycoon': Object.freeze({ maxPitch: DEFAULT_MAX_PITCH, bearing: 45 }),
  'watercolor-quest': Object.freeze({ maxPitch: 30, bearing: 0 }),
  'layered-atlas': Object.freeze({ maxPitch: 30, bearing: 0 }),
});

/** The camera feel to mount a view with for this Skin. */
export function skinCameraPreset(skinId) {
  return SKIN_CAMERA_PRESETS[skinId] || DEFAULT_CAMERA_PRESET;
}

/** The zoom range over which pitch eases in, chosen to clear every band
 *  handoff. Picks the widest gap bounded by two handoffs and insets it. */
export function pitchEaseRange({ latitude = 0, margin = DEFAULT_EASE_MARGIN } = {}) {
  const boundaries = bandBoundaryZooms({ latitude });
  // Needs two handoffs to have a gap bounded on both sides to sit inside. The
  // shipped table has three bands and so always does; a table that stopped
  // having one should say so rather than quietly easing across a handoff.
  if (boundaries.length < 2) {
    throw new Error(
      `pitch ease needs a gap bounded by two band handoffs; got ${boundaries.length}`,
    );
  }
  let widest = { low: boundaries[0], high: boundaries[1] };
  for (let i = 1; i < boundaries.length - 1; i += 1) {
    const gap = { low: boundaries[i], high: boundaries[i + 1] };
    if (gap.high - gap.low > widest.high - widest.low) widest = gap;
  }
  return { startZoom: widest.low + margin, endZoom: widest.high - margin };
}

/** Smoothstep: eases in and out rather than ramping, so the tilt never starts
 *  or stops abruptly. */
function smoothstep(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Camera pitch in degrees for a zoom, flat until the ease begins. */
export function pitchForZoom(
  zoom,
  { latitude = 0, maxPitch = DEFAULT_MAX_PITCH, margin = DEFAULT_EASE_MARGIN } = {},
) {
  const { startZoom, endZoom } = pitchEaseRange({ latitude, margin });
  if (zoom <= startZoom) return 0;
  if (zoom >= endZoom) return maxPitch;
  return maxPitch * smoothstep((zoom - startZoom) / (endZoom - startZoom));
}

/** Ground metres in one degree of latitude, read off the same constant the
 *  band table converts zooms with rather than restated — a second value for
 *  the size of the Earth is a drift waiting to happen. */
const METRES_PER_DEGREE = (metresPerPixel(0, { latitude: 0 }) * 512) / 360;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** Web Mercator's cosine, clamped the way `zoomBands` clamps it: past the
 *  projection's limit the cosine turns negative and the arithmetic runs away. */
function cosLatitude(latitude) {
  const clamped = Math.min(85.051129, Math.max(-85.051129, latitude));
  return Math.cos((clamped * Math.PI) / 180);
}

/**
 * The camera that frames a box of ground in a viewport.
 *
 * What "fit this route on screen" and "open on this World" both reduce to. The
 * wider axis decides the zoom, because the narrower one already fits — sizing
 * to the other puts half the box off the glass.
 *
 * @param {{west: number, south: number, east: number, north: number}} bounds
 * @param {{width: number, height: number}} viewport usable pixels — the caller
 *   subtracts whatever furniture covers the map before asking.
 * @returns {{center: {lng: number, lat: number}, zoom: number}}
 */
export function frameBounds(bounds, { width, height } = {}) {
  const { west, south, east, north } = bounds ?? {};
  if (![west, south, east, north].every(finite)) {
    throw new Error(`bounds needs finite west, south, east and north: ${JSON.stringify(bounds)}`);
  }
  if (!finite(width) || !finite(height) || width <= 0 || height <= 0) {
    throw new Error(`viewport needs a positive width and height in pixels: ${width}x${height}`);
  }
  const latitude = (north + south) / 2;
  const groundX = Math.abs(east - west) * METRES_PER_DEGREE * cosLatitude(latitude);
  const groundY = Math.abs(north - south) * METRES_PER_DEGREE;
  const resolution = Math.max(groundX / width, groundY / height);
  if (resolution <= 0) {
    throw new Error('bounds has no extent: a box of no ground has no camera that frames it');
  }
  return {
    center: { lng: (west + east) / 2, lat: latitude },
    zoom: zoomForResolution(resolution, { latitude }),
  };
}

/**
 * A centre moved along a bearing.
 *
 * Course-up during Go wants the puck low on the glass with the road ahead
 * above it, which is this: the camera centre pushed *forward along the
 * bearing*, not simply north. Pushing north instead slides the map the wrong
 * way every time the guest turns a corner.
 *
 * @param {{lng: number, lat: number}} centre
 * @param {{metres: number, bearing: number}} move bearing in degrees clockwise
 *   from north, matching the camera's own.
 */
export function offsetCentre(centre, { metres, bearing } = {}) {
  const { lng, lat } = centre ?? {};
  if (!finite(lng) || !finite(lat)) {
    throw new Error(`centre needs a finite lng and lat: ${JSON.stringify(centre)}`);
  }
  if (!finite(metres)) throw new Error(`metres must be a finite number: ${metres}`);
  if (!finite(bearing)) throw new Error(`bearing must be a finite number: ${bearing}`);
  if (metres === 0) return { lng, lat };
  const radians = (bearing * Math.PI) / 180;
  return {
    lng: lng + (metres * Math.sin(radians)) / (METRES_PER_DEGREE * cosLatitude(lat)),
    lat: lat + (metres * Math.cos(radians)) / METRES_PER_DEGREE,
  };
}
