/**
 * Copernicus DEM GLO-30 — the international fallback (Display layer).
 *
 * Free worldwide 30 m coverage with no key, read from the public
 * `copernicus-dem-30m` S3 bucket as Cloud-Optimized GeoTIFF.
 *
 * Used only where 3DEP has not flown, and the reason it is second choice is
 * worth keeping next to the code: its producer calls the source an "edited
 * DSM". Radar reflects off the first thing it meets, so canopy and rooflines
 * are inside the surface. At 30 m over a 600 m park that is a handful of
 * samples, each mixing ground with whatever stands on it. It is enough for a
 * broad hillshade on hilly terrain and it is not enough to sculpt anything, so
 * the resolver records which source a venue got and the certification carries
 * it forward rather than letting a 30 m DSM pass as ground truth.
 */

import { fromUrl } from 'geotiff';
import { readCogWindow, makeSampler } from './cog.mjs';

export const ID = 'copernicus-dem';
export const LICENSE = 'copernicus-free';
export const RESOLUTION_M = 30;

const BASE = 'https://copernicus-dem-30m.s3.amazonaws.com';

/**
 * GLO-30 tiles are named by their SOUTH-WEST corner, on whole degrees.
 * 39.34N/-84.27W lives in `N39_00_W085_00`.
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export function tileNameFor(lat, lng) {
  const latDeg = Math.floor(lat);
  const lngDeg = Math.floor(lng);
  const ns = latDeg >= 0 ? 'N' : 'S';
  const ew = lngDeg >= 0 ? 'E' : 'W';
  const la = String(Math.abs(latDeg)).padStart(2, '0');
  const lo = String(Math.abs(lngDeg)).padStart(3, '0');
  return `${ns}${la}_00_${ew}${lo}_00`;
}

export const tileUrlFor = (lat, lng) => {
  const t = tileNameFor(lat, lng);
  return `${BASE}/Copernicus_DSM_COG_10_${t}_DEM/Copernicus_DSM_COG_10_${t}_DEM.tif`;
};

/**
 * @param {{north:number,south:number,east:number,west:number}} bounds
 * @param {{ openTiff?: Function }} [opts]
 * @returns {Promise<{sample: Function, resolution: number, source: string, url: string}|null>}
 */
export async function elevationSampler(bounds, { openTiff = fromUrl } = {}) {
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const target = tileUrlFor(centerLat, centerLng);
  try {
    const tiff = await openTiff(target);
    const image = await tiff.getImage();
    const win = await readCogWindow(image, bounds);
    return {
      sample: makeSampler(win),
      resolution: RESOLUTION_M,
      source: ID,
      url: target,
      surfaceModel: true,
    };
  } catch (err) {
    // "No coverage" and "the read broke" both end as flat ground, so the
    // reason has to survive or a transient failure is indistinguishable from
    // a venue that genuinely has no DEM.
    console.warn(`copernicus-dem: no elevation for this bbox (${err.message})`);
    return null;
  }
}
