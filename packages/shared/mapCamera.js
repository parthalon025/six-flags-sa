/** Camera curve for the banded world (ADR-0019 clause 2, ADR-0021 clause 4).
 *
 * Flat top-down when zoomed out, easing toward a tilt as a guest zooms in. The
 * ease is *staged*: it sits inside a gap between Zoom band handoffs, never
 * across one, so a single pinch never tilts the world and restyles it at the
 * same moment. Because band boundaries move with latitude, the range is asked
 * for rather than hardcoded.
 *
 * Pure — no renderer, no DOM. The map view applies the result; a perf trace or
 * a test can ask the same question without a browser.
 */
import { bandBoundaryZooms } from './zoomBands.js';

/** Zoom levels of clearance kept between the ease and the nearest handoff. */
export const DEFAULT_EASE_MARGIN = 0.4;

/** Tilt at the end of the ease, degrees. ADR-0019 clause 2 asks for 30-45. */
export const DEFAULT_MAX_PITCH = 45;

/** The zoom range over which pitch eases in, chosen to clear every band
 *  handoff. Picks the widest gap bounded by two handoffs and insets it. */
export function pitchEaseRange({ latitude = 0, margin = DEFAULT_EASE_MARGIN } = {}) {
  const boundaries = bandBoundaryZooms({ latitude });
  let widest = null;
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const gap = { low: boundaries[i], high: boundaries[i + 1] };
    if (!widest || gap.high - gap.low > widest.high - widest.low) widest = gap;
  }
  // With a single handoff there is no bounded gap; ease above it instead,
  // which still clears the handoff by the same margin.
  if (!widest) {
    const only = boundaries[boundaries.length - 1] ?? 0;
    return { startZoom: only + margin, endZoom: only + margin + 1 };
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
