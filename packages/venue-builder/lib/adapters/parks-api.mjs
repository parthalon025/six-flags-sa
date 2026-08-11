/**
 * ThemeParks.wiki / ParksAPI adapter — park inventories and locations.
 *
 * Uses the public api.themeparks.wiki REST API (no npm dependency).
 * Cached to data/venues/<id>.parks-api-cache.json for offline research runs.
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { OVERRIDE_DIR, readJson, venueSidecar } from '../venue-io.mjs';
import { nameSimilarity, pairSuggestions } from '../venue-judge.mjs';
import { parkEntityIds } from '../parks-api-entities.mjs';

const API = 'https://api.themeparks.wiki/v1';
const UA = 'six-flags-sa-venue-research/1.0 (+https://github.com/parthalon025/six-flags-sa)';

/** Venue id → themeparks.wiki park entity id (loaded from entity map + overrides). */
export const PARK_ENTITY_IDS = parkEntityIds();

export const parksApiCacheFile = (id) => venueSidecar(id, 'parks-api-cache.json');

async function apiGet(pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`${pathname} returned ${res.status}`);
  return res.json();
}

/**
 * Fetch attraction list for a venue, optionally writing cache.
 */
export async function loadParksApiData(id, { fetch = false, offline = false } = {}) {
  const cachePath = parksApiCacheFile(id);
  const cached = readJson(cachePath);
  if (offline) return cached || { fetched: null, attractions: [], error: 'No cache on disk.' };
  if (!fetch && cached?.attractions?.length) return cached;

  const parkId = PARK_ENTITY_IDS[id];
  if (!parkId) {
    return cached || {
      fetched: null,
      parkId: null,
      attractions: [],
      error: `No ParksAPI mapping for venue "${id}".`,
    };
  }

  const entity = await apiGet(`/entity/${parkId}/children`);
  const children = entity.children || [];
  const attractions = children
    .filter((c) => c.entityType === 'ATTRACTION' || c.entityType === 'RESTAURANT' || c.entityType === 'SHOW')
    .map((c) => ({
      id: c.id,
      name: c.name,
      entityType: c.entityType,
      externalId: c.externalId || null,
      at: c.location
        ? { lat: c.location.latitude, lng: c.location.longitude }
        : null,
    }));

  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    parkId,
    parkName: entity.name,
    source: 'api.themeparks.wiki',
    attractions,
  };

  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(out, null, 2)}\n`);
  return out;
}

/** Compare ParksAPI names to bundle ride names. */
export function compareParksApiToBundle({ parksApi = {}, pois = [] } = {}) {
  const rides = pois.filter((p) => p.c === 'ride' || p.c === 'slide');
  const bundleNames = rides.map((p) => p.n);
  const apiNames = (parksApi.attractions || []).map((a) => a.name);
  const matched = new Set();
  const pairs = [];
  for (const name of bundleNames) {
    const best = pairSuggestions([name], apiNames, { floor: 0.72, limit: 1 })[0];
    if (best) {
      matched.add(best.right);
      pairs.push({ bundle: name, api: best.right, score: best.score });
    }
  }
  const onlyApi = apiNames.filter((n) => !matched.has(n));
  const onlyBundle = bundleNames.filter((n) => {
    const hit = pairSuggestions([n], apiNames, { floor: 0.72, limit: 1 })[0];
    return !hit;
  });
  return {
    apiCount: apiNames.length,
    bundleRideCount: bundleNames.length,
    matched: pairs.length,
    pairs,
    onlyOnApi: onlyApi.sort(),
    onlyInBundle: onlyBundle.sort(),
  };
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'parks-api', ok: false, error: 'venueId_required' };
  try {
    const data = await loadParksApiData(id, { fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'parks-api',
      ok: true,
      meta: { count: data.attractions?.length || 0, parkId: data.parkId },
      artifacts: [parksApiCacheFile(id)],
    };
  } catch (err) {
    return { adapterId: 'parks-api', ok: false, error: err.message };
  }
}
