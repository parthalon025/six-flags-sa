/**
 * Normalize external adapter caches into evidence claims bound to places.
 *
 * Research adapters write *-cache.json and emit unbound claims. This module
 * matches them to rideable POIs and returns entrance/inventory shapes the
 * attractions inventory can feed through addEvidence — or metadata that never
 * publishes geometry.
 */

import { isRideable } from '@party-tracker/shared/ontology.js';
import { pairSuggestions } from './venue-judge.mjs';
import { readJson } from './venue-io.mjs';
import { parksApiCacheFile } from './adapters/parks-api.mjs';
import { mapillaryCacheFile, mapillaryClaims } from './adapters/mapillary-api.mjs';
import { accessibilityCloudCacheFile, accessibilityClaims } from './adapters/accessibility-cloud.mjs';
import { sidewalkClaims } from './adapters/project-sidewalk.mjs';
import { projectSidewalkCacheFile } from './adapters/project-sidewalk.mjs';
import { rcdbCacheFile, compareRcdbToBundle, rcdbClaims } from './adapters/rcdb.mjs';
import { wikidataCacheFile, wikidataClaims } from './adapters/wikidata.mjs';
import { queueTimesCacheFile, compareQueueTimesToBundle } from './adapters/queue-times.mjs';
import { llmResearchCacheFile } from './open-research.mjs';

/** Metres — Mapillary / a11y points beyond this do not attach to a ride. */
export const SNAP_RADIUS_M = 75;

const R = 6371000;
function metresBetween(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function nearestRide(pois, at, { maxM = SNAP_RADIUS_M } = {}) {
  const rides = pois.filter(isRideable);
  let best = null;
  let bestM = maxM;
  for (const ride of rides) {
    const m = metresBetween(at, { lat: ride.lat, lng: ride.lng });
    if (m < bestM) {
      bestM = m;
      best = ride;
    }
  }
  return best ? { ride: best, metres: bestM } : null;
}

function matchName(pois, name, { floor = 0.72 } = {}) {
  const rides = pois.filter(isRideable);
  const pair = pairSuggestions([name], rides.map((p) => p.n), { floor, limit: 1 })[0];
  if (!pair) return null;
  return rides.find((p) => p.n === pair.right) || null;
}

/**
 * ParksAPI attraction locations → queue_entrance candidates (corroboration only).
 */
export function parksApiEntranceClaims(parksApi, pois) {
  const date = parksApi?.fetched?.slice?.(0, 10) || parksApi?.fetched || null;
  const out = [];
  for (const row of parksApi?.attractions || []) {
    if (!row.at || !Number.isFinite(row.at.lat)) continue;
    const ride = matchName(pois, row.name);
    if (!ride) continue;
    out.push({
      ride: ride.n,
      place: ride.i || null,
      type: 'queue_entrance',
      source: 'parks_api',
      at: { lat: row.at.lat, lng: row.at.lng },
      date,
      why: `ParksAPI location for "${row.name}"`,
      kind: 'queue_entrance',
    });
  }
  return out;
}

/**
 * Imagery / a11y points snapped to nearest ride — corroboration, not sole publish.
 */
export function snapClaimsToRides(rawClaims, pois, { maxM = SNAP_RADIUS_M } = {}) {
  const out = [];
  for (const claim of rawClaims || []) {
    if (!claim.at || !Number.isFinite(claim.at.lat)) continue;
    const hit = nearestRide(pois, claim.at, { maxM });
    if (!hit) continue;
    const kind = claim.kind || 'imagery';
    if (kind === 'accessibility') {
      out.push({
        ...claim,
        ride: hit.ride.n,
        place: hit.ride.i || null,
        kind: 'accessibility',
        type: null,
        note: `${claim.note || 'accessibility'} (~${Math.round(hit.metres)} m from ride)`,
      });
      continue;
    }
    /* Imagery near a ride corroborates a queue area only as mapillary/aerial. */
    if (claim.source === 'mapillary' || claim.source === 'aerial') {
      out.push({
        ride: hit.ride.n,
        place: hit.ride.i || null,
        type: 'queue_entrance',
        source: claim.source,
        at: claim.at,
        date: claim.date,
        why: claim.note || `${claim.source} image near ride (~${Math.round(hit.metres)} m)`,
        kind: 'queue_entrance',
        uri: claim.uri,
      });
    }
  }
  return out;
}

/**
 * Inventory-only claims (Queue-Times names, RCDB, Wikidata) — never geometry.
 */
export function inventoryMetadataClaims({ queueTimes, rcdbCompare, rcdbRaw, wikidataRaw, llm }) {
  const out = [];
  const date = queueTimes?.fetched?.slice?.(0, 10) || null;
  for (const name of queueTimes?.onlyOnApi || []) {
    out.push({
      source: 'queue_times',
      kind: 'inventory',
      date,
      note: `Queue-Times lists "${name}" not matched in bundle`,
      ride: null,
      type: null,
    });
  }
  out.push(...rcdbClaims(rcdbRaw, rcdbCompare));
  out.push(...wikidataClaims(wikidataRaw));
  for (const gap of llm?.inventoryGaps || []) {
    out.push({
      source: 'llm_extract',
      kind: 'inventory',
      date: llm.fetched || null,
      note: gap.note || `Official page may list "${gap.name}" missing from bundle`,
      ride: gap.bundleMatch || null,
      type: null,
    });
  }
  return out;
}

/**
 * Load on-disk caches (no network) and produce entrance + metadata claim lists.
 *
 * @returns {{ entrance: object[], metadata: object[], stats: object }}
 */
export function collectExternalClaims(venueId, pois) {
  const parksApi = readJson(parksApiCacheFile(venueId), null);
  const mapillary = readJson(mapillaryCacheFile(venueId), null);
  const accessibility = readJson(accessibilityCloudCacheFile(venueId), null);
  const sidewalk = readJson(projectSidewalkCacheFile(venueId), null);
  const rcdbRaw = readJson(rcdbCacheFile(venueId), null);
  const wikidataRaw = readJson(wikidataCacheFile(venueId), null);
  const queueTimesRaw = readJson(queueTimesCacheFile(venueId), null);
  const llm = readJson(llmResearchCacheFile(venueId), null);

  const rcdbCompare = compareRcdbToBundle({ rcdb: rcdbRaw || {}, pois });
  const queueTimesCompare = compareQueueTimesToBundle({ queueTimes: queueTimesRaw || {}, pois });

  const entrance = [
    ...parksApiEntranceClaims(parksApi, pois),
    ...snapClaimsToRides(mapillaryClaims(mapillary), pois),
    ...snapClaimsToRides(accessibilityClaims(accessibility), pois),
    ...snapClaimsToRides(sidewalkClaims(sidewalk), pois),
  ];

  const metadata = inventoryMetadataClaims({
    queueTimes: { ...queueTimesCompare, fetched: queueTimesRaw?.fetched },
    rcdbCompare,
    rcdbRaw,
    wikidataRaw,
    llm,
  });

  return {
    entrance,
    metadata,
    stats: {
      parksApi: parksApi?.attractions?.length || 0,
      mapillary: mapillary?.images?.length || 0,
      entranceClaims: entrance.length,
      metadataClaims: metadata.length,
      llmAliases: llm?.aliases?.length || 0,
      llmHeightCandidates: llm?.heightCandidates?.length || 0,
    },
  };
}

/**
 * Apply entrance-shaped external claims onto attraction records via addEvidence.
 *
 * @param {Map|Iterable} recordsByName — map of name → record, or array of records
 * @param {object[]} entranceClaims
 * @param {(name: string) => object|null} recordFor
 * @param {typeof import('./attractions.mjs').addEvidence} addEvidence
 * @param {{ asOf?: string }} opts
 */
export function ingestExternalEntranceClaims(entranceClaims, recordFor, addEvidence, { asOf } = {}) {
  let applied = 0;
  const orphans = new Set();
  const folded = new Map();
  for (const claim of entranceClaims || []) {
    if (!claim.type || !claim.at || !claim.source) continue;
    const record = recordFor(claim.ride);
    if (!record) {
      orphans.add(claim.ride);
      continue;
    }
    if (!folded.has(record)) folded.set(record, new Map());
    folded.get(record).set(`${claim.type}\u0000${claim.source}`, claim);
  }
  for (const [record, perSource] of folded) {
    for (const claim of perSource.values()) {
      addEvidence(record, claim.type, claim, { asOf });
      applied += 1;
    }
  }
  return { applied, orphans: [...orphans] };
}
