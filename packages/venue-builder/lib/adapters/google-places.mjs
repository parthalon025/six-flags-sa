/**
 * Google Places — back-office corroboration only (ADR-0020 clause 7).
 *
 * Place IDs may be stored. Google content never becomes truth or grounding.
 * No guest-path or runtime use. Missing key is a recorded gap, not a throw.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cachePath, readCache, writeCache } from './_cache.mjs';
import { readJson } from '../venue-fs.mjs';

export const ID = 'google-places';

export const googlePlacesCacheFile = (id) => cachePath(id, 'google-places');

function readVenueCache(id, cacheFile) {
  if (cacheFile) return readJson(cacheFile) || { placeIds: [], claims: [] };
  return readCache(id, 'google-places') || { placeIds: [], claims: [] };
}

function writeVenueCache(id, cacheFile, data) {
  if (cacheFile) {
    const file = cacheFile;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return file;
  }
  return writeCache(id, 'google-places', data);
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
 * @param {{ venueId?: string, offline?: boolean, placeIds?: string[], cacheFile?: string }} ctx
 * @param {{ fetchFn?: typeof fetch, now?: () => string }} [deps]
 */
export async function run(ctx = {}, { fetchFn = fetch, now = () => new Date().toISOString() } = {}) {
  const id = ctx.venueId || 'unknown';
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API;
  const cached = readVenueCache(id, ctx.cacheFile);

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
  const out = {
    fetched: now(),
    placeIds,
    claims,
  };
  writeVenueCache(id, ctx.cacheFile, out);
  return { ok: true, claims };
}
