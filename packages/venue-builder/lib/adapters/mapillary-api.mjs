/**
 * Mapillary — street-level imagery metadata near venue (CC BY-SA).
 * https://github.com/mapillary/mapillary_tools
 *
 * Uses Mapillary API v4 when MAPILLARY_TOKEN is set.
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

export const mapillaryCacheFile = (id) => cachePath(id, 'mapillary');

export async function loadMapillaryData(venueId, { bounds, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'mapillary');
  if (offline) return cached || { fetched: null, images: [], error: 'No cache on disk.' };
  if (!fetch && cached?.images?.length) return cached;

  const token = process.env.MAPILLARY_TOKEN;
  if (!token) {
    return cached || {
      fetched: null,
      images: [],
      error: 'Set MAPILLARY_TOKEN to fetch Mapillary sequences.',
    };
  }
  if (!bounds?.north) return cached || { fetched: null, images: [], error: 'bounds_required' };

  const bbox = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  const fields = 'id,captured_at,compass_angle,is_pano,geometry';
  const url = `https://graph.mapillary.com/images?access_token=${token}&fields=${fields}&bbox=${bbox}&limit=100`;
  const data = await fetchJson(url);
  const images = (data.data || []).map((img) => ({
    id: img.id,
    captured_at: img.captured_at,
    compass_angle: img.compass_angle,
    is_pano: img.is_pano,
    lat: img.geometry?.coordinates?.[1],
    lng: img.geometry?.coordinates?.[0],
  }));

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'mapillary.com',
    license: 'CC BY-SA',
    images,
  };
  writeCache(venueId, 'mapillary', out);
  return out;
}

export function mapillaryClaims(data) {
  const date = data?.fetched?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return (data?.images || [])
    .filter((i) => Number.isFinite(i.lat))
    .slice(0, 20)
    .map((i) => ({
      source: 'mapillary',
      kind: 'imagery',
      at: { lat: i.lat, lng: i.lng },
      date,
      note: `Mapillary image ${i.id}`,
      uri: `https://www.mapillary.com/app/?pKey=${i.id}`,
    }));
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'mapillary-api', ok: false, error: 'venueId_required' };
  try {
    const data = await loadMapillaryData(id, { bounds: ctx.bounds, fetch: ctx.fetch ?? true, offline: ctx.offline });
    const hasData = (data.images?.length || 0) > 0;
    return {
      adapterId: 'mapillary-api',
      ok: hasData || Boolean(data.error?.includes('MAPILLARY_TOKEN')),
      claims: mapillaryClaims(data),
      meta: { count: data.images?.length || 0 },
      artifacts: hasData ? [mapillaryCacheFile(id)] : [],
      data,
      error: !hasData ? data.error : undefined,
    };
  } catch (err) {
    return { adapterId: 'mapillary-api', ok: false, error: err.message };
  }
}
