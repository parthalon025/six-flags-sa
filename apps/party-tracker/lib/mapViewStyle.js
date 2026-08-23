/**
 * The MapLibre style a World draws through.
 *
 * Pure data: a World's bounds, the Truth geometry it ships, the bands it has
 * bytes for and the Skin's paint pack become sources and layers. No renderer
 * import, so the parts of the MapLibre adapter that hold a decision — which
 * layer sits over which, what starts hidden, what colour a Skin paints the
 * lake — can be asserted without a browser.
 *
 * Three tiers, bottom to top, and the order between them is the decision this
 * file exists to hold:
 *
 *   1. **The vector tier**, from `lib/worldGeo.js`. ADR-0019's consequences
 *      keep it "the never-fails fallback under every Skin" — Truth geometry,
 *      no baked band, no network — so it is at the bottom and always drawn.
 *   2. **The painted bands**, over it. A band is an improvement on the vector
 *      tier, and a fallback drawn on top of the thing it stands in for is not
 *      one. Every band layer starts hidden: which is drawn is the band plan's
 *      answer (lib/bandPlan.js, through lib/mapView.js) and arrives as a
 *      visibility change rather than as a restyle, because ADR-0021 clause 4
 *      wants content ramping in across a crossfade and a style swap mid-pinch
 *      is the opposite of that.
 *   3. **The live Overlay**, over everything, from `lib/overlayGeo.js`. Drawn
 *      from Truth and never snapped to the art beneath it (ADR-0021 clause 3);
 *      a route the painted world covers is that same failure seen from above.
 */
import { BANDS } from '@party-tracker/shared/zoomBands.js';
import { OVERLAY_LAYERS } from './overlayGeo.js';
import { WORLD_LAYERS } from './worldGeo.js';

/** Source and layer ids, so the adapter and this file cannot drift. */
export const bandSource = (id) => `band-${id}`;
export const bandLayer = (id) => `band-${id}`;
export const worldSource = (id) => `world-${id}`;
export const worldLayer = (id) => `world-${id}`;
export const overlaySource = (id) => `overlay-${id}`;

/** One geojson source per collection `overlayGeo.overlayGeoJson` answers with,
 *  derived from that list rather than restated: a collection added there must
 *  not be able to arrive at a source that was never created. */
export const OVERLAY_SOURCES = Object.freeze(
  Object.fromEntries(OVERLAY_LAYERS.map((id) => [id, overlaySource(id)])),
);

/** The layer a tap is resolved against. The renderer queries it and answers
 *  with an id; what a Place *is* stays on the seam's side (lib/mapView.js). */
export const PLACES_LAYER = overlaySource('places');

export const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

/** Defaults for a World whose Skin has not declared these. The keys are the
 *  paint pack `lib/world.js` builds for every Skin and palette, so a Skin's
 *  own pack drops straight in — the same pack the SVG renderer read, which is
 *  what makes this a change of renderer rather than a change of look. */
const FALLBACK = Object.freeze({
  ground: '#0d1b22',
  groundEdge: '#2a3d47',
  wood: '#1e3020',
  lot: '#2a2438',
  lotEdge: '#3a4a52',
  waterFill: '#1e4a5c',
  waterEdge: '#2d6b80',
  poolFill: '#1e6a80',
  poolEdge: '#4fc3f7',
  structure: '#2a2438',
  structureEdge: '#c4a882',
  grass: Object.freeze({ fill: '#1e3020' }),
  building: Object.freeze({ fill: '#2a2438', stroke: '#c4a882', width: 0.8 }),
  path: Object.freeze({ stroke: '#c4a882', width: 2.4, casing: '#0d1b22', casingWidth: 4.6 }),
  route: '#4fc3f7',
  place: '#f4511e',
  mark: '#ffca28',
  pin: '#e53935',
  member: '#7c4dff',
});

/** How each World layer is painted, from the Skin's own paint pack. A layer
 *  named here and absent from a venue simply never gets built — see
 *  `worldLayers` below. */
const WORLD_PAINT = Object.freeze({
  sea: (p) => ({ type: 'fill', paint: { 'fill-color': p('waterFill') } }),
  park: (p) => ({ type: 'fill', paint: { 'fill-color': p('ground'), 'fill-outline-color': p('groundEdge') } }),
  // Per-district tints are venue data, not Skin data: `visual.json`'s Zone
  // tones ride in as a feature property once the display pack carries them
  // (ADR-0013), which is why this reads a property before falling back.
  lands: (p) => ({
    type: 'fill',
    paint: { 'fill-color': ['coalesce', ['get', 'tint'], p('grass').fill], 'fill-opacity': 0.35 },
  }),
  wood: (p) => ({ type: 'fill', paint: { 'fill-color': p('wood') } }),
  grass: (p) => ({ type: 'fill', paint: { 'fill-color': p('grass').fill } }),
  parking: (p) => ({ type: 'fill', paint: { 'fill-color': p('lot'), 'fill-outline-color': p('lotEdge') } }),
  water: (p) => ({ type: 'fill', paint: { 'fill-color': p('waterFill'), 'fill-outline-color': p('waterEdge') } }),
  pool: (p) => ({ type: 'fill', paint: { 'fill-color': p('poolFill'), 'fill-outline-color': p('poolEdge') } }),
  // A line layer over a polygon source draws its outline, which is all the
  // park boundary ever was.
  boundary: (p) => ({ type: 'line', paint: { 'line-color': p('groundEdge'), 'line-width': 1.5 } }),
  service: (p) => ({ type: 'line', paint: { 'line-color': p('path').casing, 'line-width': 1 } }),
  path: (p) => ({
    type: 'line',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': p('path').stroke, 'line-width': p('path').width },
    // One wide line in the ground colour under the path: without it a midway
    // crossing a lawn has no edge and reads as a gap in the grass.
    casing: { 'line-color': p('path').casing, 'line-width': p('path').casingWidth },
  }),
  building: (p) => ({
    type: 'fill',
    paint: { 'fill-color': p('building').fill, 'fill-outline-color': p('building').stroke },
  }),
  slide: (p) => ({ type: 'line', paint: { 'line-color': p('poolEdge'), 'line-width': 2 } }),
  coaster: (p) => ({ type: 'line', paint: { 'line-color': p('structureEdge'), 'line-width': 1.6 } }),
});

/** The Overlay's layers, bottom to top within the tier. Route under the marks
 *  it runs between, Places under the live things standing on them, Members
 *  last: a party dot is the one mark a guest is always looking for. */
function overlayLayers(colour) {
  const source = (name) => OVERLAY_SOURCES[name];
  return [
    {
      id: `${source('route')}-case`,
      type: 'line',
      source: source('route'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#000000', 'line-opacity': 0.35, 'line-width': 8 },
    },
    {
      id: source('route'),
      type: 'line',
      source: source('route'),
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colour('route'), 'line-width': 4 },
    },
    {
      id: source('places'),
      type: 'circle',
      source: source('places'),
      paint: {
        'circle-radius': 5,
        'circle-color': colour('place'),
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
        // Invisible hit target. The SVG overlay is the visible pin; drawing
        // both is the park-wide black mass.
        'circle-opacity': 0,
        'circle-stroke-opacity': 0,
      },
    },
    {
      id: source('marks'),
      type: 'circle',
      source: source('marks'),
      // Unused Marks fade; the Contribution they celebrate does not. The
      // opacity is the Mark's own, so the fade is Truth's answer and not a
      // timer the renderer keeps.
      paint: {
        'circle-radius': 6,
        'circle-color': colour('mark'),
        'circle-opacity': ['coalesce', ['get', 'opacity'], 1],
      },
    },
    {
      id: source('pins'),
      type: 'circle',
      source: source('pins'),
      paint: {
        'circle-radius': 7,
        'circle-color': colour('pin'),
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
    {
      id: source('members'),
      type: 'circle',
      source: source('members'),
      // A stale fix is drawn faded rather than dropped: where someone was is
      // worth more than nothing, and Location keeps the last-known fix marked
      // stale rather than hiding it. `coalesce` because a `case` handed a
      // missing property is a style error, and a style error is a layer that
      // draws nothing — the whole Party gone rather than one dot dimmed.
      paint: {
        'circle-radius': 7,
        'circle-color': colour('member'),
        'circle-opacity': ['case', ['coalesce', ['get', 'stale'], false], 0.45, 1],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    },
  ];
}

/** The World layers this venue actually needs. A source is created for every
 *  layer in the table — so geometry arriving later has somewhere to land — but
 *  a layer is only built where there is something in it: most venues have no
 *  sea and no coaster, and fourteen layers per frame per venue is a cost paid
 *  for nothing. */
function worldLayers(geometry, colour) {
  const layers = [];
  for (const { id } of WORLD_LAYERS) {
    if (!geometry?.[id]?.features?.length) continue;
    const { casing, ...spec } = WORLD_PAINT[id](colour);
    if (casing) {
      layers.push({ id: `${worldLayer(id)}-case`, type: 'line', source: worldSource(id), layout: spec.layout, paint: casing });
    }
    layers.push({ id: worldLayer(id), source: worldSource(id), ...spec });
  }
  return layers;
}

/**
 * The style for one World.
 *
 * @param {object} options
 * @param {object} options.world `{ id, bounds, bands?, geometry? }` — `bands`
 *   maps a band id to its baked image, `geometry` is `worldGeoJson()`'s answer.
 * @param {object|null} [options.palette] the Skin's paint pack (`mapPaint()`),
 *   plus the Overlay's own colour names. Anything it does not declare falls
 *   back to Park Midnight's.
 */
export function bandedWorldStyle({ world, palette = null }) {
  const { west, south, east, north } = world.bounds;
  // Clockwise from top-left, as MapLibre's image source takes it — and on the
  // World's truth bounds, which is ADR-0016's contract for a baked world.
  const coordinates = [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ];
  // Coarsest first: the table's order is the paint order, so a finer band
  // always sits over the parent standing in for it.
  const bands = BANDS.map((band) => band.id).filter(
    (id) => world.bands?.[id]?.image || world.bands?.[id]?.pmtiles,
  );
  const geometry = world.geometry ?? null;
  const drawsGeometry = WORLD_LAYERS.some(({ id }) => geometry?.[id]?.features?.length);
  if (bands.length === 0 && !drawsGeometry) {
    throw new Error(`world ${world.id} has nothing to draw: no band imagery and no Truth geometry`);
  }
  const colour = (name) => palette?.[name] ?? FALLBACK[name];

  return {
    version: 8,
    sources: {
      ...Object.fromEntries(
        WORLD_LAYERS.map(({ id }) => [
          worldSource(id),
          { type: 'geojson', data: geometry?.[id] ?? emptyCollection() },
        ]),
      ),
      ...Object.fromEntries(
        bands.map((id) => [
          bandSource(id),
          world.bands[id].pmtiles
            ? { type: 'raster', url: `pmtiles://${world.bands[id].pmtiles}` }
            : { type: 'image', url: world.bands[id].image, coordinates },
        ]),
      ),
      ...Object.fromEntries(
        Object.values(OVERLAY_SOURCES).map((id) => [
          id,
          // lineMetrics so a route can be painted walked-vs-remaining from its
          // own `fraction` property with line-gradient. Harmless on the point
          // collections, and one flag beats five source shapes.
          { type: 'geojson', lineMetrics: true, data: emptyCollection() },
        ]),
      ),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': colour('ground') } },
      ...worldLayers(geometry, colour),
      ...bands.map((id) => ({
        id: bandLayer(id),
        type: 'raster',
        source: bandSource(id),
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 200 },
      })),
      ...overlayLayers(colour),
    ],
  };
}
