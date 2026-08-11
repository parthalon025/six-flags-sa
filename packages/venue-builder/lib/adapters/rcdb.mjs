/**
 * RCDB cross-check adapter — unofficial coaster stats for comparison.
 * Uses community API https://rcdb-api.vercel.app (scrapes rcdb.com).
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';
import { pairSuggestions } from '../venue-judge.mjs';

const API = 'https://rcdb-api.vercel.app/api/coasters';

export const rcdbCacheFile = (id) => cachePath(id, 'rcdb');

export async function loadRcdbData(venueId, { venueName, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'rcdb');
  if (offline) return cached || { fetched: null, coasters: [], error: 'No cache on disk.' };
  if (!fetch && cached?.coasters?.length) return cached;

  const all = await fetchJson(API);
  const parkName = venueName || venueId;
  const coasters = (all || []).filter((c) => {
    const p = (c.park || '').toLowerCase();
    const target = parkName.toLowerCase();
    return p.includes(target) || target.includes(p.split(' ')[0]);
  });

  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'rcdb.com via rcdb-api',
    license: 'unofficial scrape — compare only',
    park: parkName,
    coasters: coasters.map((c) => ({
      id: c.id,
      name: c.name,
      height: c.height,
      speed: c.speed,
      length: c.length,
      inversions: c.inversions,
      type: c.type,
    })),
  };
  writeCache(venueId, 'rcdb', out);
  return out;
}

export function compareRcdbToBundle({ rcdb = {}, pois = [] } = {}) {
  const coasters = pois.filter((p) => p.c === 'coaster' || p.c === 'ride');
  const bundleNames = coasters.map((p) => p.n);
  const apiNames = (rcdb.coasters || []).map((c) => c.name);
  const pairs = [];
  const matched = new Set();
  for (const name of bundleNames) {
    const best = pairSuggestions([name], apiNames, { floor: 0.75, limit: 1 })[0];
    if (best) {
      matched.add(best.right);
      const rc = rcdb.coasters.find((c) => c.name === best.right);
      pairs.push({ bundle: name, rcdb: best.right, score: best.score, height: rc?.height });
    }
  }
  return {
    rcdbCount: apiNames.length,
    bundleCount: bundleNames.length,
    matched: pairs.length,
    pairs,
    onlyOnRcdb: apiNames.filter((n) => !matched.has(n)).sort(),
    onlyInBundle: bundleNames.filter((n) => !pairSuggestions([n], apiNames, { floor: 0.75, limit: 1 })[0]).sort(),
  };
}

export function rcdbClaims(data, compare) {
  const date = data?.fetched || new Date().toISOString().slice(0, 10);
  return (compare?.pairs || []).map((p) => ({
    source: 'rcdb',
    kind: 'metadata',
    date,
    note: `${p.bundle}: RCDB height ${p.height}ft (compare only)`,
  }));
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'rcdb', ok: false, error: 'venueId_required' };
  try {
    const data = await loadRcdbData(id, { venueName: ctx.venueName, fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'rcdb',
      ok: true,
      meta: { count: data.coasters?.length || 0 },
      artifacts: [rcdbCacheFile(id)],
      data,
    };
  } catch (err) {
    return { adapterId: 'rcdb', ok: false, error: err.message };
  }
}
