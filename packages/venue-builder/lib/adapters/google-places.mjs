/**
 * Google Places — back-office corroboration only (ADR-0020 clause 7).
 *
 * Place IDs may be stored. Google content never becomes truth or grounding.
 * No guest-path or runtime use. Missing key is a recorded gap, not a throw.
 */

import { cachePath, readCache, writeCache } from './_cache.mjs';

export const ID = 'google-places';

export const googlePlacesCacheFile = (id) => cachePath(id, 'google-places');

function metadataClaims(details) {
  return (details || []).map((row) => ({
    kind: 'metadata',
    source: ID,
    placeId: row.placeId,
    displayName: row.displayName || null,
  }));
}

/**
 * @param {{ venueId?: string, offline?: boolean, placeIds?: string[], now?: () => Date }} ctx
 */
export async function run(ctx = {}, { fetchFn = fetch } = {}) {
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

  const details = [];
  for (const placeId of placeIds) {
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
  }

  const claims = metadataClaims(details);
  const stampNow = ctx.now ?? (() => new Date());
  const out = {
    fetched: stampNow().toISOString(),
    placeIds,
    claims,
  };
  writeCache(id, 'google-places', out);
  return { ok: true, claims };
}
