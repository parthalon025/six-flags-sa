/**
 * Shared cache helpers for external research adapters.
 * All caches live under data/venues/ as builder input sidecars.
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { OVERRIDE_DIR, readJson } from '../venue-io.mjs';

export const cachePath = (venueId, suffix) => path.join(OVERRIDE_DIR, `${venueId}.${suffix}-cache.json`);

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
