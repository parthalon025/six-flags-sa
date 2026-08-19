/**
 * Display tiles — GeoJSON export from the shipped contract + Tippecanoe wrap.
 *
 * Truth in (`map.json` rings `r: [[lng,lat],…]`, `pois.json` points), vector
 * tiles out (`base.pmtiles`, one source-layer per map layer). Tippecanoe stays
 * an external binary per the adapter principles — wrap, don't fork. When it is
 * not installed the export still writes GeoJSON plus a shell recipe, and the
 * caller records the gap instead of guessing.
 *
 * Supersedes the `way.p` shape in `tiles-export.mjs` (which predates the
 * on-disk contract); the tiles produced here feed ADR-0013's display packs.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { LAYERS, LINE_LAYERS } from './osm-tags.mjs';

/** Ring layers become Polygons; LINE_LAYERS stay open LineStrings. */
function featureFrom(layer, way) {
  const ring = way?.r;
  if (!Array.isArray(ring) || ring.length < 2) return null;
  const properties = { name: way.n || '' };
  if (LINE_LAYERS.has(layer)) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties };
  }
  if (ring.length < 3) return null;
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring
    : [...ring, ring[0]];
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [closed] }, properties };
}

/**
 * Pure: shipped bundle → one FeatureCollection per non-empty layer, plus
 * `places` points. Property surface is name/key/category only — geometry and
 * naming stay exactly what truth carries.
 */
export function displayGeoJson(map, pois = []) {
  const layers = {};
  const outline = featureFrom('boundary', { r: map.boundary });
  if (outline) layers.venue = { type: 'FeatureCollection', features: [outline] };
  for (const layer of LAYERS) {
    const features = (map[layer] || []).map((w) => featureFrom(layer, w)).filter(Boolean);
    if (features.length) layers[layer] = { type: 'FeatureCollection', features };
  }
  const places = pois
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { key: p.i || '', name: p.n || '', category: p.c || '', land: p.a || '' },
    }));
  if (places.length) layers.places = { type: 'FeatureCollection', features: places };
  return layers;
}

/** Write the export and a runnable recipe; returns { files, recipe }. */
export function writeDisplayGeoJson(outDir, map, pois = []) {
  mkdirSync(outDir, { recursive: true });
  const layers = displayGeoJson(map, pois);
  const files = [];
  for (const [name, collection] of Object.entries(layers)) {
    const file = path.join(outDir, `${name}.geojson`);
    writeFileSync(file, `${JSON.stringify(collection)}\n`);
    files.push(file);
  }
  const recipe = path.join(outDir, 'tippecanoe.sh');
  const inputs = Object.keys(layers).map((name) => `-L ${name}:${name}.geojson`).join(' \\\n  ');
  writeFileSync(recipe, `# Rebuild base.pmtiles from this export\ntippecanoe -o ../base.pmtiles --force -zg --drop-densest-as-needed \\\n  ${inputs}\n`);
  return { files, recipe };
}

export const tippecanoeAvailable = () =>
  spawnSync('tippecanoe', ['--version'], { stdio: 'ignore' }).status !== null;

/**
 * The tiles-build stage: GeoJSON export → `base.pmtiles` beside it.
 * Returns { ok, file, sizeKb } or { ok: false, reason } — never throws for a
 * missing binary; that is a recorded gap, not a crash.
 *
 * The two failure shapes are not the same thing, and the certification gate
 * needs to tell them apart. `gap: true` means the *toolchain* is absent —
 * tippecanoe is a `wrap` dependency nobody is required to install, so the
 * honest record is a named gap, exactly as buildRasterTier does for a missing
 * go-pmtiles. No `gap` means tippecanoe ran and this venue's tiles are
 * genuinely broken or oversized, which is a real failure.
 */
export function buildTiles({ id, map, pois, outDir }) {
  const tilesDir = path.join(outDir, 'tiles');
  const { files } = writeDisplayGeoJson(tilesDir, map, pois);
  if (!tippecanoeAvailable()) {
    return {
      ok: false,
      gap: true,
      reason: 'tippecanoe not installed — GeoJSON + tippecanoe.sh recipe written; run it to build base.pmtiles',
      files,
    };
  }
  const outFile = path.join(outDir, 'base.pmtiles');
  const args = [
    '-o', outFile, '--force', '-zg', '--drop-densest-as-needed',
    '--name', id,
    ...files.map((f) => ['-L', `${path.basename(f, '.geojson')}:${f}`]).flat(),
  ];
  const res = spawnSync('tippecanoe', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  if (res.status !== 0) {
    return { ok: false, reason: `tippecanoe exited ${res.status}: ${String(res.stderr || '').slice(0, 300)}`, files };
  }
  const sizeKb = Math.round(statSync(outFile).size / 1024);
  return { ok: true, file: outFile, sizeKb, files };
}

export const tilesFile = (outDir) => {
  const file = path.join(outDir, 'base.pmtiles');
  return existsSync(file) ? file : null;
};
