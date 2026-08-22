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

/** The one World with a certified display pack today. Builder-side twin: the build pipeline's DISPLAY_DEFAULT_VENUES — the two grow together. */
export const DISPLAY_SPIKE_VENUE = 'big-kahunas';

/** The certified Skin the spike renders. */
export const DISPLAY_SPIKE_SKIN = 'watercolor-quest';

/** The two renderers the World map can draw through, shipped default first.
 *
 *  `svg` is components/ParkMapSvg.jsx, the hand-projected renderer ADR-0019
 *  clause 3 retires. `gl` is the port: components/ParkMap.jsx driving the map
 *  view seam over MapLibre, with the live Overlay as GeoJSON (clause 4).
 */
export const PARK_MAP_RENDERERS = Object.freeze(['svg', 'gl']);

/**
 * Which renderer draws the World map.
 *
 * The port lands ahead of the flip. docs/train-h-seams.md keeps the SVG
 * adapter as the escape hatch "until the MapLibre one passes the gate", and
 * that gate is slice h15's perf rows — which wait on an owner decision — plus
 * the browser suites, which still assert on `svg.mapSvg`. So the shipped
 * answer stays `svg`, and this is how a review, a perf trace or a CI lane asks
 * for the ported one.
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
