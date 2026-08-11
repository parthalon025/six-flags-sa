/**
 * Rope Drop News open data — Disney/Universal crowd & reliability research.
 * https://github.com/RopeDropNews/theme-park-open-data (CC BY 4.0)
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

const BASE = 'https://raw.githubusercontent.com/RopeDropNews/theme-park-open-data/main';

/** Venue id → RopeDrop park slug (Disney/Universal only). */
export const ROPEDROP_SLUGS = {
  // Extend as Disney/Universal venues ship. Empty slug for Cedar Fair / SF /
  // waterpark venues is intentional — declare gaps.adapters.ropedrop in sources.json.
};

export const ropedropCacheFile = (id) => cachePath(id, 'ropedrop');

export async function loadRopedropData(venueId, { fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'ropedrop');
  if (offline) return cached || { fetched: null, error: 'No cache on disk.' };
  if (!fetch && cached?.slug) return cached;

  const slug = ROPEDROP_SLUGS[venueId];
  if (!slug) {
    return cached || {
      fetched: null,
      slug: null,
      error: `No RopeDrop slug for venue "${venueId}" (Disney/Universal only).`,
    };
  }

  const [waitTimes, reliability] = await Promise.all([
    fetchJson(`${BASE}/parks/${slug}/wait-times.json`).catch(() => null),
    fetchJson(`${BASE}/parks/${slug}/reliability.csv`).catch(() => null),
  ]);

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'ropedropnews.com',
    license: 'CC BY 4.0',
    slug,
    waitTimes,
    reliabilityCsv: typeof reliability === 'string' ? reliability : null,
  };
  writeCache(venueId, 'ropedrop', out);
  return out;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'ropedrop', ok: false, error: 'venueId_required' };
  try {
    const data = await loadRopedropData(id, { fetch: ctx.fetch ?? true, offline: ctx.offline });
    const ok = Boolean(data.slug) || Boolean(data.error?.includes('only'));
    return {
      adapterId: 'ropedrop',
      ok,
      meta: { slug: data.slug, hasWaitTimes: Boolean(data.waitTimes) },
      artifacts: data.slug ? [ropedropCacheFile(id)] : [],
      data,
      error: data.error && !data.slug ? data.error : undefined,
    };
  } catch (err) {
    return { adapterId: 'ropedrop', ok: false, error: err.message };
  }
}
