/* Path resolution and generic JSON read/write for a venue's builder package
 * and shipped artifacts. No orchestration lives here — this is the base
 * layer venue-io.mjs sits on top of, and it is imported directly (not
 * through venue-io.mjs) by venue-sources.mjs and lib/adapters/_cache.mjs.
 *
 * That directness is load-bearing, not a style choice: venue-io.mjs imports
 * *from* both of those modules (readSources/adapterGapNotes from
 * venue-sources.mjs, adapterCacheFile from adapters/_cache.mjs) to assemble
 * the shipped gaps document. Before this file existed, venue-sources.mjs and
 * adapters/_cache.mjs reached back into venue-io.mjs for these same
 * primitives, which made both edges into cycles (#32). This file has no
 * import of venue-io.mjs, venue-sources.mjs, or adapters/_cache.mjs — keep
 * it that way, or the cycle comes back.
 *
 * venue-io.mjs re-exports everything here so its ~70 existing importers keep
 * working unchanged; reach for this file directly only when you are, like
 * venue-sources.mjs and adapters/_cache.mjs, underneath venue-io.mjs rather
 * than above it.
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
