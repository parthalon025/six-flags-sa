/**
 * Adapter cache freshness — how long a sidecar cache stays trustworthy.
 *
 * Declared per adapter in sources.json (`datasets.adapterFreshness`) or via
 * defaults tuned to how fast each source changes.
 */

export const DEFAULT_ADAPTER_FRESHNESS_DAYS = Object.freeze({
  'queue-times': 7,
  'parks-api': 30,
  'open-meteo': 1,
  wikidata: 180,
  rcdb: 180,
  'mapillary-api': 90,
  'accessibility-cloud': 90,
  'project-sidewalk': 90,
  openhistoricalmap: 180,
  'esa-worldcover': 365,
  'overture-buildings': 180,
  'naip-planetary': 365,
  openrouteservice: 90,
  ropedrop: 7,
  'google-places': 30,
});

export const DEFAULT_FRESHNESS_DAYS = 90;

/** Rough feature class a stale adapter affects — for quest seed copy and gap routing. */
export const ADAPTER_FEATURE_CLASS = Object.freeze({
  'queue-times': 'queue',
  ropedrop: 'queue',
  'parks-api': 'inventory',
  rcdb: 'inventory',
  wikidata: 'metadata',
  'open-meteo': 'conditions',
  'mapillary-api': 'geometry',
  'accessibility-cloud': 'accessibility',
  'project-sidewalk': 'accessibility',
  openhistoricalmap: 'geometry',
  'esa-worldcover': 'landcover',
  'overture-buildings': 'footprint',
  'naip-planetary': 'aerial',
  openrouteservice: 'routing',
  'google-places': 'poi',
});

export function adapterFeatureClass(adapterId) {
  return ADAPTER_FEATURE_CLASS[adapterId] ?? 'external_research';
}

/**
 * @param {string} adapterId
 * @param {object | null} catalog sources.json payload
 */
export function freshnessDaysForAdapter(adapterId, catalog = null) {
  const custom = catalog?.datasets?.adapterFreshness?.[adapterId];
  if (Number.isFinite(custom) && custom > 0) return custom;
  return DEFAULT_ADAPTER_FRESHNESS_DAYS[adapterId] ?? DEFAULT_FRESHNESS_DAYS;
}

/**
 * @param {object | null} cache
 * @param {number} freshnessDays
 * @param {string | Date} [asOf]
 */
export function adapterCacheIsStale(cache, freshnessDays, asOf = new Date()) {
  const fetched = cache?.fetched;
  if (!fetched) {
    return { stale: true, fetched: null, freshnessDays, why: 'cache has no fetched timestamp' };
  }
  const asOfMs = new Date(asOf).getTime();
  const fetchedMs = new Date(fetched).getTime();
  if (!Number.isFinite(asOfMs) || !Number.isFinite(fetchedMs)) {
    return { stale: true, fetched, freshnessDays, why: 'unparseable timestamp' };
  }
  const maxMs = freshnessDays * 86_400_000;
  const stale = asOfMs - fetchedMs > maxMs;
  return {
    stale,
    fetched,
    freshnessDays,
    why: stale ? `fetched ${fetched}, window ${freshnessDays} day(s)` : null,
  };
}
