/**
 * The display-pipeline MapLibre spike (issue #527, ADR-0013 Phase 1) is off
 * unless explicitly enabled — the shipped map stays ParkMap.jsx's SVG
 * renderer everywhere else. Same ad hoc boolean-capability shape as
 * clerkConfigured.js: a single env-var check, no flags registry.
 */
export function mapLibreDisplayEnabled() {
  return process.env.NEXT_PUBLIC_MAPLIBRE_DISPLAY === '1';
}
