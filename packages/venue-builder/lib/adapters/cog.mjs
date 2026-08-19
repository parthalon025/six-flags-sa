/**
 * Read a bbox-sized window out of a remote Cloud-Optimized GeoTIFF.
 *
 * Shared by every COG-backed adapter because they all hit the same trap, which
 * `esa-worldcover.mjs` paid for first and wrote down: geotiff's
 * `readRasters({ bbox })` resolves the box against the source's full pixel
 * grid and fans a small request out into hundreds of internal tile fetches,
 * which fall over under this environment's connection limits — while one
 * large range request against the same file is fine. Compute the pixel window
 * from the image's own origin and resolution and pass `{ window }` instead.
 *
 * Never pass `{ bbox }` to a remote COG read.
 */

/**
 * @param {object} image a geotiff GeoTIFFImage
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {number} [pad] extra pixels around the box, so bilinear sampling at
 *   the edge still has neighbours
 * @returns {Promise<{data: ArrayLike<number>, width: number, height: number,
 *   originX: number, originY: number, resX: number, resY: number,
 *   left: number, top: number}>}
 */
export async function readCogWindow(image, bounds, pad = 2) {
  const { north, south, east, west } = bounds;
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const absY = Math.abs(resY);

  const left = Math.max(0, Math.floor((west - originX) / resX) - pad);
  const right = Math.min(image.getWidth(), Math.ceil((east - originX) / resX) + pad);
  const top = Math.max(0, Math.floor((originY - north) / absY) - pad);
  const bottom = Math.min(image.getHeight(), Math.ceil((originY - south) / absY) + pad);
  if (!(right > left && bottom > top)) {
    throw new Error('bounds fall outside this tile');
  }

  const [data] = await image.readRasters({ window: [left, top, right, bottom] });
  return {
    data,
    width: right - left,
    height: bottom - top,
    originX,
    originY,
    resX,
    resY: absY,
    left,
    top,
  };
}

/**
 * Turn a window into a lat/lng sampler with bilinear interpolation.
 *
 * `noData` values (USGS uses a large negative sentinel for unflown ground)
 * come back as NaN rather than a cliff, so callers can decide whether a
 * partially covered venue is usable instead of silently rendering a canyon.
 *
 * @param {Awaited<ReturnType<typeof readCogWindow>>} win
 * @param {{ noData?: number }} [opts]
 * @returns {(lat: number, lng: number) => number}
 */
export function makeSampler(win, { noData = -999999 } = {}) {
  const { data, width, height, originX, originY, resX, resY, left, top } = win;
  const valid = (v) => Number.isFinite(v) && v > noData && v < 100000;
  const at = (col, row) => {
    const c = Math.min(width - 1, Math.max(0, col));
    const r = Math.min(height - 1, Math.max(0, row));
    const v = data[r * width + c];
    return valid(v) ? v : NaN;
  };
  return (lat, lng) => {
    const fx = (lng - originX) / resX - left;
    const fy = (originY - lat) / resY - top;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const z00 = at(x0, y0);
    const z10 = at(x0 + 1, y0);
    const z01 = at(x0, y0 + 1);
    const z11 = at(x0 + 1, y0 + 1);
    if (![z00, z10, z01, z11].every(Number.isFinite)) {
      // Partial nodata: fall back to whichever corner is real, else NaN.
      return [z00, z10, z01, z11].find(Number.isFinite) ?? NaN;
    }
    return (
      z00 * (1 - tx) * (1 - ty)
      + z10 * tx * (1 - ty)
      + z01 * (1 - tx) * ty
      + z11 * tx * ty
    );
  };
}
