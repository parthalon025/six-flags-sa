/**
 * Normalize external adapter caches into evidence claims bound to places.
 *
 * Research adapters write *-cache.json and emit unbound claims. This module
 * matches them to rideable POIs and returns entrance/inventory shapes the
 * attractions inventory can feed through addEvidence — or metadata that never
 * publishes geometry.
 *
 * Contract (EvidenceClaim):
 *   { feature_id|ride, place, source, kind, at?, date, uri?, note, type? }
 *
 * Publish kinds: queue_entrance | ride_exit (only when `at` is present).
 * Never publish: inventory | metadata | open-meteo climate | wait minutes |
 * esa-worldcover land cover.
 */

import { isRideable } from '@party-tracker/shared/ontology.js';
import { pairSuggestions } from './venue-judge.mjs';
import { readJson } from './venue-io.mjs';
import { parksApiCacheFile } from './adapters/parks-api.mjs';
import { mapillaryCacheFile, mapillaryClaims } from './adapters/mapillary-api.mjs';
import { accessibilityCloudCacheFile, accessibilityClaims } from './adapters/accessibility-cloud.mjs';
import { sidewalkClaims, projectSidewalkCacheFile } from './adapters/project-sidewalk.mjs';
import { rcdbCacheFile, compareRcdbToBundle, rcdbClaims } from './adapters/rcdb.mjs';
import { wikidataCacheFile, wikidataClaims } from './adapters/wikidata.mjs';
import { queueTimesCacheFile, compareQueueTimesToBundle } from './adapters/queue-times.mjs';
import { ohmCacheFile } from './adapters/openhistoricalmap.mjs';
import { openMeteoCacheFile } from './adapters/open-meteo.mjs';
import { ropedropCacheFile } from './adapters/ropedrop.mjs';
import { worldcoverCacheFile, worldcoverClaims } from './adapters/esa-worldcover.mjs';
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

/** Stamp EvidenceClaim contract fields without inventing geometry. */
export function toEvidenceClaim(claim = {}) {
  const kind = claim.kind
    || (claim.type === 'queue_entrance' || claim.type === 'ride_exit' ? claim.type : null)
    || 'metadata';
  const place = claim.place || claim.feature_id || null;
  const ride = claim.ride || null;
  return {
    feature_id: place || ride || claim.feature_id || null,
    place,
    ride,
    source: claim.source,
    kind,
    type: claim.type || (kind === 'queue_entrance' || kind === 'ride_exit' ? kind : null),
    at: claim.at && Number.isFinite(claim.at.lat) ? { lat: claim.at.lat, lng: claim.at.lng } : null,
    date: claim.date || null,
    uri: claim.uri || null,
    note: claim.note || claim.why || null,
    why: claim.why || claim.note || null,
  };
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
    out.push(toEvidenceClaim({
      ride: ride.n,
      place: ride.i || null,
      feature_id: ride.i || ride.n,
      type: 'queue_entrance',
      source: 'parks_api',
      at: { lat: row.at.lat, lng: row.at.lng },
      date,
      why: `ParksAPI location for "${row.name}"`,
      kind: 'queue_entrance',
    }));
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
      out.push(toEvidenceClaim({
        ...claim,
        ride: hit.ride.n,
        place: hit.ride.i || null,
        feature_id: hit.ride.i || hit.ride.n,
        kind: 'accessibility',
        type: null,
        note: `${claim.note || 'accessibility'} (~${Math.round(hit.metres)} m from ride)`,
      }));
      continue;
    }
    /* Imagery near a ride corroborates a queue area only as mapillary/aerial. */
    if (claim.source === 'mapillary' || claim.source === 'aerial') {
      out.push(toEvidenceClaim({
        ride: hit.ride.n,
        place: hit.ride.i || null,
        feature_id: hit.ride.i || hit.ride.n,
        type: 'queue_entrance',
        source: claim.source,
        at: claim.at,
        date: claim.date,
        why: claim.note || `${claim.source} image near ride (~${Math.round(hit.metres)} m)`,
        kind: 'queue_entrance',
        uri: claim.uri,
      }));
    }
  }
  return out;
}

/** Queue-Times inventory names — never wait minutes. */
export function queueTimesInventoryClaims(queueTimesCompare, fetched) {
  const date = fetched?.slice?.(0, 10) || fetched || null;
  const out = [];
  for (const name of queueTimesCompare?.onlyOnApi || []) {
    out.push(toEvidenceClaim({
      source: 'queue_times',
      kind: 'inventory',
      date,
      note: `Queue-Times lists "${name}" not matched in bundle`,
      ride: null,
      type: null,
    }));
  }
  for (const name of queueTimesCompare?.onlyInBundle || []) {
    out.push(toEvidenceClaim({
      source: 'queue_times',
      kind: 'inventory',
      date,
      note: `Bundle ride "${name}" not listed on Queue-Times`,
      ride: name,
      type: null,
    }));
  }
  return out;
}

/** RopeDrop — inventory/research only; wait minutes stay builder context. */
export function ropedropInventoryClaims(raw) {
  if (!raw) return [];
  if (!raw.slug) {
    return [toEvidenceClaim({
      source: 'ropedrop',
      kind: 'metadata',
      date: null,
      note: raw.error || 'No RopeDrop slug for this venue (Disney/Universal only)',
      type: null,
    })];
  }
  return [toEvidenceClaim({
    source: 'ropedrop',
    kind: 'inventory',
    date: raw.fetched?.slice?.(0, 10) || raw.fetched || null,
    note: `RopeDrop slug "${raw.slug}" available for research — wait times stay builder-only`,
    type: null,
  })];
}

/** OpenHistoricalMap — historical context, never current entrance. */
export function ohmMetadataClaims(ohmRaw) {
  const date = ohmRaw?.fetched || null;
  return (ohmRaw?.features || []).slice(0, 25).map((f) => toEvidenceClaim({
    source: 'openhistoricalmap',
    kind: 'metadata',
    date,
    note: `historical: ${f.tags?.name || f.tags?.historic || `${f.type}/${f.id}`}`,
    at: Number.isFinite(f.lat) ? { lat: f.lat, lng: f.lng } : null,
    type: null,
  }));
}

/** Open-Meteo — climate research context; never into pois. */
export function openMeteoMetadataClaims(raw) {
  if (!raw?.hourly && !raw?.daily && !raw?.current) return [];
  return [toEvidenceClaim({
    source: 'open_meteo',
    kind: 'metadata',
    date: raw.fetched?.slice?.(0, 10) || raw.fetched || null,
    note: 'Climate context for research — never published to pois',
    type: null,
  })];
}

/**
 * ESA WorldCover — the venue's own ground, classified from 10 m aerial raster.
 *
 * The adapter has always emitted this claim and nothing read it: the cache was
 * the one external payload `loadExternalCaches` did not open, so the repo's
 * only live COG source produced evidence that went nowhere.
 *
 * It arrives here and not through `snapClaimsToRides`, which is the whole
 * point. That function's `source === 'aerial'` branch turns an imagery point
 * into a queue entrance for any ride within SNAP_RADIUS_M — correct for a
 * Mapillary photo taken outside a queue, wrong for this, which is anchored at
 * the venue centre and says something about the park rather than about
 * whichever ride happens to stand near the middle of it. Routed that way it
 * would hand a real entrance coordinate, and +4 of confidence, to an arbitrary
 * ride. `metadata` is what it is, so `metadata` is where it goes.
 */
export function worldcoverMetadataClaims(raw) {
  if (!raw?.histogram || !raw?.center) return [];
  return worldcoverClaims(raw.histogram, raw.center, { date: raw.fetched })
    .map((claim) => toEvidenceClaim({ ...claim, type: null }));
}

/**
 * Inventory-only claims (Queue-Times names, RCDB, Wikidata, RopeDrop, OHM,
 * Open-Meteo, ESA WorldCover) — never geometry.
 */
export function inventoryMetadataClaims({
  queueTimes,
  rcdbCompare,
  rcdbRaw,
  wikidataRaw,
  llm,
  ropedropRaw,
  ohmRaw,
  openMeteoRaw,
  worldcoverRaw,
} = {}) {
  const out = [
    ...queueTimesInventoryClaims(queueTimes, queueTimes?.fetched),
    ...rcdbClaims(rcdbRaw, rcdbCompare).map(toEvidenceClaim),
    ...wikidataClaims(wikidataRaw).map(toEvidenceClaim),
    ...ropedropInventoryClaims(ropedropRaw),
    ...ohmMetadataClaims(ohmRaw),
    ...openMeteoMetadataClaims(openMeteoRaw),
    ...worldcoverMetadataClaims(worldcoverRaw),
  ];
  for (const gap of llm?.inventoryGaps || []) {
    out.push(toEvidenceClaim({
      source: 'llm_extract',
      kind: 'inventory',
      date: llm.fetched || null,
      note: gap.note || `Official page may list "${gap.name}" missing from bundle`,
      ride: gap.bundleMatch || null,
      type: null,
    }));
  }
  return out;
}

/**
 * Normalize all external payloads into the EvidenceClaim contract.
 *
 * Matching order: ParksAPI / Queue-Times / RCDB / RopeDrop by name;
 * Mapillary / a11y / sidewalk by nearest Rideable within SNAP_RADIUS_M;
 * Wikidata / OHM / Open-Meteo / ESA WorldCover as venue-level metadata (never
 * entrance fusion).
 *
 * @param {string} venueId
 * @param {{ pois?: object[], external?: object }} opts
 * @returns {{ claims: object[], entrance: object[], metadata: object[], stats: object }}
 */
export function normalizeExternalClaims(venueId, { pois = [], external = null } = {}) {
  const ext = external || loadExternalCaches(venueId, pois);
  const entrance = [
    ...parksApiEntranceClaims(ext.parksApiRaw, pois),
    ...snapClaimsToRides(mapillaryClaims(ext.mapillaryRaw), pois),
    ...snapClaimsToRides(accessibilityClaims(ext.accessibilityRaw), pois),
    ...snapClaimsToRides(sidewalkClaims(ext.sidewalkRaw), pois),
  ].map(toEvidenceClaim);

  const metadata = inventoryMetadataClaims({
    queueTimes: {
      ...(ext.queueTimesCompare || {}),
      fetched: ext.queueTimesRaw?.fetched,
    },
    rcdbCompare: ext.rcdbCompare,
    rcdbRaw: ext.rcdbRaw,
    wikidataRaw: ext.wikidataRaw,
    llm: ext.llm,
    ropedropRaw: ext.ropedropRaw,
    ohmRaw: ext.ohmRaw,
    openMeteoRaw: ext.openMeteoRaw,
    worldcoverRaw: ext.worldcoverRaw,
  });

  const claims = [...entrance, ...metadata];
  return {
    venueId,
    claims,
    entrance,
    metadata,
    stats: {
      parksApi: ext.parksApiRaw?.attractions?.length || 0,
      mapillary: ext.mapillaryRaw?.images?.length || 0,
      entranceClaims: entrance.length,
      metadataClaims: metadata.length,
      attachedToPlaces: claims.filter((c) => c.place || c.ride).length,
      bySource: tallyBySource(claims),
      llmAliases: ext.llm?.aliases?.length || 0,
      llmHeightCandidates: ext.llm?.heightCandidates?.length || 0,
    },
  };
}

function tallyBySource(claims) {
  const out = {};
  for (const c of claims || []) {
    const s = c.source || 'unknown';
    out[s] = (out[s] || 0) + 1;
  }
  return out;
}

function loadExternalCaches(venueId, pois) {
  const parksApiRaw = readJson(parksApiCacheFile(venueId), null);
  const mapillaryRaw = readJson(mapillaryCacheFile(venueId), null);
  const accessibilityRaw = readJson(accessibilityCloudCacheFile(venueId), null);
  const sidewalkRaw = readJson(projectSidewalkCacheFile(venueId), null);
  const rcdbRaw = readJson(rcdbCacheFile(venueId), null);
  const wikidataRaw = readJson(wikidataCacheFile(venueId), null);
  const queueTimesRaw = readJson(queueTimesCacheFile(venueId), null);
  const ohmRaw = readJson(ohmCacheFile(venueId), null);
  const openMeteoRaw = readJson(openMeteoCacheFile(venueId), null);
  const ropedropRaw = readJson(ropedropCacheFile(venueId), null);
  const worldcoverRaw = readJson(worldcoverCacheFile(venueId), null);
  const llm = readJson(llmResearchCacheFile(venueId), null);

  return {
    parksApiRaw,
    mapillaryRaw,
    accessibilityRaw,
    sidewalkRaw,
    rcdbRaw,
    rcdbCompare: compareRcdbToBundle({ rcdb: rcdbRaw || {}, pois }),
    wikidataRaw,
    queueTimesRaw,
    queueTimesCompare: compareQueueTimesToBundle({ queueTimes: queueTimesRaw || {}, pois }),
    ohmRaw,
    openMeteoRaw,
    ropedropRaw,
    worldcoverRaw,
    llm,
  };
}

/**
 * Load on-disk caches (no network) and produce entrance + metadata claim lists.
 *
 * @returns {{ entrance: object[], metadata: object[], claims: object[], stats: object }}
 */
export function collectExternalClaims(venueId, pois) {
  return normalizeExternalClaims(venueId, { pois });
}

/**
 * Apply entrance-shaped external claims onto attraction records via addEvidence.
 *
 * Observation dates on claims are preserved — `asOf` is only a fallback when a
 * claim has no date (see addEvidence).
 */
export function ingestExternalEntranceClaims(entranceClaims, recordFor, addEvidence, { asOf } = {}) {
  let applied = 0;
  const orphans = new Set();
  const folded = new Map();
  for (const claim of entranceClaims || []) {
    if (!claim.type || !claim.at || !claim.source) continue;
    const record = recordFor(claim.ride || claim.feature_id || claim.place);
    if (!record) {
      orphans.add(claim.ride || claim.feature_id);
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

/**
 * Fold matched external claims into attraction records / asks / evidence-graph nodes.
 *
 * - queue_entrance | ride_exit + at → addEvidence (publish path)
 * - accessibility → place note on sidecar record (not an entrance)
 * - inventory / metadata / unbound imagery → graph nodes + asks, never pois geometry
 *
 * @param {Iterable|Map} records
 * @param {object[]} claims
 * @param {{ asOf?: string, addEvidence: Function, recordFor: (key: string) => object|null }} opts
 */
export function ingestExternalClaims(records, claims, { asOf, addEvidence, recordFor } = {}) {
  if (typeof addEvidence !== 'function' || typeof recordFor !== 'function') {
    throw new Error('ingestExternalClaims requires addEvidence and recordFor');
  }

  const entrance = [];
  const asks = [];
  const graphNodes = [];
  let accessibility = 0;
  let metadata = 0;

  for (const raw of claims || []) {
    const claim = toEvidenceClaim(raw);
    const kind = claim.kind;
    const publishable =
      (kind === 'queue_entrance' || kind === 'ride_exit' || claim.type === 'queue_entrance' || claim.type === 'ride_exit')
      && claim.at;

    if (publishable) {
      entrance.push({ ...claim, type: claim.type || kind });
      continue;
    }

    if (kind === 'accessibility') {
      const record = recordFor(claim.ride || claim.feature_id || claim.place);
      if (record) {
        if (!Array.isArray(record.external)) record.external = [];
        record.external.push({
          source: claim.source,
          kind: 'accessibility',
          at: claim.at,
          date: claim.date,
          note: claim.note,
          uri: claim.uri,
        });
        accessibility += 1;
      } else {
        graphNodes.push({ id: `a11y:${claim.source}:${graphNodes.length}`, kind: 'metadata', claims: [claim] });
        metadata += 1;
      }
      continue;
    }

    if (kind === 'inventory') {
      asks.push({
        key: `external-inventory:${claim.source}:${claim.ride || claim.note || metadata}`,
        need: claim.note || `Inventory gap from ${claim.source}`,
        source: claim.source,
        blocking: false,
      });
    }

    graphNodes.push({
      id: `ext:${claim.source}:${kind}:${graphNodes.length}`,
      kind: kind === 'imagery' ? 'imagery' : 'metadata',
      label: claim.note || claim.source,
      rideName: claim.ride || null,
      claims: [claim],
      published: false,
    });
    metadata += 1;
  }

  const entranceResult = ingestExternalEntranceClaims(entrance, recordFor, addEvidence, { asOf });

  return {
    applied: entranceResult.applied,
    orphans: entranceResult.orphans,
    accessibility,
    metadata,
    asks,
    graphNodes,
    entrance: entrance.length,
  };
}
