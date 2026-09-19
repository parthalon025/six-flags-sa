/**
 * Venue-data adapter bake-off — legacy cubehouse/themeparks vs ParksAPI (#413).
 *
 * Builder-side only: compares acquisition models and inventory coverage for
 * fields the venue builder actually consumes. Does not install the legacy npm
 * package; the legacy profile is documented from upstream README + registry.
 */

/** Shared JSON schema version for venue-data adapter comparison reports. */
export const VENUE_DATA_BAKEOFF_SCHEMA = 'venue-data-adapter-bakeoff/1';

/** Registry ids under comparison. */
export const LEGACY_ADAPTER_ID = 'themeparks-cubehouse';
export const SUCCESSOR_ADAPTER_ID = 'parks-api';

/** Static profile of cubehouse/themeparks 5.x (unmaintained successor to ParksAPI). */
export const LEGACY_PROFILE = {
  id: LEGACY_ADAPTER_ID,
  repo: 'cubehouse/themeparks',
  license: 'MIT',
  maintenance: 2,
  acquisition: 'per-park JavaScript class with direct operator scrapers',
  parkIdentification: 'hard-coded park class (e.g. WaltDisneyWorldMagicKingdom)',
  inventory: 'GetWaitTimes() per park instance; SQLite cache optional',
  hours: 'GetOpeningTimes() per park instance',
  waitTimes: 'live scrape per park class',
  integration: 'npm dependency + persistent park object; high cold-start cost',
  status: 'unmaintained — README directs consumers to ThemeParks.wiki API',
};

/** Profile of the wrapped ParksAPI / ThemeParks.wiki REST surface. */
export const SUCCESSOR_PROFILE = {
  id: SUCCESSOR_ADAPTER_ID,
  repo: 'cubehouse/ParksAPI',
  api: 'api.themeparks.wiki/v1',
  license: 'MIT',
  maintenance: 4,
  acquisition: 'entity UUID + REST (/entity/{id}/children, /live, /schedule)',
  parkIdentification: 'entity UUID via parks-api-entity-map.json',
  inventory: 'children endpoint — attractions, restaurants, shows with coordinates',
  hours: '/entity/{id}/schedule/{year}/{month}',
  waitTimes: '/entity/{id}/live recursive',
  integration: 'fetch-only adapter in lib/adapters/parks-api.mjs; cached sidecar',
  status: 'active — powers ThemeParks.wiki hosted API',
};

/**
 * Score how well an external inventory covers the shipped bundle rides.
 *
 * @param {{ apiCount: number, bundleRideCount: number, matched: number }} cmp
 */
export function inventoryCoveragePct(cmp) {
  if (!cmp?.bundleRideCount) return null;
  return Math.round((cmp.matched / cmp.bundleRideCount) * 1000) / 10;
}

/**
 * Fraction of API attractions that carry coordinates (builder-relevant field).
 *
 * @param {Array<{ at?: { lat: number, lng: number } | null }>} attractions
 */
export function coordinateCoveragePct(attractions = []) {
  if (!attractions.length) return null;
  const withCoords = attractions.filter((a) => Number.isFinite(a?.at?.lat) && Number.isFinite(a?.at?.lng));
  return Math.round((withCoords.length / attractions.length) * 1000) / 10;
}

/**
 * @param {object} opts
 * @param {string} opts.venue
 * @param {object} [opts.parksApi]
 * @param {object} [opts.inventoryCompare]
 * @param {string} [opts.fetched]
 * @param {boolean} [opts.gap]
 * @param {string} [opts.error]
 */
export function shapeVenueBakeoffReport({
  venue,
  parksApi = {},
  inventoryCompare = {},
  fetched,
  gap = false,
  error,
} = {}) {
  const attractions = parksApi.attractions || [];
  return {
    schema: VENUE_DATA_BAKEOFF_SCHEMA,
    venue,
    legacy: LEGACY_ADAPTER_ID,
    successor: SUCCESSOR_ADAPTER_ID,
    fetched: fetched || parksApi.fetched || new Date().toISOString().slice(0, 10),
    gap: Boolean(gap),
    error: error || undefined,
    parksApi: {
      parkId: parksApi.parkId ?? null,
      parkName: parksApi.parkName ?? null,
      source: parksApi.source ?? null,
      attractionCount: attractions.length,
      coordinateCoveragePct: coordinateCoveragePct(attractions),
    },
    inventory: {
      apiCount: inventoryCompare.apiCount ?? 0,
      bundleRideCount: inventoryCompare.bundleRideCount ?? 0,
      matched: inventoryCompare.matched ?? 0,
      coveragePct: inventoryCoveragePct(inventoryCompare),
      onlyOnApi: inventoryCompare.onlyOnApi?.length ?? 0,
      onlyInBundle: inventoryCompare.onlyInBundle?.length ?? 0,
    },
  };
}

/**
 * @param {Array<object>} venueReports
 * @param {{ recommendation: string, legacyAdopt: string, rationale: string[] }} decision
 */
export function shapeBakeoffSummary(venueReports = [], decision) {
  const tested = venueReports.filter((r) => !r.gap);
  const meanCoverage = tested.length
    ? Math.round(
      tested.reduce((sum, r) => sum + (r.inventory?.coveragePct ?? 0), 0) / tested.length * 10,
    ) / 10
    : null;
  const meanCoords = tested.length
    ? Math.round(
      tested.reduce((sum, r) => sum + (r.parksApi?.coordinateCoveragePct ?? 0), 0) / tested.length * 10,
    ) / 10
    : null;

  return {
    schema: VENUE_DATA_BAKEOFF_SCHEMA,
    legacy: LEGACY_PROFILE,
    successor: SUCCESSOR_PROFILE,
    fetched: new Date().toISOString().slice(0, 19),
    venues: venueReports.map((r) => r.venue),
    summary: {
      venuesTested: tested.length,
      meanInventoryCoveragePct: meanCoverage,
      meanCoordinateCoveragePct: meanCoords,
    },
    venueReports,
    decision,
    researchDoc: 'docs/research/2026-09-18-themeparks-cubehouse-vs-parksapi.md',
  };
}

export function renderBakeoffMarkdown(summary) {
  const lines = [
    '# Venue-data adapter bake-off',
    '',
    `Legacy **${summary.legacy.id}** vs successor **${summary.successor.id}**`,
    '',
    `- Schema: \`${summary.schema}\``,
    `- Fetched: ${summary.fetched}`,
    `- Venues tested: ${summary.venues.join(', ') || '—'}`,
    '',
    '## Decision',
    '',
    `- Recommendation: **${summary.decision.recommendation}**`,
    `- Registry adopt for \`${LEGACY_ADAPTER_ID}\`: **${summary.decision.legacyAdopt}**`,
    '',
    ...summary.decision.rationale.map((r) => `- ${r}`),
    '',
    '## Summary',
    '',
    `- Mean bundle inventory coverage: ${summary.summary.meanInventoryCoveragePct ?? '—'}%`,
    `- Mean ParksAPI coordinate coverage: ${summary.summary.meanCoordinateCoveragePct ?? '—'}%`,
    '',
    '## Per-venue inventory',
    '',
    '| Venue | API attractions | bundle rides | matched | coverage % | coords % |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
  ];

  for (const r of summary.venueReports || []) {
    if (r.gap) {
      lines.push(`| ${r.venue} | — | — | — | gap | ${r.error || 'unavailable'} |`);
      continue;
    }
    lines.push(
      `| ${r.venue} | ${r.parksApi.attractionCount} | ${r.inventory.bundleRideCount} | ${r.inventory.matched} | ${r.inventory.coveragePct ?? '—'} | ${r.parksApi.coordinateCoveragePct ?? '—'} |`,
    );
  }

  lines.push(
    '',
    '## Acquisition model comparison',
    '',
    '| Field | Legacy (cubehouse/themeparks 5.x) | Successor (ParksAPI / ThemeParks.wiki) |',
    '| --- | --- | --- |',
    `| Maintenance (registry) | ${LEGACY_PROFILE.maintenance}/5 | ${SUCCESSOR_PROFILE.maintenance}/5 |`,
    `| License | ${LEGACY_PROFILE.license} | ${SUCCESSOR_PROFILE.license} |`,
    `| Park identification | ${LEGACY_PROFILE.parkIdentification} | ${SUCCESSOR_PROFILE.parkIdentification} |`,
    `| Inventory | ${LEGACY_PROFILE.inventory} | ${SUCCESSOR_PROFILE.inventory} |`,
    `| Hours | ${LEGACY_PROFILE.hours} | ${SUCCESSOR_PROFILE.hours} |`,
    `| Wait times | ${LEGACY_PROFILE.waitTimes} | ${SUCCESSOR_PROFILE.waitTimes} |`,
    `| Integration | ${LEGACY_PROFILE.integration} | ${SUCCESSOR_PROFILE.integration} |`,
    `| Status | ${LEGACY_PROFILE.status} | ${SUCCESSOR_PROFILE.status} |`,
    '',
    `Full evaluation: \`${summary.researchDoc}\``,
    '',
  );
  return lines.join('\n');
}
