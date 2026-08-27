/**
 * Ambient quest seeds from builder signals — stale adapter caches and
 * conflicting evidence nodes (#420).
 *
 * Shared by quest-seeds (certification brief) and ship-gaps (shipped output).
 */

import { graphFromSidecar } from './evidence-graph.mjs';

/** Declared freshness windows per adapter id (days). */
export const ADAPTER_CACHE_FRESHNESS_DAYS = Object.freeze({
  'parks-api': 30,
  'queue-times': 30,
  ropedrop: 14,
  wikidata: 180,
  rcdb: 180,
  'open-meteo': 1,
  openhistoricalmap: 180,
  'project-sidewalk': 90,
  'mapillary-api': 60,
  'esa-worldcover': 365,
  'overture-buildings': 180,
  openrouteservice: 90,
  'google-places': 30,
  playwright: 30,
  'accessibility-cloud': 90,
});

const DEFAULT_FRESHNESS_DAYS = 90;

const STALE_QUEST = Object.freeze({
  type: 'verify_source',
  tier: 1,
  graduation: 'overlay_ttl',
  whyOpenSourceFails:
    'Cached adapter data is older than its freshness window — on-the-ground verification refreshes what open data cannot keep current.',
});

const CONFLICT_QUEST = Object.freeze({
  type: 'settle_conflict',
  tier: 2,
  graduation: 'attractions_evidence',
  whyOpenSourceFails:
    'Independent sources disagree about this feature — a guest on site settles which claim matches reality.',
});

/**
 * @param {{ fetched?: string | null }} cache
 * @param {number} freshnessDays
 * @param {string} asOf ISO date YYYY-MM-DD
 */
export function adapterCacheIsStale(cache, freshnessDays, asOf) {
  const fetched = cache?.fetched;
  if (!fetched) return false;
  const asOfDate = new Date(`${asOf}T12:00:00Z`);
  const fetchedDate = new Date(`${String(fetched).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(fetchedDate.getTime())) return true;
  const cutoff = new Date(asOfDate);
  cutoff.setDate(cutoff.getDate() - freshnessDays);
  return fetchedDate < cutoff;
}

function featureClassForAdapter(adapterId) {
  if (adapterId === 'parks-api' || adapterId === 'queue-times' || adapterId === 'ropedrop') {
    return 'ride_inventory';
  }
  if (adapterId === 'open-meteo') return 'weather';
  if (adapterId === 'wikidata' || adapterId === 'rcdb') return 'metadata';
  return 'venue_data';
}

/**
 * @param {string} venueId
 * @param {Record<string, object | null>} adapterCaches adapter id → cache payload
 * @param {Record<string, string>} gapNotes declared adapter gaps from sources.json
 * @param {string} [asOf] ISO date for staleness comparison
 */
export function questSeedsFromStaleAdapters(venueId, adapterCaches = {}, gapNotes = {}, asOf) {
  const today = asOf || new Date().toISOString().slice(0, 10);
  const seeds = [];
  for (const [adapterId, cache] of Object.entries(adapterCaches || {})) {
    if (!cache || gapNotes[adapterId]) continue;
    const freshnessDays = ADAPTER_CACHE_FRESHNESS_DAYS[adapterId] ?? DEFAULT_FRESHNESS_DAYS;
    if (!adapterCacheIsStale(cache, freshnessDays, today)) continue;
    const featureClass = featureClassForAdapter(adapterId);
    seeds.push({
      venueId,
      ...STALE_QUEST,
      sourceGap: 'adapter_stale',
      target: null,
      blocking: false,
      adapterId,
      featureClass,
      freshnessDays,
      fetched: cache.fetched || null,
      need: `Verify ${adapterId} ${featureClass.replace(/_/g, ' ')} — cache from ${cache.fetched || 'unknown date'}`,
    });
  }
  return seeds;
}

/**
 * @param {string} venueId
 * @param {object | null} attractionsSidecar
 */
export function questSeedsFromConflicts(venueId, attractionsSidecar) {
  if (!attractionsSidecar) return [];
  const { nodes } = graphFromSidecar(attractionsSidecar);
  const seeds = [];
  const seen = new Set();
  for (const node of nodes) {
    if (node.kind === 'ride') continue;
    const rideKey = node.id?.split(':')[0] || null;
    const row = (attractionsSidecar.attractions || []).find(
      (a) => a.id === rideKey || a.name === node.rideName,
    );
    const featureKey = node.id?.split(':').slice(1).join(':') || node.label;
    const slot = row?.features?.[featureKey];
    const conflict = Boolean(node.fusion?.conflict || slot?.conflict);
    const target = row?.place || row?.id || rideKey || null;
    const dedupe = `${target}:${node.kind}`;
    if (!conflict || !target || seen.has(dedupe)) continue;
    seen.add(dedupe);
    seeds.push({
      venueId,
      ...CONFLICT_QUEST,
      sourceGap: 'evidence_conflict',
      target,
      blocking: false,
      featureKind: node.kind,
      need: `Settle ${node.kind} conflict at ${node.rideName || target}`,
      report: node.report || null,
    });
  }
  return seeds.slice(0, 40);
}

/**
 * Seeds for ship-gaps / quest-seeds composers.
 */
export function ambientSignalShipArtifacts({
  venueId,
  adapterCaches = {},
  attractions = null,
  gapNotes = {},
  asOf,
} = {}) {
  const seeds = [
    ...questSeedsFromStaleAdapters(venueId, adapterCaches, gapNotes, asOf),
    ...questSeedsFromConflicts(venueId, attractions),
  ];
  return { seeds };
}
