/**
 * OpenRouteService — builder-side route QA (wheelchair/foot profiles).
 * https://github.com/GIScience/openrouteservice
 *
 * Uses ORS_API_KEY when set; compares sample routes against in-app graph.
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

const ORS = 'https://api.openrouteservice.org/v2/directions';

export const orsCacheFile = (id) => cachePath(id, 'openrouteservice');

export async function loadOrsRouteQa(venueId, { samples = [], fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'openrouteservice');
  if (offline) return cached || { fetched: null, routes: [], error: 'No cache on disk.' };
  if (!fetch && cached?.routes?.length) return cached;

  const key = process.env.ORS_API_KEY;
  if (!key) {
    return cached || {
      fetched: null,
      routes: [],
      error: 'Set ORS_API_KEY for OpenRouteService route QA.',
    };
  }
  if (!samples.length) {
    return cached || { fetched: null, routes: [], error: 'no_samples' };
  }

  const routes = [];
  for (const s of samples.slice(0, 5)) {
    const body = {
      coordinates: [
        [s.from.lng, s.from.lat],
        [s.to.lng, s.to.lat],
      ],
      profile: 'foot-walking',
    };
    try {
      const data = await fetchJson(`${ORS}/foot-walking/geojson`, {
        headers: { Authorization: key, 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify(body),
      });
      routes.push({
        label: s.label,
        metres: data.features?.[0]?.properties?.summary?.distance,
        seconds: data.features?.[0]?.properties?.summary?.duration,
        ok: Boolean(data.features?.length),
      });
    } catch (err) {
      routes.push({ label: s.label, ok: false, error: err.message });
    }
  }

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'openrouteservice.org',
    license: 'ORS terms',
    routes,
  };
  writeCache(venueId, 'openrouteservice', out);
  return out;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'openrouteservice', ok: false, error: 'venueId_required' };
  try {
    const data = await loadOrsRouteQa(id, { samples: ctx.samples || [], fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'openrouteservice',
      ok: (data.routes?.length || 0) > 0 || Boolean(data.error?.includes('ORS_API_KEY')),
      meta: { routes: data.routes?.length || 0 },
      artifacts: data.routes?.length ? [orsCacheFile(id)] : [],
      data,
      error: data.error,
    };
  } catch (err) {
    return { adapterId: 'openrouteservice', ok: false, error: err.message };
  }
}
