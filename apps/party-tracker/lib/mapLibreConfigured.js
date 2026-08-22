/**
 * The display-pipeline MapLibre spike (issue #527, ADR-0013 Phase 1) is off
 * unless explicitly enabled — `DisplayMap.jsx` is a separate dev path from the
 * shipped World map, which draws through the map view seam.
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

/** The renderers the World map can draw through, shipped default first.
 *
 *  One entry, which is ADR-0019 clause 3 finished: MapLibre is *the* map view
 *  and the hand-projected SVG world viewer has retired (slice h18). `gl` is
 *  `components/ParkMapGl.jsx`, driving the map view seam with the live Overlay
 *  as GeoJSON (clause 4).
 *
 *  Not a one-element formality. ADR-0013 item 4's real-time PBR tier is the
 *  next adapter the seam is shaped for, and this list plus `parkMapRenderer()`
 *  is where a build or a review will name it.
 */
export const PARK_MAP_RENDERERS = Object.freeze(['gl']);

/**
 * Which renderer draws the World map.
 *
 * With one renderer shipping, what this is still for is resolving a *stale*
 * answer safely. `NEXT_PUBLIC_PARKMAP_RENDERER=svg` outlives the file it names
 * — in a deployment's env, in a CI lane, in a reviewer's bookmarked
 * `?parkMap=svg` — and every one of those has to draw the shipped map rather
 * than nothing at all.
 *
 * Pure, and both the query string and the renderer list are passed in rather
 * than read, so which renderer a build ships is a fact a test can pin without
 * a browser, and the resolution rules can be asserted against a second
 * renderer before one exists.
 *
 * @param {object} [options]
 * @param {string|undefined} [options.env] the build's declared renderer.
 * @param {string} [options.search] `window.location.search`, for the escape
 *   hatch. It outranks the build in both directions: a reviewer on a build
 *   shipping one renderer has to be able to put another beside it.
 * @param {readonly string[]} [options.renderers] the renderers that exist.
 */
export function parkMapRenderer({
  env = process.env.NEXT_PUBLIC_PARKMAP_RENDERER,
  search = '',
  renderers = PARK_MAP_RENDERERS,
} = {}) {
  const asked = new URLSearchParams(search).get('parkMap');
  if (renderers.includes(asked)) return asked;
  // Anything else — a typo, a retired renderer, a stale `=1`, one nobody has
  // written — is the shipped one. A blank map is a worse answer than any map.
  return renderers.includes(env) ? env : renderers[0];
}
