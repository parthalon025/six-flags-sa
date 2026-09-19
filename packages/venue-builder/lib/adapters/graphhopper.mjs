/**
 * GraphHopper — builder-side routing-engine bake-off (evaluate registry row).
 * https://github.com/graphhopper/graphhopper
 *
 * Opt-in Docker/local engine comparison against the shipped client A* baseline.
 * Gaps gracefully when GraphHopper is not reachable — never a phone dependency.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cachePath, readCache, writeCache } from './_cache.mjs';
import { shapeBakeoffReport, renderBakeoffMarkdown } from '../routing-engine-bakeoff.mjs';
import { collectBakeoffSamples } from '../routing-engine-bakeoff-samples.mjs';

export const GRAPHHOPPER_DEFAULT_URL = 'http://localhost:8989';

export const graphhopperCacheFile = (id) => cachePath(id, 'graphhopper');

export const graphhopperSummaryFile = (id) => graphhopperCacheFile(id).replace('graphhopper-cache.json', 'graphhopper-bakeoff.md');

function engineRoutesFromReport(report) {
  return (report?.pairs || []).map((p) => ({
    label: p.label,
    ok: p.engine?.ok,
    metres: p.engine?.metres ?? null,
    seconds: p.engine?.seconds ?? null,
    ms: p.engine?.ms ?? null,
    error: p.engine?.error,
  }));
}

function writeBakeoffArtifacts(venueId, report) {
  writeCache(venueId, 'graphhopper', report);
  const mdPath = graphhopperSummaryFile(venueId);
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, `${renderBakeoffMarkdown(report)}\n`);
  return mdPath;
}

export function resolveGraphHopperUrl({ url, env = process.env } = {}) {
  if (url) return String(url);
  if (env.GRAPHHOPPER_URL) return String(env.GRAPHHOPPER_URL);
  return GRAPHHOPPER_DEFAULT_URL;
}

export async function graphhopperAvailable({ baseUrl = GRAPHHOPPER_DEFAULT_URL, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(`${baseUrl}/info`);
    return res?.ok === true;
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

  const sample = pairs?.length
    ? { pairs, baselineRoutes: baselineRoutes || [] }
    : collectBakeoffSamples(venueId);
  const resolvedPairs = sample.pairs || [];
  const resolvedBaseline = baselineRoutes || sample.baselineRoutes || [];

  if (!resolvedPairs.length) {
    const stub = shapeBakeoffReport({
      venue: venueId,
      engine: 'graphhopper',
      pairs: [],
      baselineRoutes: [],
      engineRoutes: [],
      gap: true,
      error: 'No origin/destination pairs for bake-off.',
    });
    writeBakeoffArtifacts(venueId, stub);
    return stub;
  }

  if (!doFetch && cached?.schema && !cached.gap) {
    const report = shapeBakeoffReport({
      venue: venueId,
      engine: 'graphhopper',
      pairs: resolvedPairs,
      baselineRoutes: resolvedBaseline,
      engineRoutes: engineRoutesFromReport(cached),
      fetched: cached.fetched,
    });
    writeBakeoffArtifacts(venueId, report);
    return report;
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
    writeBakeoffArtifacts(venueId, stub);
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
  writeBakeoffArtifacts(venueId, report);
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
