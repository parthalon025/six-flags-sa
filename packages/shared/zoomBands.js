/** Zoom bands — the one table the builder and the phone both read.
 *
 * A World ships three baked bands (ADR-0019 clause 1). ADR-0021 clause 2 fixes
 * them in ground sample distance on power-of-two steps, so each band is exactly
 * 4x its neighbour and the parent-band placeholder always has a real parent to
 * upscale from.
 *
 * Nothing here touches the filesystem or a renderer: a caller passes in the
 * World's ground span, this answers in metres and pixels. See
 * docs/train-h-seams.md seam 1 for why the table lives in `shared`.
 */

/** Coarsest first — the order `parentOf` walks. */
export const BANDS = Object.freeze(
  [
    { id: 'overview', metresPerPixel: 2.4 },
    { id: 'mid', metresPerPixel: 0.6 },
    { id: 'close', metresPerPixel: 0.15 },
  ].map(Object.freeze),
);

function indexOfBand(id) {
  const i = BANDS.findIndex((b) => b.id === id);
  if (i < 0) throw new Error(`unknown band: ${id}`);
  return i;
}

/** Metres of ground per baked pixel, for a band. Constant across Worlds:
 *  ADR-0021 clause 2 fixes ground resolution rather than pixel dimensions, so a
 *  metre means the same thing at every park. */
export function bandResolution(id) {
  return BANDS[indexOfBand(id)].metresPerPixel;
}

/** The bake's pixel dimensions for a World of this ground span. Pixel size is
 *  what floats between Worlds — a bigger park is a bigger bake.
 *
 *  Only the coarsest band rounds. Every finer band is derived by doubling twice
 *  from its parent, so `bandPixels(child) === bandPixels(parent) * 4` exactly,
 *  for every World. Rounding each band on its own would drift by a pixel on any
 *  span that is not a round multiple of the resolution — a 1000 m span rounds
 *  to 417 at overview and 1667 at mid, and 417 * 4 is 1668. The tiler's
 *  parent-band placeholder upscales pixel-for-pixel, so a pixel of drift is a
 *  seam in the picture. The cost is that a band's realised resolution differs
 *  from its nominal one by up to half a cell of the coarsest band.
 *
 *  That is proportional to venue size, so "well under a tenth of a percent" —
 *  which this comment used to claim — holds for three of the four shipped
 *  venues and not for the smallest. Measured: kings-island 0.048% across and
 *  0.031% down, six-flags-fiesta-texas 0.065%/0.067%, cedar-point
 *  0.054%/0.007%, big-kahunas 0.137%/0.176%, because half a cell is a larger
 *  share of a 585 m park. The drift is identical at all three bands, which is
 *  the same fact from the other side: the 4x chain is exact, and the whole
 *  error is the coarsest band rounding to a whole cell.
 *  test/builder/display-bands.mjs asserts the half-cell bound rather than a
 *  percentage, so it holds at any venue size and tightens as a venue grows. */
export function bandPixels(id, { spanXMetres, spanYMetres }) {
  const coarsest = BANDS[0].metresPerPixel;
  const scale = Math.round(coarsest / bandResolution(id));
  return {
    width: Math.round(spanXMetres / coarsest) * scale,
    height: Math.round(spanYMetres / coarsest) * scale,
  };
}

/** Ground metres per screen pixel in Web Mercator. MapLibre zoom counts 512 px
 *  tiles, so its zoom z has the density of slippy zoom z + 1. */
const EQUATOR_METRES_PER_PIXEL = 156543.03392804097;

/** Web Mercator is only defined to about this latitude — past it the
 *  projection runs away, and past 90 the cosine turns negative, which would
 *  hand `NaN` to whatever asked. Clamp rather than extrapolate. */
export const MAX_MERCATOR_LATITUDE = 85.051129;

/** The cosine every resolution here scales by. One definition, so the two
 *  callers cannot drift if the projection maths ever changes. */
function mercatorCosLatitude(latitude) {
  if (!Number.isFinite(latitude)) throw new Error(`latitude must be a finite number: ${latitude}`);
  const clamped = Math.min(MAX_MERCATOR_LATITUDE, Math.max(-MAX_MERCATOR_LATITUDE, latitude));
  return Math.cos((clamped * Math.PI) / 180);
}

function screenResolution(zoom, latitude) {
  return (EQUATOR_METRES_PER_PIXEL * mercatorCosLatitude(latitude)) / 2 ** (zoom + 1);
}

/** The band a camera at this zoom should draw.
 *
 *  Mip selection: the coarsest band that is not itself coarser than the screen,
 *  so a band is never magnified while a sharper one would have fit. Past the
 *  finest band there is nothing sharper to pick, so `close` is magnified —
 *  which is the placeholder path, not a failure.
 */
export function bandForZoom(zoom, { latitude = 0 } = {}) {
  const screen = screenResolution(zoom, latitude);
  const fit = BANDS.find((b) => b.metresPerPixel <= screen);
  return (fit ?? BANDS[BANDS.length - 1]).id;
}

/** The zooms at which `bandForZoom` changes its answer, coarsest boundary
 *  first — one fewer than there are bands.
 *
 *  These move with latitude, because Mercator pixels cover less ground away
 *  from the equator. ADR-0021 clause 4 requires the camera's pitch ease not to
 *  overlap one, so the camera has to ask rather than hardcode a zoom range.
 */
export function bandBoundaryZooms({ latitude = 0 } = {}) {
  const cos = mercatorCosLatitude(latitude);
  // Invert screenResolution: the zoom at which a screen pixel covers exactly
  // this band's metres. Below it the band is coarser than the screen.
  return BANDS.slice(0, -1).map((band) =>
    Math.log2((EQUATOR_METRES_PER_PIXEL * cos) / band.metresPerPixel) - 1,
  );
}

/** The band a placeholder upscales from, or null at the coarsest band. */
export function parentOf(id) {
  const i = indexOfBand(id);
  return i === 0 ? null : BANDS[i - 1].id;
}
