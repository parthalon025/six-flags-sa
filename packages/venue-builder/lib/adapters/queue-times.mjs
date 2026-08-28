/**
 * Queue-Times.com adapter — wait times cross-check (MIT ecosystem).
 * https://queue-times.com/parks.json
 */

import { cachePath, readCache, writeCache, fetchJson } from './_cache.mjs';
import { pairSuggestions } from '../venue-judge.mjs';
import { QUEUE_TIMES_PARK_IDS } from '../park-slug-map.mjs';

const PARKS_URL = 'https://queue-times.com/parks.json';

export const queueTimesCacheFile = (id) => cachePath(id, 'queue-times');

let parksIndex = null;

async function loadParksIndex() {
  if (parksIndex) return parksIndex;
  const data = await fetchJson(PARKS_URL);
  const flat = [];
  for (const group of data || []) {
    for (const park of group.parks || []) {
      flat.push({ ...park, group: group.name });
    }
  }
  parksIndex = flat;
  return flat;
}

function resolveParkId(venueName, parks, venueId) {
  const overrideId = venueId && QUEUE_TIMES_PARK_IDS[venueId];
  if (overrideId != null) {
    const park = parks.find((p) => p.id === overrideId);
    if (park) return { id: park.id, name: park.name, group: park.group };
  }
  const names = parks.map((p) => p.name);
  const hit = pairSuggestions([venueName], names, { floor: 0.82, limit: 1 })[0];
  if (!hit) return null;
  const park = parks.find((p) => p.name === hit.right);
  return park ? { id: park.id, name: park.name, group: park.group } : null;
}

export async function loadQueueTimesData(venueId, { venueName, fetch = false, offline = false } = {}) {
  const cached = readCache(venueId, 'queue-times');
  if (offline) return cached || { fetched: null, rides: [], error: 'No cache on disk.' };
  if (!fetch && cached?.rides?.length) return cached;

  const parks = await loadParksIndex();
  const match = resolveParkId(venueName || venueId, parks, venueId);
  if (!match) {
    return cached || {
      fetched: null,
      parkId: null,
      rides: [],
      error: `No Queue-Times park match for "${venueName || venueId}".`,
    };
  }

  const live = await fetchJson(`https://queue-times.com/parks/${match.id}/queue_times.json`);
  const rides = [];
  for (const land of live.lands || []) {
    for (const ride of land.rides || []) {
      rides.push({
        name: ride.name,
        land: land.name,
        waitTime: ride.wait_time,
        isOpen: ride.is_open,
      });
    }
  }

  const out = {
    fetched: new Date().toISOString().slice(0, 19),
    source: 'queue-times.com',
    parkId: match.id,
    parkName: match.name,
    operator: match.group,
    rides,
  };
  writeCache(venueId, 'queue-times', out);
  return out;
}

export function compareQueueTimesToBundle({ queueTimes = {}, pois = [] } = {}) {
  const rides = pois.filter((p) => ['ride', 'coaster', 'slide'].includes(p.c));
  const bundleNames = rides.map((p) => p.n);
  const apiNames = (queueTimes.rides || []).map((r) => r.name);
  const matched = new Set();
  const pairs = [];
  for (const name of bundleNames) {
    const best = pairSuggestions([name], apiNames, { floor: 0.72, limit: 1 })[0];
    if (best) {
      matched.add(best.right);
      pairs.push({ bundle: name, api: best.right, score: best.score });
    }
  }
  return {
    apiCount: apiNames.length,
    bundleRideCount: bundleNames.length,
    matched: pairs.length,
    pairs,
    onlyOnApi: apiNames.filter((n) => !matched.has(n)).sort(),
    onlyInBundle: bundleNames.filter((n) => {
      const hit = pairSuggestions([n], apiNames, { floor: 0.72, limit: 1 })[0];
      return !hit;
    }).sort(),
  };
}

export async function run(ctx = {}) {
  const id = ctx.venueId;
  if (!id) return { adapterId: 'queue-times', ok: false, error: 'venueId_required' };
  try {
    const data = await loadQueueTimesData(id, { venueName: ctx.venueName, fetch: ctx.fetch ?? true, offline: ctx.offline });
    return {
      adapterId: 'queue-times',
      ok: true,
      meta: { count: data.rides?.length || 0, parkId: data.parkId },
      artifacts: [queueTimesCacheFile(id)],
      data,
    };
  } catch (err) {
    return { adapterId: 'queue-times', ok: false, error: err.message };
  }
}
