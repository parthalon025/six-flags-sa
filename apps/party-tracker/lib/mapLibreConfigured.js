/**
 * The display-pipeline MapLibre spike (issue #527, ADR-0013 Phase 1) is off
 * unless explicitly enabled. The shipped World map is MapLibre (slice h18);
 * this flag only gates the /display-spike byte source. Same ad hoc
 * boolean-capability shape as clerkConfigured.js.
 *
 * The venue/Skin constants live here rather than in lib/displaySpike.js
 * because this module is client-safe: page.js and DisplayMap.jsx import the
 * scope from the same place the server-side byte source does, without
 * dragging node:path into the client bundle.
 */
export function mapLibreDisplayEnabled() {
  return process.env.NEXT_PUBLIC_MAPLIBRE_DISPLAY === '1';
}

/** The one World with a certified display pack today. Builder-side twin: the build pipeline's DISPLAY_DEFAULT_VENUES — the two grow together. */
export const DISPLAY_SPIKE_VENUE = 'big-kahunas';

/** The certified Skin the spike renders. */
export const DISPLAY_SPIKE_SKIN = 'watercolor-quest';

/** The renderer the World map can draw through.
 *
 *  `gl` is components/ParkMap.jsx driving the map view seam over MapLibre,
 *  with the live Overlay as GeoJSON (ADR-0019 clauses 3-4). The SVG adapter
 *  retired in slice h18.
 */
export const PARK_MAP_RENDERERS = Object.freeze(['gl']);

/**
 * Which renderer draws the World map.
 *
 * MapLibre is the shipped renderer (slice h18). `?parkMap=` remains an
 * escape for a reviewer who needs to name the engine, but the only remaining
 * engine is `gl`.
 *
 * Pure, and the query string is passed in rather than read, so which renderer
 * a build ships is a fact a test can pin without a browser.
 *
 * @param {object} [options]
 * @param {string|undefined} [options.env] the build's declared renderer.
 * @param {string} [options.search] `window.location.search`, for the escape
 *   hatch. It outranks the build in both directions: a reviewer on a `gl`
 *   build has to be able to put the shipped renderer back beside it.
 */
export function parkMapRenderer({
  env = process.env.NEXT_PUBLIC_PARKMAP_RENDERER,
  search = '',
} = {}) {
  const asked = new URLSearchParams(search).get('parkMap');
  if (PARK_MAP_RENDERERS.includes(asked)) return asked;
  // Anything else — a typo, a stale `=1`, a renderer nobody has written — is
  // the shipped one. A blank map is a worse answer than the old map.
  return PARK_MAP_RENDERERS.includes(env) ? env : PARK_MAP_RENDERERS[0];
}
