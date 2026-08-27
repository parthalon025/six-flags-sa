/**
 * Inventory under-coverage → shipped gaps and quest seeds.
 *
 * When ParksAPI or Queue-Times matches fewer than half of published rideables,
 * promote the certify brief's inventory asks into `*.gaps.json` and Scout seeds.
 * Shared by venue-certify (asks) and ship-gaps (gaps + seeds).
 */

import { compareParksApiToBundle } from './adapters/parks-api.mjs';
import { compareQueueTimesToBundle } from './adapters/queue-times.mjs';
import { isRideable } from '@party-tracker/shared/ontology.js';

export const INVENTORY_COVERAGE_THRESHOLD = 0.5;

const INVENTORY_TO_QUEST = Object.freeze({
  'parks-api-inventory': {
    type: 'name_fix',
    tier: 2,
    graduation: 'overrides_alias',
    sourceGap: 'parks-api-inventory',
    whyOpenSourceFails:
      'ParksAPI names and our bundle drift — guests who read the sign settle what is actually here.',
  },
  'queue-times-inventory': {
    type: 'name_fix',
    tier: 2,
    graduation: 'overrides_alias',
    sourceGap: 'queue-times-inventory',
    whyOpenSourceFails:
      'Queue-Times inventory and our bundle drift — confirm ride names on the ground.',
  },
});

function parksApiNeed(matched, rideableCount) {
  return `ParksAPI matched ${matched}/${rideableCount} rides — declare gaps or improve aliases`;
}

function queueTimesNeed(matched, rideableCount) {
  return `Queue-Times matched ${matched}/${rideableCount} rides — builder QA only, never wait minutes in pois`;
}

function unmatchedRideableNames(rideables, compare) {
  const matched = new Set((compare?.pairs || []).map((p) => p.bundle));
  return rideables.map((p) => p.n).filter((n) => n && !matched.has(n)).sort();
}

/**
 * Soft inventory asks when adapter coverage is below threshold.
 * @param {{ pois?: object[], parksApiCache?: object | null, qtCache?: object | null, gapNotes?: Record<string, string> }} opts
 */
export function inventoryAsksFromAdapters({
  pois = [],
  parksApiCache = null,
  qtCache = null,
  gapNotes = {},
} = {}) {
  const rideables = pois.filter(isRideable);
  const asks = [];

  if (parksApiCache?.attractions?.length && !gapNotes['parks-api']) {
    const compare = compareParksApiToBundle({ parksApi: parksApiCache, pois });
    const coverage = rideables.length ? compare.matched / rideables.length : 1;
    if (coverage < INVENTORY_COVERAGE_THRESHOLD) {
      asks.push({
        key: 'parks-api-inventory',
        need: parksApiNeed(compare.matched, rideables.length),
        blocking: false,
        compare: {
          ...compare,
          onlyInBundle: unmatchedRideableNames(rideables, compare),
        },
        coverage,
      });
    }
  }

  if (qtCache?.rides?.length && !gapNotes['queue-times']) {
    const compare = compareQueueTimesToBundle({ queueTimes: qtCache, pois });
    const coverage = rideables.length ? compare.matched / rideables.length : 1;
    if (coverage < INVENTORY_COVERAGE_THRESHOLD) {
      asks.push({
        key: 'queue-times-inventory',
        need: queueTimesNeed(compare.matched, rideables.length),
        blocking: false,
        compare: {
          ...compare,
          onlyInBundle: unmatchedRideableNames(rideables, compare),
        },
        coverage,
      });
    }
  }

  return { asks };
}

/** Strip internal compare fields before writing certification ask brief inventory rows. */
export function inventoryAsksForBrief(asks = []) {
  return asks.map(({ key, need, blocking }) => ({ key, need, blocking }));
}

/**
 * Shipped `{ type, target }` rows for inventory under-coverage.
 * @param {object[]} asks from inventoryAsksFromAdapters
 */
export function inventoryGapsFromAsks(asks = []) {
  const gaps = [];
  const seen = new Set();
  for (const ask of asks) {
    const names = ask.compare?.onlyInBundle || [];
    if (names.length) {
      for (const name of names.slice(0, 40)) {
        const key = `inventory:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        gaps.push({ type: 'inventory', target: name });
      }
      continue;
    }
    if (ask.coverage != null) {
      const key = 'inventory:';
      if (!seen.has(key)) {
        seen.add(key);
        gaps.push({ type: 'inventory', target: null });
      }
    }
  }
  return gaps;
}

/**
 * Scout quest seeds for inventory gaps — one seed per unmatched bundle ride.
 * @param {string} venueId
 * @param {object[]} asks
 */
export function questSeedsFromInventory(venueId, asks = []) {
  const seeds = [];
  for (const ask of asks) {
    const map = INVENTORY_TO_QUEST[ask.key];
    if (!map) continue;
    const targets = ask.compare?.onlyInBundle?.length
      ? ask.compare.onlyInBundle.slice(0, 40)
      : [null];
    for (const target of targets) {
      seeds.push({
        venueId,
        type: map.type,
        tier: map.tier,
        graduation: map.graduation,
        sourceGap: map.sourceGap,
        target,
        blocking: Boolean(ask.blocking),
        whyOpenSourceFails: map.whyOpenSourceFails,
        need: ask.need,
      });
    }
  }
  return seeds;
}

/**
 * Gaps + seeds to fold into shipped venue artifacts.
 */
export function inventoryShipArtifacts({
  venueId,
  pois = [],
  parksApiCache = null,
  qtCache = null,
  gapNotes = {},
} = {}) {
  const { asks } = inventoryAsksFromAdapters({ pois, parksApiCache, qtCache, gapNotes });
  return {
    asks,
    gaps: inventoryGapsFromAsks(asks),
    seeds: questSeedsFromInventory(venueId, asks),
  };
}
