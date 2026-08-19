/**
 * USGS 3DEP — bare-earth elevation for US venues (Display layer).
 *
 * Public domain, "free of charge and without use restrictions", no API key,
 * served as Cloud-Optimized GeoTIFF from the `prd-tnm` S3 bucket and read here
 * over HTTP byte ranges.
 *
 * Why this and not a global 30 m DEM: a bake grid is 2.8-8.0 m per cell, so a
 * 30 m posting is coarser than the thing it paints and every value between
 * posts is interpolation, not measurement. Worse, SRTM and Copernicus are
 * radar surface models — over a park at 30 m one sample blends tree canopy,
 * rooflines and coaster structure, so it reports "terrain" on top of a ride.
 * 3DEP's lidar-derived products are the only true bare-earth DTM of the four
 * candidates, and at 1/3 arc-second (~10 m) it is the same order as the grid.
 *
 * Resolution note: the 1 m seamless collection (`S1M/`) exists but is tiled on
 * a projected scheme whose names cannot be derived from lat/lng without the
 * bucket's own spatial-metadata index. Rather than guess a path, a venue may
 * pin an explicit 1 m tile URL in `sources.json` (`datasets.terrain.url`) and
 * this adapter will use it verbatim.
 */

import { fromUrl } from 'geotiff';
import { readCogWindow, makeSampler } from './cog.mjs';

export const ID = 'usgs-3dep';
export const LICENSE = 'public-domain';
export const RESOLUTION_M = 10;

const BASE = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current';

/**
 * 1/3 arc-second tiles are named by their NORTH-WEST corner: latitude rounded
 * up, longitude magnitude rounded up. 39.34N/-84.27W lives in `n40w085`.
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export function tileNameFor(lat, lng) {
  const ns = lat >= 0 ? 'n' : 's';
  const ew = lng >= 0 ? 'e' : 'w';
  const latDeg = Math.ceil(Math.abs(lat));
  const lngDeg = Math.ceil(Math.abs(lng));
  return `${ns}${String(latDeg).padStart(2, '0')}${ew}${String(lngDeg).padStart(3, '0')}`;
}

export const tileUrlFor = (lat, lng) => {
  const t = tileNameFor(lat, lng);
  return `${BASE}/${t}/USGS_13_${t}.tif`;
};

/**
 * Elevation sampler over a venue bbox, or null when 3DEP does not cover it.
 *
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {{ openTiff?: Function, url?: string }} [opts] `url` pins an explicit
 *   tile (e.g. a 1 m S1M tile) instead of deriving the 10 m one.
 * @returns {Promise<{sample: Function, resolution: number, source: string, url: string}|null>}
 */
export async function elevationSampler(bounds, { openTiff = fromUrl, url } = {}) {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const target = url || tileUrlFor(centerLat, centerLng);
  try {
    const tiff = await openTiff(target);
    const image = await tiff.getImage();
    const win = await readCogWindow(image, bounds);
    const [resX] = image.getResolution();
    // Degrees → metres at this latitude, so the caller can compare sources.
    const metres = Math.abs(resX) * 111320 * Math.cos((centerLat * Math.PI) / 180);
    return {
      sample: makeSampler(win),
      resolution: url ? Math.round(metres * 100) / 100 : RESOLUTION_M,
      source: ID,
      url: target,
    };
  } catch (err) {
    // "No coverage" and "the read broke" both end as flat ground, so the
    // reason has to survive or a transient failure is indistinguishable from
    // a venue that genuinely has no DEM.
    console.warn(`usgs-3dep: no elevation for this bbox (${err.message})`);
    return null;
  }
}
