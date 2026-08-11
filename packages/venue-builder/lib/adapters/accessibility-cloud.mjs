/**
 * Accessibility Cloud / Wheelmap — POI wheelchair ratings (A11yJSON).
 * https://github.com/sozialhelden/accessibility-cloud
 *
 * Requires ACCESSIBILITY_CLOUD_TOKEN for live fetches; caches bbox results offline.
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

const API = 'https://accessibility-cloud-v2.freetls.fastly.net';

export const accessibilityCloudCacheFile = (id) => cachePath(id, 'accessibility-cloud');

export async function loadAccessibilityCloudData(venueId, { bounds, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'accessibility-cloud');
  if (offline) return cached || { fetched: null, places: [], error: 'No cache on disk.' };
  if (!fetch && cached?.places?.length) return cached;

  const token = process.env.ACCESSIBILITY_CLOUD_TOKEN;
  if (!token) {
    return cached || {
      fetched: null,
      places: [],
      error: 'Set ACCESSIBILITY_CLOUD_TOKEN to fetch Accessibility Cloud data.',
    };
  }
  if (!bounds?.north) {
    return cached || { fetched: null, places: [], error: 'bounds_required' };
  }

  const params = new URLSearchParams({
    appToken: token,
    latitude: String((bounds.north + bounds.south) / 2),
    longitude: String((bounds.east + bounds.west) / 2),
    radius: '3000',
    limit: '200',
  });
  const data = await fetchJson(`${API}/place-infos?${params}`);
  const places = (data.data || []).map((p) => ({
    id: p._id,
    name: p.attributes?.name || p.attributes?.originalName,
    wheelchair: p.attributes?.accessibility?.wheelchair,
    lat: p.attributes?.coordinates?.latitude,
    lng: p.attributes?.coordinates?.longitude,
  }));

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'accessibility.cloud',
    license: 'varies — see provider',
    places,
  };
  writeCache(venueId, 'accessibility-cloud', out);
  return out;
}

export function accessibilityClaims(data) {
  const date = data?.fetched?.slice(0, 10) || new Date().toISOString().slice(0, 10);
  return (data?.places || [])
    .filter((p) => p.wheelchair && Number.isFinite(p.lat))
    .map((p) => ({
      source: 'accessibility_cloud',
      kind: 'accessibility',
      at: { lat: p.lat, lng: p.lng },
      date,
      note: `${p.name}: wheelchair=${p.wheelchair}`,
    }));
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'accessibility-cloud', ok: false, error: 'venueId_required' };
  try {
    const data = await loadAccessibilityCloudData(id, { bounds: ctx.bounds, fetch: ctx.fetch ?? true, offline: ctx.offline });
    const hasData = (data.places?.length || 0) > 0;
    return {
      adapterId: 'accessibility-cloud',
      ok: hasData || Boolean(cachedOk(data)),
      claims: accessibilityClaims(data),
      meta: { count: data.places?.length || 0 },
      artifacts: hasData ? [accessibilityCloudCacheFile(id)] : [],
      data,
      error: !hasData ? data.error : undefined,
    };
  } catch (err) {
    return { adapterId: 'accessibility-cloud', ok: false, error: err.message };
  }
}

function cachedOk(data) {
  return data?.error?.includes('ACCESSIBILITY_CLOUD_TOKEN');
}
