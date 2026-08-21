/**
 * What the phone paints, given where the camera is and what the device holds.
 *
 * The Zoom band table (packages/shared/zoomBands.js) answers which band a zoom
 * *wants*. That is not the same question as what to draw, because a band the
 * camera wants may not be on the device yet: ADR-0021 clause 5 withdrew the
 * automatic pyramid prefetch, so bands stream by viewport and the mid band in
 * the venue pack is the offline floor. This module closes that gap — it takes
 * the set of bands actually present and answers with a primary band and a
 * single placeholder band held underneath it.
 *
 * The placeholder is the point. ADR-0021 clause 4 requires content a closer
 * band adds to ramp in across the crossfade rather than switching on at the
 * band's edge, so the parent stays drawn *under* the child for the whole fade
 * instead of being swapped out at the handoff. `parentOf()` in the shared
 * table exists for exactly this. Because clause 2 fixes each band at 4x its
 * neighbour, a parent always upscales pixel-for-pixel with no seam.
 *
 * Pure — no renderer, no fetch, no cache. The map view hands in a zoom and its
 * cache's key set and applies the answer; a test or a perf trace can ask the
 * same question with no browser.
 */
import { BANDS, bandForZoom, parentOf } from '@party-tracker/shared/zoomBands.js';

/** Band ids coarsest first, mirroring the shared table's own order. */
const BAND_ORDER = BANDS.map((band) => band.id);

function bandIndex(id) {
  const i = BAND_ORDER.indexOf(id);
  if (i < 0) throw new Error(`unknown band: ${id}`);
  return i;
}

/** Validate the caller's set of held bands, and reject the two states that
 *  cannot be rendered from. An unknown id is a typo rather than an absent
 *  band, and an empty set cannot happen on a real device — the mid band ships
 *  in the venue pack — so both are caller bugs worth failing loudly on rather
 *  than quietly painting nothing. */
function heldBands(available) {
  const held = new Set();
  if (available != null) {
    if (typeof available[Symbol.iterator] !== 'function') {
      throw new Error('available must be a Set or array of band ids');
    }
    for (const id of available) {
      bandIndex(id);
      held.add(id);
    }
  }
  if (held.size === 0) {
    throw new Error(
      'no bands available to draw: the mid band is a venue-pack invariant, ' +
        'so an empty set is a caller bug rather than a state to render',
    );
  }
  return held;
}

/** The nearest band coarser than `id` that the device holds, or null. Nearest
 *  rather than strictly the parent, so a device missing a middle band still
 *  gets something under the primary instead of nothing. */
function nearestHeldAncestor(id, held) {
  for (let up = parentOf(id); up; up = parentOf(up)) {
    if (held.has(up)) return up;
  }
  return null;
}

/** The nearest band finer than `id` that the device holds, or null. */
function nearestHeldDescendant(id, held) {
  for (let i = bandIndex(id) + 1; i < BAND_ORDER.length; i += 1) {
    if (held.has(BAND_ORDER[i])) return BAND_ORDER[i];
  }
  return null;
}

/**
 * Plan one frame's bands.
 *
 * @param {number} zoom MapLibre zoom of the camera.
 * @param {{latitude?: number, available?: Iterable<string>}} options
 *   `latitude` moves the band handoffs (Mercator pixels cover less ground away
 *   from the equator); `available` is every band id the device holds.
 * @returns {{primary: string, placeholder: string|null, primaryReady: boolean,
 *   draw: string[]}}
 *   `primary` is the band this zoom wants, named whether or not it has arrived
 *   — a caller streaming bands needs to know what to ask for. `primaryReady`
 *   says whether it is there. `placeholder` is the one band held underneath.
 *   `draw` is what to actually paint, bottom to top.
 */
export function bandDrawPlan(zoom, { latitude = 0, available } = {}) {
  const held = heldBands(available);
  // Throws on a latitude that is not a finite number, before any of it can
  // reach a live map.setPitch().
  const primary = bandForZoom(zoom, { latitude });
  const primaryReady = held.has(primary);

  // Normally the placeholder is the nearest coarser band, upscaled: that is
  // clause 4's parent held across the crossfade. When the primary itself has
  // not arrived and nothing coarser is on the device either, a *finer* band
  // stands in instead — downsampling is free and the alternative is an empty
  // screen. That case is why a phone holding only the venue pack's mid band
  // still has a picture when zoomed all the way out.
  const placeholder =
    nearestHeldAncestor(primary, held) ??
    (primaryReady ? null : nearestHeldDescendant(primary, held));

  // Coarsest first, so the finer band paints over the placeholder. No sort is
  // needed to guarantee that: when the primary is drawn at all the placeholder
  // is an ancestor of it, and when the primary has not arrived the placeholder
  // is the only survivor.
  const draw = [placeholder, primary].filter((id) => id !== null && held.has(id));

  return { primary, placeholder, primaryReady, draw };
}
