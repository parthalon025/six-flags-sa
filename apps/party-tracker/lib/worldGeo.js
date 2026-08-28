/**
 * The World's static geometry, as GeoJSON.
 *
 * ADR-0019 clause 3 makes MapLibre *the* map view, which retires the SVG world
 * viewer ParkMap.jsx has drawn since ADR-0016 slice 2. This is the base-map
 * half of that move: the rings a venue's `map.json` ships — the midway, the
 * lake, the buildings, the coaster track — stop being `<path d="M…">` strings
 * projected by hand and become FeatureCollections the engine projects itself.
 * `overlayGeo.js` is the same move for the live Overlay; between them they are
 * the whole of what the SVG renderer used to draw.
 *
 * Pure. No DOM, no map handle, no clock. That is what lets the paint order and
 * the coordinate rules below be asserted without a browser, and it is why this
 * is a module rather than a `useMemo` inside the component.
 *
 * Two rules, and they are the same two `overlayGeo.js` states, because they are
 * the two ways map data goes quietly wrong:
 *
 *   1. GeoJSON is lng-first — and so, unusually for this app, is `map.json`:
 *      the builder writes rings as `[lng, lat]` pairs already. Everything
 *      *else* in the app is lat-first, so the temptation is to swap here. Do
 *      not: the pass-through is the correct conversion, and the suite pins it.
 *   2. A coordinate that is not two finite numbers is dropped, and for a ring
 *      the whole ring goes with it. `p[0] || 0` puts a vertex on the prime
 *      meridian; dropping just the bad vertex is worse still, because it
 *      silently reshapes the polygon into a different, plausible, wrong one.
 *
 * The vector tier this feeds is ADR-0019's never-fails fallback: it draws from
 * Truth under every Skin, with no baked band and no network, which is why a
 * World whose `map.json` has not arrived yet answers with empty collections
 * rather than throwing.
 */

import { WAY_FLAGS, hasWayFlag } from '@party-tracker/shared/wayFlags.js';

/**
 * The World's layers, bottom to top. The order *is* the paint order, and it is
 * the order the SVG renderer painted its groups in — sea, then park, then the
 * district tints, then ground cover, then water, then the ways, then what
 * stands on them, then what flies over them.
 *
 * `geometry` decides how a ring is read. A polygon ring is closed and needs
 * three distinct corners; a line is left open and needs two positions. Reading
 * a walkway as a polygon fills the loop it makes.
 */
export const WORLD_LAYERS = Object.freeze([
  { id: 'sea', geometry: 'polygon' },
  { id: 'park', geometry: 'polygon' },
  { id: 'lands', geometry: 'polygon' },
  { id: 'wood', geometry: 'polygon' },
  { id: 'grass', geometry: 'polygon' },
  { id: 'parking', geometry: 'polygon' },
  { id: 'water', geometry: 'polygon' },
  { id: 'pool', geometry: 'polygon' },
  { id: 'boundary', geometry: 'polygon' },
  { id: 'service', geometry: 'line' },
  { id: 'path', geometry: 'line' },
  { id: 'building', geometry: 'polygon' },
  { id: 'slide', geometry: 'line' },
  { id: 'coaster', geometry: 'line' },
].map(Object.freeze));

const collection = (features) => ({ type: 'FeatureCollection', features });

/** A `[lng, lat]` pair as a GeoJSON position, or null if it is not one.
 *
 *  The range check is not belt-and-braces. MapLibre wraps a longitude past 180
 *  rather than complaining, so a lat/lng pair written the wrong way round draws
 *  a plausible-looking ghost somewhere else in the world instead of an error. */
function position(pair) {
  if (!Array.isArray(pair)) return null;
  const [lng, lat] = pair;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

/** A ring of positions, or null if any one of them is not a position. */
function ring(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const pair of raw) {
    const point = position(pair);
    if (!point) return null;
    out.push(point);
  }
  return out;
}

/** A linear ring, closed. GeoJSON repeats the first position at the end;
 *  `map.json` does not store the repeat, and a ring that already carries one
 *  must not get a second — a zero-length segment is what makes an outline
 *  flicker along its seam. */
function closedRing(points) {
  const [first] = points;
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

/** A row's ring. Rows are `{ r, n }`, except where the builder wrote a bare
 *  ring — which `boundary` is, and which ParkMap.jsx used to unwrap at the
 *  call site. */
const ringOf = (row) => (Array.isArray(row) ? row : row?.r);

/** Is this layer value one bare ring rather than a list of rows? True when its
 *  first element is itself a coordinate pair. `boundary` is the case that
 *  matters: read as a list of rows it becomes one two-element "ring" per
 *  corner of the park. */
function isBareRing(value) {
  const [first] = value;
  return Array.isArray(first) && first.length === 2 && typeof first[0] === 'number';
}

function featureFor(layer, row, index) {
  const points = ring(ringOf(row));
  if (!points) return null;

  const polygon = layer.geometry === 'polygon';
  // Three distinct corners is the least a polygon can be; two positions is the
  // least a line can be. Below that MapLibre draws nothing and says nothing.
  if (points.length < (polygon ? 3 : 2)) return null;

  const id = `${layer.id}-${row?.i ?? index}`;
  return {
    type: 'Feature',
    id,
    geometry: polygon
      ? { type: 'Polygon', coordinates: [closedRing(points)] }
      : { type: 'LineString', coordinates: points },
    // `id` is mirrored into the properties because a geojson source only
    // exposes an id to a filter or to feature-state through a property.
    properties: {
      id,
      layer: layer.id,
      name: typeof row?.n === 'string' && row.n ? row.n : null,
      /* Back of house, from the way's own flags. Carried into the style so a
         park-wide read can drop the service corridors a guest cannot walk
         down — the one honest tier this data has, since footpaths have no
         road class to rank them by. `absent is not false` (wayFlags.js): a
         way with no `f` is one nobody recorded this about, and it is drawn. */
      restricted: hasWayFlag(row?.f, WAY_FLAGS.RESTRICTED),
    },
  };
}

/**
 * Build a World's static geometry as one FeatureCollection per layer.
 *
 * Every layer in `WORLD_LAYERS` is always present, even where the venue has
 * none of it: a MapLibre geojson source is added once and fed with `setData`
 * from then on, so a key that disappeared when its list emptied would leave
 * the previous World's geometry on screen with nothing left to clear it.
 *
 * @param {object|null} map a venue's `map.json` — `{ sea, park, lands, … }`,
 *   each a list of `{ r: [[lng, lat], …], n? }` rows (or, for `boundary`, one
 *   bare ring). Keys that are not layers — `meta`, `landAnchors` — are ignored.
 * @returns {Record<string, {type: 'FeatureCollection', features: object[]}>}
 */
export function worldGeoJson(map) {
  const out = {};
  for (const layer of WORLD_LAYERS) {
    const value = map?.[layer.id];
    const rows = !Array.isArray(value) || value.length === 0
      ? []
      : (isBareRing(value) ? [value] : value);
    const features = [];
    rows.forEach((row, index) => {
      const feature = featureFor(layer, row, index);
      if (feature) features.push(feature);
    });
    out[layer.id] = collection(features);
  }
  return out;
}
