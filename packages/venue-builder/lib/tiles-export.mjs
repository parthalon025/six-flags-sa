/**
 * Export venue layers as GeoJSON for Tippecanoe (wrap adapter).
 *
 * Does not invoke tippecanoe — writes files and a shell recipe the maintainer
 * or CI can run when the binary is available. The display pipeline's own
 * exporter (`display-tiles.mjs`) supersedes this for pack building; this one
 * survives because `adapters/runner.mjs` and `bin/attractions.mjs` still use
 * it for ad-hoc inspection.
 *
 * It read `way.p` shaped `[{lng, lat}]` until 2026-08-18. Shipped bundles have
 * never stored that: ways carry `r` as `[[lng, lat]]` pairs. Every feature it
 * produced was therefore `null` and every layer file it wrote was empty, which
 * nothing noticed because nothing tested it and the tiles path was never run.
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const LAYER_KEYS = ['path', 'building', 'water', 'coaster', 'slide', 'parking', 'pool'];

/** Layers whose rings are closed areas rather than open lines. */
const AREA_KEYS = new Set(['building', 'water', 'parking', 'pool']);

/**
 * One way → a GeoJSON feature. Accepts the shipped `r` form and the legacy
 * `p` form, so a caller holding an older in-memory shape still works.
 */
function wayToFeature(way, key) {
  const ring = Array.isArray(way?.r) && way.r.length
    ? way.r.map((pt) => (Array.isArray(pt) ? [pt[0], pt[1]] : [pt.lng, pt.lat]))
    : (way?.p || []).map((pt) => (Array.isArray(pt) ? [pt[0], pt[1]] : [pt.lng, pt.lat]));
  if (ring.length < 2) return null;
  const properties = { name: way.n || '', layer: way.layer || '' };
  if (!AREA_KEYS.has(key)) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties };
  }
  const closed = ring.length >= 3
    ? (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring : [...ring, ring[0]])
    : null;
  if (!closed) return null;
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties };
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
    const features = ways.map((w) => wayToFeature(w, key)).filter(Boolean);
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
