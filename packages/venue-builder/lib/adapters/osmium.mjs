/**
 * Osmium — offline OSM geometry from a regional PBF extract.
 * https://github.com/osmcode/osmium-tool
 *
 * Wraps the `osmium` CLI the same way mapillary-video.mjs wraps `mapillary_tools`:
 * gaps gracefully when the CLI or PBF is missing, never forked into this repo.
 *
 * The geometry build (`build-venue.mjs`) can opt in via `--from-pbf` or
 * `VENUE_OSM_PBF`; when unavailable it falls back to live Overpass unchanged.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, accessSync, constants, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cachePath, readCache, writeCache } from './_cache.mjs';

const execFileAsync = promisify(execFile);

/** Tag keys the Overpass query and the PBF tags-filter path both request. */
export const OSM_WANTED_KEYS = [
  'building',
  'building:part',
  'highway',
  'railway',
  'natural',
  'landuse',
  'leisure',
  'waterway',
  'water',
  'amenity',
  'attraction',
  'roller_coaster',
  'sport',
  'tourism',
  'shop',
  'man_made',
  'historic',
  'barrier',
  'entrance',
  'healthcare',
  'emergency',
  'place',
  'aeroway',
];

export const osmiumCacheFile = (id) => cachePath(id, 'osmium');

export function bboxArg(bounds) {
  const { west, south, east, north } = bounds || {};
  if (![west, south, east, north].every(Number.isFinite)) {
    throw new Error('bboxArg requires finite bounds.{west,south,east,north}');
  }
  return `${west},${south},${east},${north}`;
}

export function tagsFilterArgs(keys = OSM_WANTED_KEYS) {
  return keys.map((key) => `nwr/${key}`);
}

/** Overpass QL for the same tag set the PBF path filters — shared with build-venue. */
export function overpassQuery(b) {
  const box = `${b.south},${b.west},${b.north},${b.east}`;
  const lines = [`[out:json][timeout:180];`, '('];
  for (const key of OSM_WANTED_KEYS) {
    lines.push(`  way["${key}"](${box});`);
    lines.push(`  relation["${key}"](${box});`);
  }
  for (const key of OSM_WANTED_KEYS) lines.push(`  node["${key}"](${box});`);
  lines.push(');', 'out geom;');
  return lines.join('\n');
}

export function resolvePbfPath({ pbf, env = process.env } = {}) {
  if (pbf) return String(pbf);
  if (env?.VENUE_OSM_PBF) return String(env.VENUE_OSM_PBF);
  return null;
}

export async function cliAvailable(exec = execFileAsync) {
  try {
    await exec('osmium', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const TYPE_FROM_PREFIX = { n: 'node', w: 'way', r: 'relation' };

function tagsFromProperties(properties) {
  const tags = {};
  for (const [key, value] of Object.entries(properties || {})) {
    if (key.startsWith('@')) continue;
    tags[key] = value;
  }
  return tags;
}

function parseOsmId(raw) {
  const m = String(raw || '').match(/^([nwr])(\d+)$/);
  if (!m) return null;
  return { type: TYPE_FROM_PREFIX[m[1]], id: Number(m[2]) };
}

/** Convert osmium export geojsonseq text into Overpass-shaped `{ elements }`. */
export function geojsonSeqToOverpass(text) {
  const elements = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const feature = JSON.parse(trimmed);
    if (feature.type !== 'Feature') continue;
    const parsed = parseOsmId(feature.properties?.['@id']);
    if (!parsed) continue;
    const tags = tagsFromProperties(feature.properties);
    const geom = feature.geometry;
    if (!geom) continue;

    if (geom.type === 'Point') {
      const [lon, lat] = geom.coordinates;
      elements.push({ type: 'node', id: parsed.id, lat, lon, tags });
      continue;
    }

    const toPoints = (coords) => coords.map(([lon, lat]) => ({ lon, lat }));

    if (geom.type === 'LineString') {
      elements.push({ type: 'way', id: parsed.id, tags, geometry: toPoints(geom.coordinates) });
      continue;
    }

    if (geom.type === 'Polygon') {
      const ring = geom.coordinates[0] || [];
      elements.push({ type: 'way', id: parsed.id, tags, geometry: toPoints(ring) });
      continue;
    }

    if (geom.type === 'MultiPolygon') {
      const ring = geom.coordinates[0]?.[0] || [];
      elements.push({ type: 'way', id: parsed.id, tags, geometry: toPoints(ring) });
    }
  }
  return { elements };
}

function pbfReadable(pbfPath) {
  try {
    accessSync(pbfPath, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract and filter a venue bbox from a regional PBF, returning Overpass JSON.
 * `readExport` is injectable so tests never touch the filesystem.
 */
export async function queryPbf(pbfPath, bounds, { exec = execFileAsync, readExport } = {}) {
  if (!readExport && !pbfReadable(pbfPath)) throw new Error(`PBF not readable: ${pbfPath}`);
  bboxArg(bounds);

  const dir = mkdtempSync(path.join(tmpdir(), 'osmium-pbf-'));
  const extracted = path.join(dir, 'extract.pbf');
  const filtered = path.join(dir, 'filtered.pbf');
  const exported = path.join(dir, 'export.geojsonseq');

  try {
    await exec('osmium', ['extract', '-b', bboxArg(bounds), pbfPath, '-o', extracted, '--overwrite']);
    await exec('osmium', ['tags-filter', extracted, ...tagsFilterArgs(), '-o', filtered, '--overwrite']);
    await exec('osmium', [
      'export',
      filtered,
      '-o',
      exported,
      '-f',
      'geojsonseq',
      '--add-unique-id=type_id',
      '--overwrite',
    ]);

    const raw = readExport ? await readExport(exported) : readFileSync(exported, 'utf8');
    return geojsonSeqToOverpass(raw);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function gapResult(id, cached, error) {
  const stub = cached || { elements: [], error, gap: true };
  writeCache(id, 'osmium', stub);
  return { adapterId: 'osmium', ok: false, claims: [], meta: { gap: true }, data: stub, error: stub.error };
}

export async function run(ctx = {}, { exec = execFileAsync, readExport } = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'osmium', ok: false, error: 'venueId_required' };

  const cached = readCache(id, 'osmium');
  if (ctx.offline) {
    return { adapterId: 'osmium', ok: Boolean(cached?.elements?.length), data: cached };
  }

  const bounds = ctx.bounds;
  if (!Number.isFinite(bounds?.north) || !Number.isFinite(bounds?.south) || !Number.isFinite(bounds?.east) || !Number.isFinite(bounds?.west)) {
    return gapResult(id, cached, 'bounds_required');
  }

  const pbfPath = resolvePbfPath({ pbf: ctx.pbfPath, env: process.env });
  if (!pbfPath) return gapResult(id, cached, 'pbf_path_required (set --from-pbf or VENUE_OSM_PBF)');

  if (!(await cliAvailable(exec))) {
    return gapResult(id, cached, 'osmium CLI not found on PATH.');
  }

  if (!readExport && !pbfReadable(pbfPath)) {
    return gapResult(id, cached, `PBF not readable: ${pbfPath}`);
  }

  try {
    const osm = await queryPbf(pbfPath, bounds, { exec, readExport });
    const out = {
      fetched: new Date().toISOString().slice(0, 10),
      source: 'osmium+pbf',
      license: 'ODbL',
      pbfPath,
      elements: osm.elements,
    };
    writeCache(id, 'osmium', out);
    return {
      adapterId: 'osmium',
      ok: osm.elements.length > 0,
      claims: [],
      meta: { count: osm.elements.length },
      artifacts: [osmiumCacheFile(id)],
      data: out,
    };
  } catch (err) {
    return { adapterId: 'osmium', ok: false, error: err.message };
  }
}
