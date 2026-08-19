/**
 * The display-pipeline MapLibre spike (issue #527, ADR-0013 Phase 1) is off
 * unless explicitly enabled — the shipped map stays ParkMap.jsx's SVG
 * renderer everywhere else. Same ad hoc boolean-capability shape as
 * clerkConfigured.js: a single env-var check, no flags registry.
 *
 * The venue/Skin constants live here rather than in lib/displaySpike.js
 * because this module is client-safe: page.js and DisplayMap.jsx import the
 * scope from the same place the server-side byte source does, without
 * dragging node:path into the client bundle.
 */
export function mapLibreDisplayEnabled() {
  return process.env.NEXT_PUBLIC_MAPLIBRE_DISPLAY === '1';
}

/** The one World with a certified display pack today. Builder-side twin: DISPLAY_DEFAULT_VENUES in packages/venue-builder/lib/build-pipeline.mjs. */
export const DISPLAY_SPIKE_VENUE = 'big-kahunas';

/** The certified Skin the spike renders. */
export const DISPLAY_SPIKE_SKIN = 'watercolor-quest';
