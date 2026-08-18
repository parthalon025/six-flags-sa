/**
 * ESA WorldCover — 10 m global land-cover classification (aerial evidence).
 * https://esa-worldcover.org/en/data-access
 *
 * CC BY 4.0, no API key, no rate limit: reads directly from the public
 * `esa-worldcover` S3 bucket's Cloud-Optimized GeoTIFFs over HTTP byte
 * ranges (via `geotiff`'s `fromUrl`) — never downloads a full ~3-15 MB tile
 * for one venue's bbox. Cross-checks the two highest-weight sources in the
 * entrance evidence table (park's own map=5, current aerial imagery=4): does
 * the classified land under a claim actually match what the claim implies?
 *
 * Class legend (ESA WorldCover v200, 11 classes):
 *   10 tree cover · 20 shrubland · 30 grassland · 40 cropland · 50 built-up
 *   60 bare/sparse vegetation · 70 snow/ice · 80 permanent water
 *   90 herbaceous wetland · 95 mangroves · 100 moss/lichen
 */

import { fromUrl } from 'geotiff';
import { cachePath, readCache, writeCache } from './_cache.mjs';

export const worldcoverCacheFile = (id) => cachePath(id, 'esa-worldcover');

export const CLASS_NAMES = {
  10: 'tree_cover',
  20: 'shrubland',
  30: 'grassland',
  40: 'cropland',
  50: 'built_up',
  60: 'bare_sparse_vegetation',
  70: 'snow_ice',
  80: 'permanent_water',
  90: 'herbaceous_wetland',
  95: 'mangroves',
  100: 'moss_lichen',
};

const TILE_BASE = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map';

/** WorldCover tiles are 3°×3°, named by their south-west corner. */
export function tileNameFor(lat, lng) {
  const tileLat = Math.floor(lat / 3) * 3;
  const tileLng = Math.floor(lng / 3) * 3;
  const ns = tileLat >= 0 ? 'N' : 'S';
  const ew = tileLng >= 0 ? 'E' : 'W';
  const latStr = String(Math.abs(tileLat)).padStart(2, '0');
  const lngStr = String(Math.abs(tileLng)).padStart(3, '0');
  return `ESA_WorldCover_10m_2021_v200_${ns}${latStr}${ew}${lngStr}_Map`;
}

export const tileUrlFor = (lat, lng) => `${TILE_BASE}/${tileNameFor(lat, lng)}.tif`;

/**
 * Read the land-cover class raster for a bbox via byte-range HTTP reads
 * (no full-tile download) and return a { class: pixelCount } histogram.
 */
export async function classHistogram(bounds, { openTiff = fromUrl } = {}) {
  const { north, south, east, west } = bounds;
  const centerLat = (north + south) / 2;
  const centerLng = (east + west) / 2;
  const tiff = await openTiff(tileUrlFor(centerLat, centerLng));
  const image = await tiff.getImage();

  // COG bbox-fetch trap, live-verified against this exact bucket: geotiff's
  // `readRasters({ bbox })` resolves against the source's full pixel grid and,
  // for a bbox this small against a 36000×36000 tile, fans out into ~1300
  // internal tile fetches that fail under this environment's connection
  // limits — even though a single large range request to the same file
  // succeeds fine. Any future COG source this repo reads (USGS 3DEP, other
  // GeoTIFF terrain data — see docs/research/2026-08-18-terrain-elevation-
  // ground-truth.md) will hit the same trap. Computing the pixel window
  // ourselves from the image's own origin/resolution and using
  // `readRasters({ window })` instead reads exactly the bytes this bbox
  // needs, in one request. Never pass `{ bbox }` to a remote COG read here.
  const [originX, originY] = image.getOrigin();
  const [resX, resY] = image.getResolution();
  const left = Math.floor((west - originX) / resX);
  const right = Math.ceil((east - originX) / resX);
  const top = Math.floor((originY - north) / Math.abs(resY));
  const bottom = Math.ceil((originY - south) / Math.abs(resY));

  const [data] = await image.readRasters({ window: [left, top, right, bottom] });

  const histogram = {};
  for (const value of data) {
    histogram[value] = (histogram[value] || 0) + 1;
  }
  return histogram;
}

/** Pure: histogram → the class with the most sampled pixels. */
export function dominantClass(histogram) {
  let best = null;
  let bestCount = -1;
  for (const [code, count] of Object.entries(histogram)) {
    if (count > bestCount) {
      best = Number(code);
      bestCount = count;
    }
  }
  return best === null ? null : { code: best, name: CLASS_NAMES[best] || `class_${best}`, count: bestCount };
}

/**
 * Pure: one venue-level `aerial` evidence claim summarising the dominant
 * land cover over the venue's bbox, anchored at its center. Metadata-level
 * corroboration (does this venue's classified ground look like a theme
 * park, not open water or bare terrain) — not a per-ride cross-check, which
 * would need a feature-type → expected-class mapping this adapter doesn't
 * have yet.
 */
export function worldcoverClaims(histogram, center, { date } = {}) {
  const dominant = dominantClass(histogram);
  if (!dominant || !center) return [];
  return [
    {
      source: 'aerial',
      kind: 'metadata',
      at: { lat: center.lat, lng: center.lng },
      date: date || new Date().toISOString().slice(0, 10),
      note: `ESA WorldCover: venue bbox classifies predominantly as ${dominant.name} (class ${dominant.code}).`,
    },
  ];
}

const hasBounds = (b) =>
  Number.isFinite(b?.north) && Number.isFinite(b?.south) && Number.isFinite(b?.east) && Number.isFinite(b?.west);
const hasCenter = (c) => Number.isFinite(c?.lat) && Number.isFinite(c?.lng);

export async function run(ctx = {}, { openTiff = fromUrl } = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'esa-worldcover', ok: false, error: 'venueId_required' };

  const cached = readCache(id, 'esa-worldcover');
  if (ctx.offline) {
    return {
      adapterId: 'esa-worldcover',
      ok: Boolean(cached?.histogram),
      claims: cached ? worldcoverClaims(cached.histogram, cached.center, { date: cached.fetched }) : [],
      data: cached,
    };
  }

  const bounds = ctx.bounds;
  const center = ctx.center;
  if (!hasBounds(bounds) || !hasCenter(center)) {
    const stub = cached || { histogram: null, error: 'Set ctx.bounds and ctx.center — both required to pick a tile and window.', gap: true };
    writeCache(id, 'esa-worldcover', stub);
    return { adapterId: 'esa-worldcover', ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
  }

  try {
    const histogram = await classHistogram(bounds, { openTiff });
    const out = {
      fetched: new Date().toISOString().slice(0, 10),
      source: 'esa-worldcover.org',
      license: 'CC BY 4.0',
      tile: tileNameFor(center.lat, center.lng),
      center,
      histogram,
      dominant: dominantClass(histogram),
    };
    writeCache(id, 'esa-worldcover', out);
    return {
      adapterId: 'esa-worldcover',
      ok: true,
      claims: worldcoverClaims(histogram, center, { date: out.fetched }),
      meta: { dominant: out.dominant, tile: out.tile },
      artifacts: [worldcoverCacheFile(id)],
      data: out,
    };
  } catch (err) {
    return { adapterId: 'esa-worldcover', ok: false, error: err.message };
  }
}
