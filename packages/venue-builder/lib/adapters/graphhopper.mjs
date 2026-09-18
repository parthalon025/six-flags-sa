/**
 * GraphHopper — builder-side routing-engine bake-off (evaluate registry row).
 * https://github.com/graphhopper/graphhopper
 *
 * Opt-in Docker/local engine comparison against the shipped client A* baseline.
 * Gaps gracefully when GraphHopper is not reachable — never a phone dependency.
 */

import path from 'node:path';
import { cachePath, readCache, writeCache } from './_cache.mjs';
import { shapeBakeoffReport } from '../routing-engine-bakeoff.mjs';
import { collectBakeoffSamples } from '../routing-engine-bakeoff-samples.mjs';

export const GRAPHHOPPER_DEFAULT_URL = 'http://localhost:8989';

export const graphhopperCacheFile = (id) => cachePath(id, 'graphhopper');

export function resolveGraphHopperUrl({ url, env = process.env } = {}) {
  if (url) return String(url);
  if (env.GRAPHHOPPER_URL) return String(env.GRAPHHOPPER_URL);
  return GRAPHHOPPER_DEFAULT_URL;
}

export async function graphhopperAvailable({ baseUrl = GRAPHHOPPER_DEFAULT_URL, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/info`);
    return Boolean(res?.ok ?? res);
  } catch {
    return false;
  }
}

/**
 * @param {{ label: string, from: { lat: number, lng: number }, to: { lat: number, lng: number } }} pair
 */
export async function fetchGraphHopperRoute(pair, { baseUrl, fetchImpl = fetch } = {}) {
  const { from, to } = pair;
  const qs = new URLSearchParams({
    profile: 'foot',
    points_encoded: 'false',
    instructions: 'false',
  });
  const url = `${baseUrl}/route?${qs}&point=${from.lat},${from.lng}&point=${to.lat},${to.lng}`;
  const start = performance.now();
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`GraphHopper /route returned ${res.status}`);
  const data = typeof res.json === 'function' ? await res.json() : res;
  const routePath = data.paths?.[0];
  const ms = Math.round((performance.now() - start) * 10) / 10;
  if (!routePath) {
    return { label: pair.label, ok: false, error: 'no_path', ms };
  }
  return {
    label: pair.label,
    ok: true,
    metres: Math.round(routePath.distance ?? 0),
    seconds: routePath.time != null ? Math.round(routePath.time / 1000) : null,
    ms,
  };
}

export async function fetchGraphHopperRoutes(pairs, { baseUrl, fetchImpl = fetch } = {}) {
  const routes = [];
  for (const pair of pairs) {
    try {
      routes.push(await fetchGraphHopperRoute(pair, { baseUrl, fetchImpl }));
    } catch (err) {
      routes.push({ label: pair.label, ok: false, error: err.message });
    }
  }
  return routes;
}

export async function loadGraphHopperBakeoff(
  venueId,
  {
    pairs,
    baselineRoutes,
    fetch: doFetch = false,
    offline = false,
    baseUrl,
    fetchImpl,
  } = {},
) {
  const httpFetch = fetchImpl ?? globalThis.fetch;
  const cached = readCache(venueId, 'graphhopper');
  if (offline) return cached || { gap: true, error: 'No cache on disk.' };
  if (!doFetch && cached?.schema) return cached;

  const sample = pairs?.length
    ? { pairs, baselineRoutes: baselineRoutes || [] }
    : collectBakeoffSamples(venueId);
  const resolvedPairs = sample.pairs || [];
  const resolvedBaseline = baselineRoutes || sample.baselineRoutes || [];

  if (!resolvedPairs.length) {
    const stub = {
      gap: true,
      error: 'No origin/destination pairs for bake-off.',
      pairs: [],
    };
    writeCache(venueId, 'graphhopper', stub);
    return stub;
  }

  const ghUrl = resolveGraphHopperUrl({ url: baseUrl });
  const available = await graphhopperAvailable({ baseUrl: ghUrl, fetchImpl: httpFetch });
  if (!available) {
    const stub = shapeBakeoffReport({
      venue: venueId,
      engine: 'graphhopper',
      pairs: resolvedPairs,
      baselineRoutes: resolvedBaseline,
      engineRoutes: [],
      gap: true,
      error: `GraphHopper not reachable at ${ghUrl} (start Docker image or set GRAPHHOPPER_URL).`,
    });
    writeCache(venueId, 'graphhopper', stub);
    return stub;
  }

  const engineRoutes = await fetchGraphHopperRoutes(resolvedPairs, { baseUrl: ghUrl, fetchImpl: httpFetch });
  const report = shapeBakeoffReport({
    venue: venueId,
    engine: 'graphhopper',
    pairs: resolvedPairs,
    baselineRoutes: resolvedBaseline,
    engineRoutes,
  });
  writeCache(venueId, 'graphhopper', report);
  return report;
}

export async function run(ctx = {}, { fetchImpl = fetch } = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'graphhopper', ok: false, error: 'venueId_required' };
  try {
    const sample = ctx.pairs?.length
      ? { pairs: ctx.pairs, baselineRoutes: ctx.baselineRoutes || [] }
      : collectBakeoffSamples(id);
    const data = await loadGraphHopperBakeoff(id, {
      pairs: sample.pairs,
      baselineRoutes: sample.baselineRoutes,
      fetch: ctx.fetch ?? true,
      offline: ctx.offline,
      baseUrl: ctx.baseUrl,
      fetchImpl,
    });
    const gap = Boolean(data.gap);
    return {
      adapterId: 'graphhopper',
      ok: !gap && (data.summary?.comparable ?? 0) > 0,
      meta: { gap: gap || undefined, pairs: data.summary?.pairs ?? 0 },
      artifacts: [graphhopperCacheFile(id)],
      data,
      error: data.error,
    };
  } catch (err) {
    return { adapterId: 'graphhopper', ok: false, error: err.message };
  }
}
