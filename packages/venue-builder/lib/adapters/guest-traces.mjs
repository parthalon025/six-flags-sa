/**
 * Guest movement traces — anonymised LineStrings from Parkbound phones.
 *
 * Opt-in walks uploaded via /api/contributions/traces land in Redis (or are
 * dumped into data/venues/<id>.guest-traces-cache.json). This adapter turns
 * them into path-geometry research claims for the builder. It never writes
 * public/venues JSON — operators review candidates, then graduate durable
 * walkways through overrides / OSM like any other research input.
 *
 * Fetch modes:
 *   - offline / cache: read data/venues/<id>.guest-traces-cache.json
 *   - fetch: optional GUEST_TRACES_API (base URL) + GUEST_TRACES_TOKEN
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';

export const guestTracesCacheFile = (id) => cachePath(id, 'guest-traces');

/**
 * Rough metres between a point and the nearest vertex of existing path lines.
 * Good enough to flag "guests walk here but our graph has nothing nearby."
 */
function distToPaths(lat, lng, pathCoords) {
  let best = Infinity;
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  for (const line of pathCoords) {
    for (const c of line) {
      const lng0 = c[0];
      const lat0 = c[1];
      const d = Math.hypot((lng - lng0) * kx, (lat - lat0) * 110540);
      if (d < best) best = d;
    }
  }
  return best;
}

function featureCoords(feature) {
  const g = feature?.geometry;
  if (!g) return [];
  if (g.type === 'LineString') return [g.coordinates || []];
  if (g.type === 'MultiLineString') return g.coordinates || [];
  return [];
}

/**
 * Propose walkway candidates: guest segments whose midpoints sit far from the
 * current path layer. Output is research-only GeoJSON, not applied geometry.
 */
export function proposeWalkwaysFromTraces(collection, { existingPaths = [], gapM = 12 } = {}) {
  const pathCoords = [];
  for (const f of existingPaths) {
    for (const line of featureCoords(f)) pathCoords.push(line);
  }

  const candidates = [];
  for (const f of collection?.features || []) {
    const lines = featureCoords(f);
    for (const coords of lines) {
      if (!coords || coords.length < 2) continue;
      const mid = coords[Math.floor(coords.length / 2)];
      const [lng, lat] = mid;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const gap = pathCoords.length ? distToPaths(lat, lng, pathCoords) : Infinity;
      if (gap < gapM) continue;
      candidates.push({
        type: 'Feature',
        properties: {
          kind: 'guest_walkway_candidate',
          source: 'guest_trace',
          gapM: Math.round(gap),
          sessionId: f.properties?.sessionId,
          metres: f.properties?.metres,
          note: 'Guest walks here; no nearby path in the current venue graph. Review before promoting.',
        },
        geometry: { type: 'LineString', coordinates: coords },
      });
    }
  }

  return {
    type: 'FeatureCollection',
    properties: {
      source: 'parkbound_guest_movement',
      candidateCount: candidates.length,
      gapM,
    },
    features: candidates,
  };
}

export function guestTraceClaims(data) {
  const date = data?.fetched || new Date().toISOString().slice(0, 10);
  const features = data?.collection?.features || [];
  const claims = [];
  for (const f of features.slice(0, 80)) {
    if (f.geometry?.type !== 'LineString') continue;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const mid = coords[Math.floor(coords.length / 2)];
    claims.push({
      source: 'guest_trace',
      kind: 'path_geometry',
      at: { lat: mid[1], lng: mid[0] },
      date,
      note: `Guest walk ${Math.round(f.properties?.metres || 0)} m · ${coords.length} pts`,
      sessionId: f.properties?.sessionId,
    });
  }
  return claims;
}

/**
 * Ground-truth Point sightings → evidence claims for entrances, exits, gates,
 * amenities. Confirm mode is noted; dwell is softer but still useful.
 */
export function guestGroundTruthClaims(data) {
  const date = data?.fetched || new Date().toISOString().slice(0, 10);
  const features = data?.collection?.features || [];
  const claims = [];
  for (const f of features.slice(0, 120)) {
    if (f.properties?.kind !== 'guest_ground_truth' && f.geometry?.type !== 'Point') continue;
    if (f.geometry?.type !== 'Point') continue;
    const [lng, lat] = f.geometry.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const feature = f.properties?.feature || 'poi';
    const mode = f.properties?.mode || 'dwell';
    const delta = Number.isFinite(f.properties?.deltaM) ? `${f.properties.deltaM} m from published` : 'no published pin';
    claims.push({
      source: 'guest_trace',
      kind: feature,
      at: { lat, lng },
      date,
      note: `${mode} · ${f.properties?.placeName || f.properties?.placeId || 'place'} · ${delta}`,
      placeId: f.properties?.placeId || null,
      placeName: f.properties?.placeName || null,
      mode,
      deltaM: f.properties?.deltaM ?? null,
      published: f.properties?.published || null,
      sessionId: f.properties?.sessionId,
    });
  }
  return claims;
}

/**
 * When guest sightings for queue_entrance / ride_exit / park_entrance disagree
 * with the published pin (or there is none), emit review candidates.
 */
export function proposeEntranceCandidates(collection, { gapM = 15 } = {}) {
  const candidates = [];
  for (const f of collection?.features || []) {
    if (f.geometry?.type !== 'Point') continue;
    if (f.properties?.kind && f.properties.kind !== 'guest_ground_truth') continue;
    const feature = f.properties?.feature;
    if (!['queue_entrance', 'ride_exit', 'park_entrance'].includes(feature)) continue;
    const [lng, lat] = f.geometry.coordinates || [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const published = f.properties?.published;
    const deltaM = Number.isFinite(f.properties?.deltaM)
      ? f.properties.deltaM
      : published
        ? Math.round(
            Math.hypot(
              (lng - published.lng) * 111320 * Math.cos((lat * Math.PI) / 180),
              (lat - published.lat) * 110540,
            ),
          )
        : Infinity;
    if (published && deltaM < gapM) continue;
    candidates.push({
      type: 'Feature',
      properties: {
        kind: 'guest_entrance_candidate',
        feature,
        source: 'guest_trace',
        mode: f.properties?.mode || 'dwell',
        placeId: f.properties?.placeId,
        placeName: f.properties?.placeName,
        deltaM: Number.isFinite(deltaM) && deltaM !== Infinity ? Math.round(deltaM) : null,
        published: published || null,
        note: published
          ? `Guest ${f.properties?.mode || 'dwell'} is ${Math.round(deltaM)} m from published ${feature}. Review before promoting.`
          : `Guest ${f.properties?.mode || 'dwell'} proposes a ${feature} with no published pin. Review before promoting.`,
      },
      geometry: { type: 'Point', coordinates: [lng, lat] },
    });
  }
  return {
    type: 'FeatureCollection',
    properties: {
      source: 'parkbound_guest_movement',
      candidateCount: candidates.length,
      gapM,
    },
    features: candidates,
  };
}

export async function loadGuestTracesData(
  venueId,
  { fetch = false, offline = false, existingPaths = [] } = {},
) {
  const cached = readCache(venueId, 'guest-traces');
  if (offline) {
    return (
      cached || {
        fetched: null,
        collection: { type: 'FeatureCollection', features: [] },
        candidates: { type: 'FeatureCollection', features: [] },
        entranceCandidates: { type: 'FeatureCollection', features: [] },
        error: 'No guest-traces cache on disk.',
      }
    );
  }

  let collection = cached?.collection || null;

  if (fetch) {
    const base = process.env.GUEST_TRACES_API || process.env.PARKBOUND_API_BASE || '';
    const token = process.env.GUEST_TRACES_TOKEN || process.env.METRICS_TOKEN || '';
    if (base) {
      try {
        const url = `${base.replace(/\/$/, '')}/api/contributions/traces?venueId=${encodeURIComponent(venueId)}&format=geojson${
          token ? `&token=${encodeURIComponent(token)}` : ''
        }`;
        collection = await fetchJson(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } catch (err) {
        if (!collection) {
          return {
            fetched: null,
            collection: { type: 'FeatureCollection', features: [] },
            candidates: { type: 'FeatureCollection', features: [] },
            entranceCandidates: { type: 'FeatureCollection', features: [] },
            error: err.message,
          };
        }
      }
    }
  }

  if (!collection && cached?.collection) collection = cached.collection;
  if (!collection) {
    return {
      fetched: null,
      collection: { type: 'FeatureCollection', features: [] },
      candidates: { type: 'FeatureCollection', features: [] },
      entranceCandidates: { type: 'FeatureCollection', features: [] },
      error: 'No guest traces yet. Upload from the app or drop a cache file.',
    };
  }

  const pathFeatures = {
    type: 'FeatureCollection',
    features: (collection.features || []).filter((f) => f.geometry?.type === 'LineString'),
  };
  const candidates = proposeWalkwaysFromTraces(pathFeatures, { existingPaths });
  const entranceCandidates = proposeEntranceCandidates(collection);
  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    source: 'parkbound_guest_movement',
    license: 'guest opt-in contribution',
    collection,
    candidates,
    entranceCandidates,
    meta: {
      traces: pathFeatures.features.length,
      groundTruth: (collection.features || []).filter(
        (f) => f.properties?.kind === 'guest_ground_truth' || f.geometry?.type === 'Point',
      ).length,
      candidates: candidates.features?.length || 0,
      entranceCandidates: entranceCandidates.features?.length || 0,
    },
  };
  writeCache(venueId, 'guest-traces', out);
  return out;
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'guest-traces', ok: false, error: 'venueId_required' };
  try {
    const data = await loadGuestTracesData(id, {
      fetch: ctx.fetch ?? true,
      offline: ctx.offline,
      existingPaths: ctx.existingPaths || [],
    });
    return {
      adapterId: 'guest-traces',
      ok: true,
      meta: data.meta || { traces: 0, candidates: 0 },
      claims: [...guestTraceClaims(data), ...guestGroundTruthClaims(data)],
      artifacts: [guestTracesCacheFile(id)],
      data,
      error: data.error || undefined,
    };
  } catch (err) {
    return { adapterId: 'guest-traces', ok: false, error: err.message };
  }
}
