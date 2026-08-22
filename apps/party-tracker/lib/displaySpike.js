/**
 * Byte source for the MapLibre display-pipeline spike (issue #527).
 *
 * Big Kahuna's certified display pack (`base.pmtiles`, one Skin's
 * `style.json`) lives under the builder's own data directory — it is a
 * build artifact, gitignored there like every other venue's, and this spec
 * is explicit that publishing display packs to `public/venues` is Phase 5's
 * venue download manager, not this one. So the spike reads the builder's
 * copy directly instead: server-only, one hardcoded venue and Skin, no
 * manifest entry and no download/caching flow. No import.meta — safe for
 * the Next bundler (mirrors lib/venueCompare.js's appRoot()).
 */
import path from 'node:path';
import { DISPLAY_SPIKE_SKIN, DISPLAY_SPIKE_VENUE } from './mapLibreConfigured.js';

function appRoot() {
  const cwd = process.cwd();
  if (cwd.endsWith('party-tracker')) return cwd;
  return path.join(cwd, 'apps', 'party-tracker');
}

function displayDir() {
  return path.join(appRoot(), '..', '..', 'packages', 'venue-builder', 'data', 'venues', DISPLAY_SPIKE_VENUE, 'display');
}

function maplibreDistDir() {
  // maplibre-gl is hoisted to the workspace root by npm in this monorepo.
  return path.join(appRoot(), '..', '..', 'node_modules', 'maplibre-gl', 'dist');
}

/** The display-pack files this spike serves — base.pmtiles and one Skin's style.json. */
const PACK_FILES = {
  'base.pmtiles': 'application/octet-stream',
  [`${DISPLAY_SPIKE_SKIN}.style.json`]: 'application/json',
};

/**
 * MapLibre's worker bundle and the shared chunk it imports relative to its
 * own URL. Turbopack rewrites the library's import.meta.url to a non-http
 * value, so MapLibre's default worker URL comes out empty and the worker
 * never boots (tiles then never load). DisplayMap points setWorkerUrl() here
 * instead; resolving from node_modules keeps the worker at the exact version
 * the app bundles.
 */
const WORKER_FILES = {
  'maplibre-gl-worker.mjs': 'text/javascript',
  'maplibre-gl-shared.mjs': 'text/javascript',
};

/** The worker bundle is what the shipped World map boots, not just the spike.
 *  Turbopack empties MapLibre's default worker URL; both ParkMap and
 *  DisplayMap point `setWorkerUrl` at this same-origin path. */
export function isMapLibreWorkerFile(name) {
  return Object.prototype.hasOwnProperty.call(WORKER_FILES, name);
}

/** Absolute path for an allow-listed file, or null for anything else. */
export function displaySpikeFile(name) {
  if (Object.prototype.hasOwnProperty.call(PACK_FILES, name)) {
    return path.join(displayDir(), name);
  }
  if (Object.prototype.hasOwnProperty.call(WORKER_FILES, name)) {
    return path.join(maplibreDistDir(), name);
  }
  return null;
}

export function displaySpikeContentType(name) {
  return PACK_FILES[name] || WORKER_FILES[name] || null;
}

/**
 * The `bytes=` Range header forms pmtiles and browsers actually send
 * (RFC 7233 single ranges): `N-M`, an open `N-`, and a suffix `-N` meaning
 * the last N bytes. Returns `{ start, end }` clamped into the file, or null
 * for anything malformed or unsatisfiable — the route answers null with 416.
 */
export function parseByteRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(rangeHeader).trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (rawStart === '') {
    const suffix = Number(rawEnd);
    if (suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (start >= size || start > end) return null;
  return { start, end };
}
