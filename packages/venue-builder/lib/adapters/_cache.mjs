/**
 * Shared cache helpers for external research adapters.
 * All caches live under data/venues/<id>/ as builder input sidecars.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { readJson, venueSidecar } from '../venue-io.mjs';

export const cachePath = (venueId, suffix) => venueSidecar(venueId, `${suffix}-cache.json`);

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
