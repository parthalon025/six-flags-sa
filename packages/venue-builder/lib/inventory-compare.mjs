/**
 * How an external ride inventory lines up with the one this venue ships.
 *
 * Pure name comparison — no fetching, no cache reads, no venue I/O. It lived in
 * the two adapters that fetch those inventories, which also read the venue's
 * sidecars, so anything wanting the comparison inherited a path back to
 * `venue-io.mjs`; the shipped-gaps lane needs the comparison and none of the
 * fetching, and importing it through the adapter closed a dependency cycle (#29).
 * Both adapters re-export from here, so their existing callers are unchanged.
 *
 * Interface:
 *   compareParksApiToBundle({ parksApi, pois })
 *   compareQueueTimesToBundle({ queueTimes, pois })
 *
 * Both return `{ apiCount, bundleRideCount, matched, pairs, onlyOnApi, onlyInBundle }`.
 */

import { pairSuggestions } from './name-matching.mjs';

/** What the two inventories agree counts as a ride. */
const RIDEABLE = ['ride', 'coaster', 'slide'];

/** The floor both comparisons pair on — below it, two names are different rides. */
const MATCH_FLOOR = 0.72;

function compareInventories(bundleNames, apiNames) {
  const matched = new Set();
  const pairs = [];
  for (const name of bundleNames) {
    const best = pairSuggestions([name], apiNames, { floor: MATCH_FLOOR, limit: 1 })[0];
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
    // Not the complement of `pairs`: a bundle name can lose its pairing to an
    // earlier, better-scoring one and still have an API name it matches, which
    // is a rename to reconcile rather than a ride the API has never heard of.
    onlyInBundle: bundleNames
      .filter((n) => !pairSuggestions([n], apiNames, { floor: MATCH_FLOOR, limit: 1 })[0])
      .sort(),
  };
}

export function compareParksApiToBundle({ parksApi = {}, pois = [] } = {}) {
  return compareInventories(
    pois.filter((p) => RIDEABLE.includes(p.c)).map((p) => p.n),
    (parksApi.attractions || []).map((a) => a.name),
  );
}

export function compareQueueTimesToBundle({ queueTimes = {}, pois = [] } = {}) {
  return compareInventories(
    pois.filter((p) => RIDEABLE.includes(p.c)).map((p) => p.n),
    (queueTimes.rides || []).map((r) => r.name),
  );
}
