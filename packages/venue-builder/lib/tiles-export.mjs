/**
 * Export venue layers as GeoJSON for Tippecanoe (wrap adapter).
 *
 * Writes per-layer GeoJSON plus a shell recipe, then runs tippecanoe when the
 * binary is on PATH (same flags as the recipe). The display pipeline's own
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
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tippecanoeAvailable } from './display-tiles.mjs';

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

function defaultTippecanoeRun(outFile, geojson) {
  return spawnSync(
    'tippecanoe',
    ['-o', outFile, '-zg', '--drop-densest-as-needed', geojson],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

/**
 * Run tippecanoe over each GeoJSON layer file, matching tippecanoe.sh flags.
 * Returns { ok, gap?, reason?, mbtiles } — never throws for a missing binary.
 *
 * @param {{ isAvailable?: () => boolean, runLayer?: (outFile: string, geojson: string) => { status: number | null, stderr?: Buffer | string } }} [hooks]
 *   Test-only overrides for binary presence and per-layer invocation.
 */
export function runTippecanoePerLayer(outDir, geojsonFiles = [], hooks = {}) {
  const isAvailable = hooks.isAvailable ?? tippecanoeAvailable;
  const runLayer = hooks.runLayer ?? defaultTippecanoeRun;

  if (!geojsonFiles.length) {
    return { ok: true, mbtiles: [] };
  }
  if (!isAvailable()) {
    return {
      ok: false,
      gap: true,
      reason: 'tippecanoe not installed — GeoJSON + tippecanoe.sh recipe written; run it to build .mbtiles',
      mbtiles: [],
    };
  }
  const mbtiles = [];
  for (const geojson of geojsonFiles) {
    const base = path.basename(geojson, '.geojson');
    const outFile = path.join(outDir, `${base}.mbtiles`);
    const res = runLayer(outFile, geojson);
    if (res.status !== 0) {
      return {
        ok: false,
        reason: `tippecanoe exited ${res.status} on ${base}: ${String(res.stderr || '').slice(0, 300)}`,
        mbtiles,
      };
    }
    if (existsSync(outFile)) mbtiles.push(outFile);
  }
  return { ok: true, mbtiles };
}

/**
 * @param {string} outDir absolute or relative directory
 * @param {object} map map.json body
 * @param {object[]} pois pois.json
 * @returns {{ files: string[], tiles: ReturnType<typeof runTippecanoePerLayer> }}
 */
export function exportTileGeoJson(outDir, map = {}, pois = []) {
  mkdirSync(outDir, { recursive: true });
  const written = [];
  const geojsonFiles = [];
  for (const key of LAYER_KEYS) {
    const ways = map[key] || [];
    const features = ways.map((w) => wayToFeature(w, key)).filter(Boolean);
    if (!features.length) continue;
    const file = path.join(outDir, `${key}.geojson`);
    writeFileSync(file, `${JSON.stringify({ type: 'FeatureCollection', features }, null, 2)}\n`);
    written.push(file);
    geojsonFiles.push(file);
  }
  const places = pois.map(poiToPoint).filter(Boolean);
  if (places.length) {
    const file = path.join(outDir, 'places.geojson');
    writeFileSync(file, `${JSON.stringify({ type: 'FeatureCollection', features: places }, null, 2)}\n`);
    written.push(file);
    geojsonFiles.push(file);
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
  const tiles = runTippecanoePerLayer(outDir, geojsonFiles);
  if (tiles.mbtiles?.length) written.push(...tiles.mbtiles);
  return { files: written, tiles };
}
