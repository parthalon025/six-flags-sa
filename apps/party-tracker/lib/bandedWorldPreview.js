/**
 * Train H's thin vertical (#563): kings-island's baked world drawn through
 * MapLibre with the pitch-eases-with-zoom camera, so the two assumptions the
 * rest of the train rests on can be judged on a real handset before anything
 * expensive is built — does flat baked art read well pitched, and does a
 * mobile WebView hold up under it.
 *
 * Off unless explicitly enabled, same ad hoc boolean-capability shape as
 * mapLibreConfigured.js. Client-safe: constants live here so the page and the
 * component read the same scope without dragging node:path into the bundle.
 */
export function bandedWorldPreviewEnabled() {
  return process.env.NEXT_PUBLIC_BANDED_WORLD_PREVIEW === '1';
}

/** The World whose bake this previews. Its display pack ships in public/. */
export const PREVIEW_VENUE = 'kings-island';

/** Baked Skins available for it — two contrasting looks, which is what makes
 *  the beyond-palette distinctness gate visible at all. pixel-tycoon converted
 *  to top-down; guests see OSM until a certified kings-island bake ships.
 *  Do not invent a world PNG to preview the third Skin. */
export const PREVIEW_SKINS = ['watercolor-quest', 'layered-atlas'];

/** Honest guest note (ADR-0021 clause 6): the kit ships; the bake does not. */
export const PIXEL_TYCOON_SHIP_NOTE = 'OSM until a certified bake exists';

/** Where a Skin's world sidecar and its painted bytes are served from. */
export function previewWorldPaths(skin) {
  const base = `/venues/${PREVIEW_VENUE}/display/${skin}.world`;
  return { sidecar: `${base}.json`, image: `${base}.png` };
}
