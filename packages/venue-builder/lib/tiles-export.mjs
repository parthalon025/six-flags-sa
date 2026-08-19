/**
 * Export venue layers as GeoJSON for Tippecanoe (wrap adapter).
 *
 * Does not invoke tippecanoe — writes files and a shell recipe the maintainer
 * or CI can run when the binary is available.
 *
 * Way geometry comes from the shipped `map.json` contract: a ring `r` of
 * `[lng, lat]` pairs, not the `{lng, lat}` object shape once expected under
 * `p` (see `display-tiles.mjs`, which reads the same `r` ring for the
 * ADR-0013 display-pack pipeline).
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const LAYER_KEYS = ['path', 'building', 'water', 'coaster', 'slide', 'parking', 'pool'];

function wayToLine(way) {
  if (Array.isArray(way?.r) && way.r.length) {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: way.r },
      properties: { name: way.n || '', layer: way.layer || '' },
    };
  }
  // Fallback for any internal caller that still produces the pre-contract
  // `{lng, lat}` object shape under `p` instead of the shipped `r` rings.
  if (way?.p?.length) {
    return {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: way.p.map((pt) => [pt.lng, pt.lat]) },
      properties: { name: way.n || '', layer: way.layer || '' },
    };
  }
  return null;
}

function poiToPoint(poi) {
  if (!Number.isFinite(poi.lat)) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [poi.lng, poi.lat] },
    properties: { name: poi.n, category: poi.c },
  };
}

/**
 * @param {string} outDir absolute or relative directory
 * @param {object} map map.json body
 * @param {object[]} pois pois.json
 */
export function exportTileGeoJson(outDir, map = {}, pois = []) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  for (const key of LAYER_KEYS) {
    const ways = map[key] || [];
    const features = ways.map(wayToLine).filter(Boolean);
    if (!features.length) continue;
    const file = path.join(outDir, `${key}.geojson`);
    writeFileSync(file, `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`);
    written.push(file);
  }
  const places = pois.map(poiToPoint).filter(Boolean);
  if (places.length) {
    const file = path.join(outDir, 'places.geojson');
    writeFileSync(file, `${JSON.stringify({ type: 'FeatureCollection', features: places }, null, 2)}\n`);
    written.push(file);
  }
  const recipe = [
    '# Tippecanoe recipe (run when tippecanoe is installed)',
    'for f in *.geojson; do',
    '  tippecanoe -o "${f%.geojson}.mbtiles" -zg --drop-densest-as-needed "$f"',
    'done',
  ].join('\n');
  const recipePath = path.join(outDir, 'tippecanoe.sh');
  writeFileSync(recipePath, `${recipe}\n`);
  written.push(recipePath);
  return written;
}
