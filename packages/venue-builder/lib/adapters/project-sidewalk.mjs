/**
 * Project Sidewalk — accessibility labels near venue (GeoJSON API).
 * https://github.com/ProjectSidewalk/SidewalkWebpage
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

export const projectSidewalkCacheFile = (id) => cachePath(id, 'project-sidewalk');

export async function loadProjectSidewalkData(venueId, { bounds, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'project-sidewalk');
  if (offline) return cached || { fetched: null, labels: [], error: 'No cache on disk.' };
  if (!fetch && cached?.labels?.length) return cached;
  if (!bounds?.north) return cached || { fetched: null, labels: [], error: 'bounds_required' };

  const params = new URLSearchParams({
    lat1: String(bounds.south),
    lng1: String(bounds.west),
    lat2: String(bounds.north),
    lng2: String(bounds.east),
    filetype: 'geojson',
  });
  const url = `https://sidewalk-sea.cs.washington.edu/v2/access/attributes?${params}`;
  let geo;
  try {
    geo = await fetchJson(url);
  } catch {
    return cached || { fetched: null, labels: [], error: 'Project Sidewalk API unavailable for this bbox.' };
  }

  const labels = (geo.features || []).map((f) => ({
    type: f.properties?.label_type || f.properties?.type,
    severity: f.properties?.severity,
    lat: f.geometry?.coordinates?.[1],
    lng: f.geometry?.coordinates?.[0],
  }));

  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'projectsidewalk.org',
    license: 'open research data',
    labels,
  };
  writeCache(venueId, 'project-sidewalk', out);
  return out;
}

export function sidewalkClaims(data) {
  const date = data?.fetched || new Date().toISOString().slice(0, 10);
  return (data?.labels || [])
    .filter((l) => Number.isFinite(l.lat))
    .slice(0, 50)
    .map((l) => ({
      source: 'sidewalk_labels',
      kind: 'accessibility',
      at: { lat: l.lat, lng: l.lng },
      date,
      note: `${l.type}${l.severity != null ? ` severity=${l.severity}` : ''}`,
    }));
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'project-sidewalk', ok: false, error: 'venueId_required' };
  try {
    const data = await loadProjectSidewalkData(id, { bounds: ctx.bounds, fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'project-sidewalk',
      ok: true,
      meta: { count: data.labels?.length || 0 },
      claims: sidewalkClaims(data),
      artifacts: [projectSidewalkCacheFile(id)],
      data,
    };
  } catch (err) {
    return { adapterId: 'project-sidewalk', ok: false, error: err.message };
  }
}
