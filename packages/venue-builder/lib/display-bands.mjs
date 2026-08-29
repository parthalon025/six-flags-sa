/** Band bake plans — what the painter needs to draw one band of one World.
 *
 * ADR-0021 clause 2 specifies bands in ground sample distance: overview
 * 2.4 m/px, mid 0.6, close 0.15, each exactly 4x its neighbour. The shared
 * table in `packages/shared/zoomBands.js` answers "how many pixels for a World
 * of this ground span", and the phone reads it too. This module is the only
 * place that answers "what ground span does this venue have", and it answers it
 * the way the painter's own projector does.
 *
 * That is the whole reason it exists. `bandPixels` takes a span from its caller
 * and knows nothing about projection. The projector carries its own constants —
 * 111320·cos(lat) metres per degree of longitude, 110574 per degree of latitude.
 * A caller who reaches for a spherical earth radius instead gets kings-island's
 * north-south span as 1280.6 m rather than 1272.0, and asks for a close band of
 * 10336x8544 while the bake emits 10336x8480. Nothing errors; the table and the
 * picture simply describe different worlds. One owner for the span closes it.
 *
 * A plan carries `tileMetres` rather than a column count, and that is also
 * forced rather than chosen. The projector divides both axes by a single
 * `tileMetres` derived from an integer `maxCols`, while `bandPixels` rounds each
 * axis independently against the nominal resolution. For six-flags-fiesta-texas
 * those two cannot be reconciled: the plan needs `tileMetres` in
 * (2.39949, 2.40001], and `maxCols` 704 yields 2.3977 while 703 yields 2.4011.
 * No integer lands inside. `test/builder/display-bands.mjs` pins that.
 */
import { BANDS, bandPixels, bandResolution } from '@party-tracker/shared/zoomBands.js';

/** Metres per degree, as `display-bake.mjs`'s projector measures them. Kept
 *  here so the two cannot drift; the projector reads them from this module. */
export const METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR = 111320;
export const METRES_PER_DEGREE_LATITUDE = 110574;

/** The canvas ceiling a bake plan must stay under, per axis.
 *
 *  `bin/display-bake.mjs` paints into ONE `<canvas>` in headless Chromium
 *  (`display-bake-page.html`: `c.width = cols * px`), so emitted width and
 *  height ARE the canvas dimensions. Ask a canvas for more than the browser
 *  will give and nothing throws — the element clamps or the context is lost,
 *  and the bake writes a blank or truncated PNG that still passes downstream
 *  shape checks. Plan time is the only place the failure can be loud.
 *
 *  Source: Chrome's measured caps are 32767 px per axis and 268,435,456 px of
 *  area. The number below is the tighter 16384 — Skia's maximum texture
 *  dimension. It also subsumes the area cap: 16384 * 16384 = 268,435,456
 *  exactly, so one per-axis check is the whole ceiling.
 */
export const CANVAS_MAX_AXIS_PX = 16384;

/** Refuse a canvas larger than {@link CANVAS_MAX_AXIS_PX} on either axis. */
export function refuseOverCeilingCanvas(width, height, label) {
  if (width > CANVAS_MAX_AXIS_PX || height > CANVAS_MAX_AXIS_PX) {
    throw new Error(
      `${label} plans ${width}x${height} px `
        + `(${(width * height / 1e6).toFixed(0)} Mpx), past the ${CANVAS_MAX_AXIS_PX} px canvas ceiling — `
        + 'the bake would emit a blank or truncated picture rather than fail',
    );
  }
}

function readBounds(mapMeta) {
  const b = mapMeta?.bounds ?? mapMeta?.meta?.bounds ?? {};
  const north = b.n ?? b.north;
  const south = b.s ?? b.south;
  const east = b.e ?? b.east;
  const west = b.w ?? b.west;
  if (![north, south, east, west].every(Number.isFinite)) {
    throw new Error('map bounds must carry finite n/s/e/w or north/south/east/west');
  }
  return { north, south, east, west };
}

/** The venue's ground span in metres, by the painter's own reckoning.
 *
 *  Accepts either a `map.meta` or a whole `map` — callers hold both shapes and
 *  the difference is not worth a second function. */
export function venueSpanMetres(mapMeta) {
  const { north, south, east, west } = readBounds(mapMeta);
  const latMid = (north + south) / 2;
  const mPerLng = METRES_PER_DEGREE_LONGITUDE_AT_EQUATOR * Math.cos((latMid * Math.PI) / 180);
  return {
    spanXMetres: (east - west) * mPerLng,
    spanYMetres: (north - south) * METRES_PER_DEGREE_LATITUDE,
    metresPerDegreeLongitude: mPerLng,
    metresPerDegreeLatitude: METRES_PER_DEGREE_LATITUDE,
  };
}

/** How to bake one band of one World.
 *
 *  `cols`/`rows` are the cell grid; `px` is how many pixels a cell occupies at
 *  this band, so `width === cols * px`. `tileMetres` is what the projector must
 *  divide by to land on that grid — pass it through rather than re-deriving it
 *  from a column count, which cannot always be done (see the module note).
 */
export function bandBakePlan(mapMeta, bandId) {
  const metresPerPixel = bandResolution(bandId); // throws on an unknown band
  const span = venueSpanMetres(mapMeta);
  const { width, height } = bandPixels(bandId, span);
  refuseOverCeilingCanvas(width, height, `band ${bandId}`);

  // The cell grid is the coarsest band's pixel grid: one cell, one pixel at
  // 2.4 m/px. Finer bands draw the same cells larger rather than adding cells,
  // which is what keeps the 4x chain exact and every band on one geometry.
  const coarsest = bandPixels(BANDS[0].id, span);
  const px = Math.round(BANDS[0].metresPerPixel / metresPerPixel);

  // One tileMetres that rounds to both axes. The window is bounded by the
  // half-pixel either side of each axis' target; its midpoint is the most
  // tolerant point in it.
  const lo = Math.max(
    span.spanXMetres / (coarsest.width + 0.5),
    span.spanYMetres / (coarsest.height + 0.5),
  );
  const hi = Math.min(
    span.spanXMetres / Math.max(0.5, coarsest.width - 0.5),
    span.spanYMetres / Math.max(0.5, coarsest.height - 0.5),
  );
  if (!(hi > lo)) {
    throw new Error(
      `no tileMetres rounds to ${coarsest.width}x${coarsest.height} for this venue `
        + `(window ${lo.toFixed(5)}..${hi.toFixed(5)}) — the band table and the projector `
        + 'cannot both be satisfied, which is a bug in one of them',
    );
  }
  const tileMetres = (lo + hi) / 2;

  return Object.freeze({
    bandId,
    metresPerPixel,
    width,
    height,
    cols: coarsest.width,
    rows: coarsest.height,
    px,
    tileMetres,
    spanXMetres: span.spanXMetres,
    spanYMetres: span.spanYMetres,
  });
}

/** Every band for this World, coarsest first — the order a pyramid is built
 *  and the order `parentOf` walks. */
export function bandPlansFor(mapMeta) {
  return BANDS.map((band) => bandBakePlan(mapMeta, band.id));
}
