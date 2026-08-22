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

/** The first ship: one World x three contrasting Skins (ADR-0021 clause 6),
 *  declared here because this is what actually ships them, and read from here
 *  by the builder's set gate rather than restated there.
 *
 *  Three rather than two is the clause's own argument: one Skin cannot fail
 *  the beyond-palette distinctness gate, and "a pair that passes may be
 *  passing on a single axis; three is the smallest set where that cannot
 *  hide". pixel-tycoon leads because ADR-0019 clause 6 retired the projection
 *  that carried its distinctness, which makes it the hardest case for the gate
 *  and the cheapest place to discover a kit problem. */
export const PREVIEW_SKINS = ['pixel-tycoon', 'watercolor-quest', 'layered-atlas'];

/** Where a Skin's world sidecar and its painted bytes are served from. */
export function previewWorldPaths(skin) {
  const base = `/venues/${PREVIEW_VENUE}/display/${skin}.world`;
  return { sidecar: `${base}.json`, image: `${base}.png` };
}
