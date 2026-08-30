/**
 * Google Places — back-office corroboration only (ADR-0020 clause 7).
 *
 * Place IDs may be stored. Google content never becomes truth or grounding.
 * No guest-path or runtime use. Missing key is a recorded gap, not a throw.
 */

import { cachePath, readCache, writeCache } from './_cache.mjs';

export const ID = 'google-places';

export const googlePlacesCacheFile = (id) => cachePath(id, 'google-places');

/** Refuse rather than spend past the free-tier SKU cap (ADR-0020 §7, #562). */
const DEFAULT_DAILY_CAP = 100;

function dailyCap() {
  const raw = process.env.GOOGLE_PLACES_DAILY_CAP;
  if (raw === undefined || raw === '') return DEFAULT_DAILY_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_CAP;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

/** @param {{ usage?: { date?: string, count?: number } }} cached */
function usageFromCache(cached) {
  const usage = cached?.usage;
  const today = todayUtc();
  if (!usage || usage.date !== today) return { date: today, count: 0 };
  return { date: today, count: Number(usage.count) || 0 };
}

function budgetRefused(usage, cap, requested) {
  const remaining = cap - usage.count;
  if (remaining <= 0 || requested > remaining) {
    return {
      ok: false,
      gap: true,
      reason: `Places Details daily budget exhausted (${usage.count}/${cap} used; ${requested} requested)`,
    };
  }
  return null;
}

function metadataClaims(details) {
  return (details || []).map((row) => ({
    kind: 'metadata',
    source: ID,
    placeId: row.placeId,
    displayName: row.displayName || null,
  }));
}

/**
 * A genuine run stamps the wall clock and writes the venue's cache sidecar.
 * Both are injectable so a caller that is not a genuine run — a test driving a
 * stubbed `fetchFn` — can exercise the fetch path without writing tracked
 * builder input. Same shape as `writeOsmProposalFile`'s `write` sink (#34).
 *
 * @param {{ venueId?: string, offline?: boolean, placeIds?: string[] }} ctx
 * @param {{ fetchFn?: typeof fetch, writeCacheFn?: typeof writeCache, now?: () => Date }} deps
 */
export async function run(
  ctx = {},
  { fetchFn = fetch, writeCacheFn = writeCache, now = () => new Date() } = {},
) {
  const id = ctx.venueId || 'unknown';
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API;
  const cached = readCache(id, 'google-places') || { placeIds: [], claims: [] };

  if (!key) {
    return {
      ok: false,
      gap: true,
      reason: 'GOOGLE_MAPS_API_KEY not set — back-office corroboration skipped',
      claims: cached.claims || [],
    };
  }
  if (ctx.offline) {
    return { ok: true, offline: true, claims: cached.claims || [] };
  }

  const placeIds = ctx.placeIds || cached.placeIds || [];
  if (!placeIds.length) {
    return { ok: true, claims: [], reason: 'no place ids to corroborate' };
  }

  const cap = dailyCap();
  let usage = usageFromCache(cached);
  const refused = budgetRefused(usage, cap, placeIds.length);
  if (refused) {
    return { ...refused, claims: cached.claims || [] };
  }

  const details = [];
  for (const placeId of placeIds) {
    const blocked = budgetRefused(usage, cap, 1);
    if (blocked) {
      return { ...blocked, claims: cached.claims || [] };
    }
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
    const res = await fetchFn(url, {
      headers: {
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'id,displayName',
      },
    });
    if (!res?.ok) {
      return {
        ok: false,
        gap: true,
        reason: `Places Details failed for ${placeId} (${res?.status ?? 'no response'})`,
        claims: cached.claims || [],
      };
    }
    const body = typeof res.json === 'function' ? await res.json() : {};
    details.push({
      placeId,
      displayName: body?.displayName?.text || body?.displayName || null,
    });
    usage = { date: usage.date, count: usage.count + 1 };
    writeCache(id, 'google-places', { ...cached, usage });
  }

  const claims = metadataClaims(details);
  const out = {
    fetched: now().toISOString(),
    placeIds,
    claims,
    usage,
  };
  writeCacheFn(id, 'google-places', out);
  return { ok: true, claims };
}
