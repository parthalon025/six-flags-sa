/**
 * The MapLibre style a banded World draws through.
 *
 * Pure data: a World's bounds and the bands it has bytes for become sources and
 * layers, in the shared band table's own order. No renderer import, so the one
 * part of the MapLibre adapter that holds a decision — which layer sits over
 * which, and what starts hidden — can be asserted without a browser.
 *
 * Every band layer starts hidden. Which of them is drawn is the band plan's
 * answer (lib/bandPlan.js, through lib/mapView.js) and arrives as a visibility
 * change rather than as a restyle: ADR-0021 clause 4 wants content ramping in
 * across a crossfade, and a style swap mid-pinch is the opposite of that.
 */
import { BANDS } from '@party-tracker/shared/zoomBands.js';

/** Source and layer ids, so the adapter and this file cannot drift. */
export const bandSource = (id) => `band-${id}`;
export const bandLayer = (id) => `band-${id}`;
export const OVERLAY_SOURCES = Object.freeze({
  members: 'overlay-members',
  nodes: 'overlay-nodes',
  route: 'overlay-route',
});
export const PLACES_SOURCE = 'places';

export const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });

/** Marks as GeoJSON points.
 *
 *  Two things this pins. Coordinates are lng-then-lat, which is GeoJSON's
 *  order and the reverse of how every position in this app is written in
 *  prose. And only scalars ride along as feature properties: MapLibre ships
 *  them to its worker, and a Place carries nested rows — height rules, facts —
 *  that have no business being serialised onto every frame. */
export function pointCollection(marks) {
  const scalars = (mark) =>
    Object.fromEntries(
      Object.entries(mark).filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v)),
    );
  return {
    type: 'FeatureCollection',
    features: marks.map((mark) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [mark.lng, mark.lat] },
      // An Overlay mark is identified by `id`, a Place by pois.json's `i`. The
      // renderer should not have to know which kind it is holding.
      properties: { ...scalars(mark), id: mark.id ?? mark.i },
    })),
  };
}

/** A route as one GeoJSON line, or nothing. A LineString of a single
 *  coordinate is invalid GeoJSON, which MapLibre answers with a style error
 *  rather than with an empty map. */
export function lineCollection(points) {
  if (points.length < 2) return emptyCollection();
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
        properties: {},
      },
    ],
  };
}

/** Defaults for a World whose Skin has not declared these. Dark ground and a
 *  legible route, which is what the dev preview has always drawn. */
const FALLBACK = Object.freeze({
  ground: '#0d1b22',
  route: '#4fc3f7',
  place: '#f4511e',
  quest: '#ffca28',
  member: '#7c4dff',
});

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
  const bands = BANDS.map((band) => band.id).filter((id) => world.bands?.[id]?.image);
  if (bands.length === 0) {
    throw new Error(`world ${world.id} declares no band imagery to draw`);
  }
  const colour = (name) => palette?.[name] ?? FALLBACK[name];

  return {
    version: 8,
    sources: {
      ...Object.fromEntries(
        bands.map((id) => [
          bandSource(id),
          { type: 'image', url: world.bands[id].image, coordinates },
        ]),
      ),
      ...Object.fromEntries(
        [...Object.values(OVERLAY_SOURCES), PLACES_SOURCE].map((id) => [
          id,
          { type: 'geojson', data: emptyCollection() },
        ]),
      ),
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': colour('ground') } },
      ...bands.map((id) => ({
        id: bandLayer(id),
        type: 'raster',
        source: bandSource(id),
        layout: { visibility: 'none' },
        paint: { 'raster-fade-duration': 200 },
      })),
      {
        id: OVERLAY_SOURCES.route,
        type: 'line',
        source: OVERLAY_SOURCES.route,
        paint: { 'line-color': colour('route'), 'line-width': 4 },
      },
      {
        id: PLACES_SOURCE,
        type: 'circle',
        source: PLACES_SOURCE,
        paint: {
          'circle-radius': 5,
          'circle-color': colour('place'),
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      },
      {
        id: OVERLAY_SOURCES.nodes,
        type: 'circle',
        source: OVERLAY_SOURCES.nodes,
        paint: { 'circle-radius': 6, 'circle-color': colour('quest') },
      },
      {
        id: OVERLAY_SOURCES.members,
        type: 'circle',
        source: OVERLAY_SOURCES.members,
        paint: {
          'circle-radius': 7,
          'circle-color': colour('member'),
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      },
    ],
  };
}
