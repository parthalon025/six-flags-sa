/**
 * Shared cache helpers for external research adapters.
 * All caches live under data/venues/<id>/ as builder input sidecars.
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
// Imported from venue-fs.mjs, not venue-io.mjs: venue-io.mjs imports
// adapterCacheFile from this file, so importing back from venue-io.mjs would
// be a cycle (#32).
import { readJson, venueSidecar } from '../venue-fs.mjs';

/**
 * Adapter id → on-disk cache suffix (`${suffix}-cache.json`).
 * Most match the adapter id; Mapillary keeps the historical `mapillary` name.
 */
export const ADAPTER_CACHE_SUFFIX = {
  'parks-api': 'parks-api',
  'queue-times': 'queue-times',
  ropedrop: 'ropedrop',
  wikidata: 'wikidata',
  'accessibility-cloud': 'accessibility-cloud',
  rcdb: 'rcdb',
  'open-meteo': 'open-meteo',
  openhistoricalmap: 'openhistoricalmap',
  'project-sidewalk': 'project-sidewalk',
  'mapillary-api': 'mapillary',
  'mapillary-tools': 'mapillary-video',
  'esa-worldcover': 'esa-worldcover',
  'overture-buildings': 'overture-buildings',
  openrouteservice: 'openrouteservice',
  playwright: 'official',
  'google-places': 'google-places',
};

export const cachePath = (venueId, suffix) => venueSidecar(venueId, `${suffix}-cache.json`);

/** Resolve the cache path for a registry adapter id. */
export function adapterCacheFile(venueId, adapterId) {
  const suffix = ADAPTER_CACHE_SUFFIX[adapterId] || String(adapterId).replace(/-api$/, '');
  return cachePath(venueId, suffix);
}

export function readCache(venueId, suffix) {
  return readJson(cachePath(venueId, suffix));
}

export function writeCache(venueId, suffix, data) {
  const file = cachePath(venueId, suffix);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return file;
}

export const UA = 'parkbound-venue-builder/1.0 (+https://github.com/parthalon025/six-flags-sa)';

export async function fetchJson(url, { timeoutMs = 25000, headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Accept: 'application/json', 'User-Agent': UA, ...headers },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}
