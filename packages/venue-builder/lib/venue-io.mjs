/* Where a venue lives on disk, and how the app finds out about it.
 *
 * One venue is three *published* files plus a manifest row:
 *
 *   public/venues/<id>.map.json    the drawn geometry, fetched by the browser
 *   public/venues/<id>.pois.json   the places, fetched by the browser
 *   public/venues/<id>.gaps.json   Gaps the builder invented; the phone ranks them
 *   public/venues/manifest.json    every venue's name, centre and bounds
 *
 * Builder *input* for each venue lives in its own package directory:
 *
 *   packages/venue-builder/data/venues/<id>/
 *     sources.json, overrides.json, heights.json, recipe.json, ids.json, …
 *     maps/          official park map images used for georef / testing
 *     *.geojson      imagery / merge / traced datasets
 *
 * They sit under public/ rather than being imported at build time because that
 * is what makes a venue swappable without a rebuild: the client fetches the one
 * it needs, the service worker caches it, and a phone that has been to two
 * parks holds both. lib/venueIndex.js is generated alongside them so the server
 * routes — which cannot fetch their own static files on every host — still get
 * the POI lists through the bundler.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  APP_ROOT,
  BUILDER_ROOT,
  INDEX_FILE,
  MANIFEST_FILE,
  MONO_ROOT,
  OVERRIDE_DIR,
  VENUE_DIR,
} from '../src/paths.mjs';
import { requests } from './venue-requests.mjs';
import { questSeedsForVenue } from './quest-seeds.mjs';
import { shippedGapsDocument } from './ship-gaps.mjs';

export { APP_ROOT, BUILDER_ROOT, INDEX_FILE, MANIFEST_FILE, MONO_ROOT, OVERRIDE_DIR, VENUE_DIR };
/** @deprecated use MONO_ROOT */
export const ROOT = MONO_ROOT;

/** Absolute path to one venue's builder package directory. */
export const venuePkgDir = (id) => path.join(OVERRIDE_DIR, id);

/**
 * Absolute path to a sidecar inside a venue package.
 * @param {string} id venue id
 * @param {string} name file name inside the package (e.g. `sources.json`, `queue-times-cache.json`)
 */
export const venueSidecar = (id, name) => path.join(OVERRIDE_DIR, id, name);

/** Relative path from the venue-builder package root (for sources.json datasets). */
export const venueSidecarRel = (id, name) => path.join('data', 'venues', id, name).replace(/\\/g, '/');

/** Relative path from the venue-builder package root to a map image in the venue package. */
export const venueMapRel = (id, filename) => venueSidecarRel(id, path.join('maps', filename));

/** List venue package ids that have a directory under data/venues/. */
export function listVenuePackages() {
  if (!existsSync(OVERRIDE_DIR)) return [];
  return readdirSync(OVERRIDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

/**
 * Resolve a path recorded in sources / recipes / traces.
 * Paths are usually relative to the venue-builder package (`data/venues/...`);
 * docs and other mono-root assets fall back to MONO_ROOT.
 */
export function resolveBuilderPath(relOrAbs) {
  if (!relOrAbs) return null;
  const raw = String(relOrAbs);
  if (path.isAbsolute(raw)) return raw;
  const fromBuilder = path.join(BUILDER_ROOT, raw);
  if (existsSync(fromBuilder)) return fromBuilder;
  const fromMono = path.join(MONO_ROOT, raw);
  if (existsSync(fromMono)) return fromMono;
  return fromBuilder;
}

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export const writeJson = (file, value, pretty) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, pretty ? `${JSON.stringify(value, null, 2)}\n` : JSON.stringify(value));
};

/**
 * Gaps this venue ships. Reads builder sidecars (overrides, attractions);
 * does not invent live ops. Phone-safe: one `{ type, target }` per fact.
 */
export function gapsDocumentFor({ meta, pois }) {
  const id = meta?.id;
  const overrides = id ? readOverrides(id).data : null;
  const attractions = id ? readJson(venueSidecar(id, 'attractions.json')) : null;
  const reqs = requests({ venue: meta, map: {}, pois: pois || [], overrides });
  const seeds = questSeedsForVenue({
    venueId: id,
    reqs,
    attractions,
    includeAmbient: false,
  });
  return shippedGapsDocument({ venueId: id, seeds: seeds.durable, pois: pois || [] });
}

export const serializeVenue = ({ meta, map, pois, gaps }) => ({
  map: JSON.stringify({ meta, ...map }),
  pois: `${JSON.stringify(pois, null, 2)}\n`,
  gaps: `${JSON.stringify(gaps ?? { version: 1, venue: meta?.id || null, gaps: [] }, null, 2)}\n`,
});

export function writeVenue({ meta, map, pois, gaps }) {
  const id = meta.id;
  // The map file is the big one and nobody reads it by hand, so it goes out
  // minified. The POI list is small, gets edited when a name is wrong, and is
  // worth a readable diff. Gaps are the same readable shape as places. Written
  // through the same serialiser the drift check reads with, so the two can
  // never disagree about what a venue looks like.
  const shipped = gaps ?? gapsDocumentFor({ meta, pois });
  const bytes = serializeVenue({ meta, map, pois, gaps: shipped });
  mkdirSync(VENUE_DIR, { recursive: true });
  writeFileSync(path.join(VENUE_DIR, `${id}.map.json`), bytes.map);
  writeFileSync(path.join(VENUE_DIR, `${id}.pois.json`), bytes.pois);
  writeFileSync(path.join(VENUE_DIR, `${id}.gaps.json`), bytes.gaps);
  return {
    map: path.join(VENUE_DIR, `${id}.map.json`),
    pois: path.join(VENUE_DIR, `${id}.pois.json`),
    gaps: path.join(VENUE_DIR, `${id}.gaps.json`),
  };
}

/**
 * Rebuild the manifest and the generated index from whatever venue files are on
 * disk, so adding or deleting a venue is a matter of the files themselves.
 * `preferredDefault` only wins if that venue actually exists.
 */
export function reindex({ preferredDefault } = {}) {
  mkdirSync(VENUE_DIR, { recursive: true });
  const ids = readdirSync(VENUE_DIR)
    .filter((f) => f.endsWith('.map.json'))
    .map((f) => f.slice(0, -'.map.json'.length))
    .sort();

  const venues = [];
  for (const id of ids) {
    const map = readJson(path.join(VENUE_DIR, `${id}.map.json`));
    const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
    if (!map?.meta) {
      console.warn(`  ! ${id}.map.json has no meta block — skipped`);
      continue;
    }
    const shipped = gapsDocumentFor({ meta: map.meta, pois });
    writeJson(path.join(VENUE_DIR, `${id}.gaps.json`), shipped, true);
    venues.push({
      ...map.meta,
      map: `/venues/${id}.map.json`,
      pois: `/venues/${id}.pois.json`,
      gaps: `/venues/${id}.gaps.json`,
      counts: {
        pois: pois.length,
        rides: pois.filter((p) => p.c === 'coaster' || p.c === 'ride').length,
        heights: pois.filter((p) => p.h).length,
        gaps: shipped.gaps.length,
      },
    });
  }

  const existing = readJson(MANIFEST_FILE, {});
  const wanted = preferredDefault || existing.default;
  const fallback = venues[0]?.id ?? null;
  const manifest = {
    version: 1,
    default: venues.some((v) => v.id === wanted) ? wanted : fallback,
    venues,
  };
  writeJson(MANIFEST_FILE, manifest, true);
  writeIndex(manifest);
  return manifest;
}

/**
 * A generated module, because the API routes need the POI lists inside the
 * bundle: reading public/ from a route handler works locally and quietly does
 * not on several hosts. Static imports are the one form every host agrees on.
 */
function writeIndex(manifest) {
  const lines = [
    '/* Generated by scripts/build-venue.mjs — do not edit by hand.',
    ' *',
    ' * Static imports of every venue\'s POI list, for the server-side routes.',
    ' * The browser does not use this: it fetches /venues/<id>.pois.json so that',
    ' * a new venue is a new file rather than a new deployment.',
    ' *',
    ` * Rebuild with: npm run venues:reindex`,
    ' */',
    '',
    "import manifest from '@/public/venues/manifest.json';",
  ];
  const varOf = (id) => `pois_${id.replace(/[^a-zA-Z0-9]/g, '_')}`;
  for (const v of manifest.venues) {
    lines.push(`import ${varOf(v.id)} from '@/public/venues/${v.id}.pois.json';`);
  }
  lines.push('');
  lines.push('export const MANIFEST = manifest;');
  lines.push('export const VENUES = manifest.venues;');
  lines.push(`export const DEFAULT_VENUE_ID = ${JSON.stringify(manifest.default)};`);
  lines.push('');
  lines.push('export const POIS_BY_VENUE = {');
  for (const v of manifest.venues) lines.push(`  ${JSON.stringify(v.id)}: ${varOf(v.id)},`);
  lines.push('};');
  lines.push('');
  lines.push('export const venueById = (id) => VENUES.find((v) => v.id === id) || null;');
  lines.push('');
  mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  writeFileSync(INDEX_FILE, lines.join('\n'));
}

export function readOverrides(id, explicit) {
  const file = explicit || venueSidecar(id, 'overrides.json');
  const data = readJson(file);
  return data ? { file, data } : { file: null, data: null };
}
