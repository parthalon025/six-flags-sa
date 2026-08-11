/**
 * OpenHistoricalMap — historical features inside venue bounds.
 * https://github.com/OpenHistoricalMap
 */

import { cachePath, readCache, writeCache } from './_cache.mjs';

const OVERPASS = 'https://overpass-api.openhistoricalmap.org/api/interpreter';

export const ohmCacheFile = (id) => cachePath(id, 'openhistoricalmap');

function overpassQuery(bounds) {
  const { south, west, north, east } = bounds;
  return `
[out:json][timeout:60];
(
  nwr["historic"](${south},${west},${north},${east});
  nwr["tourism"="theme_park"](${south},${west},${north},${east});
);
out center tags;
`.trim();
}

export async function loadOhmData(venueId, { bounds, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'openhistoricalmap');
  if (offline) return cached || { fetched: null, features: [], error: 'No cache on disk.' };
  if (!fetch && cached?.features?.length) return cached;
  if (!bounds?.north) return cached || { fetched: null, features: [], error: 'bounds_required' };

  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'parkbound-venue-builder/1.0' },
    body: `data=${encodeURIComponent(overpassQuery(bounds))}`,
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`OHM Overpass returned ${res.status}`);
  const data = await res.json();
  const features = (data.elements || []).map((el) => ({
    type: el.type,
    id: el.id,
    tags: el.tags || {},
    lat: el.lat ?? el.center?.lat,
    lng: el.lon ?? el.center?.lon,
    start_date: el.tags?.start_date || null,
    end_date: el.tags?.end_date || null,
  }));

  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'openhistoricalmap.org',
    license: 'ODbL',
    features,
  };
  writeCache(venueId, 'openhistoricalmap', out);
  return out;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'openhistoricalmap', ok: false, error: 'venueId_required' };
  try {
    const data = await loadOhmData(id, { bounds: ctx.bounds, fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'openhistoricalmap',
      ok: true,
      meta: { count: data.features?.length || 0 },
      artifacts: [ohmCacheFile(id)],
      data,
    };
  } catch (err) {
    return { adapterId: 'openhistoricalmap', ok: false, error: err.message };
  }
}
