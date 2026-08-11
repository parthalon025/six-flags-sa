/**
 * Orchestrates open-source external research adapters for a venue.
 * Results are cached under data/venues/<id>.*-cache.json and merged into
 * the venue research packet for evidence fusion.
 */
import path from 'node:path';
import { readJson, VENUE_DIR } from './venue-io.mjs';
import { runAdapter } from './adapters/runner.mjs';
import { EXTERNAL_ADAPTER_IDS } from './adapters/implementations.mjs';
import { loadParksApiData, compareParksApiToBundle } from './adapters/parks-api.mjs';
import { loadQueueTimesData, compareQueueTimesToBundle } from './adapters/queue-times.mjs';
import { loadRopedropData } from './adapters/ropedrop.mjs';
import { loadWikidataData, wikidataClaims } from './adapters/wikidata.mjs';
import { loadAccessibilityCloudData, accessibilityClaims } from './adapters/accessibility-cloud.mjs';
import { loadRcdbData, compareRcdbToBundle, rcdbClaims } from './adapters/rcdb.mjs';
import { loadOpenMeteoData } from './adapters/open-meteo.mjs';
import { loadOhmData } from './adapters/openhistoricalmap.mjs';
import { loadProjectSidewalkData, sidewalkClaims } from './adapters/project-sidewalk.mjs';
import { loadMapillaryData, mapillaryClaims } from './adapters/mapillary-api.mjs';
import { loadOrsRouteQa } from './adapters/openrouteservice.mjs';
import { WIKIDATA_QIDS } from './park-slug-map.mjs';

export { EXTERNAL_ADAPTER_IDS };

/** @param {string} venueId */
export function venueResearchContext(venueId) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venue = manifest.venues.find((v) => v.id === venueId);
  return {
    venueId,
    venueName: venue?.name || venueId,
    center: venue?.center || null,
    bounds: venue?.bounds || null,
    qid: WIKIDATA_QIDS[venueId] || null,
  };
}

/**
 * @param {string} venueId
 * @param {{ fetch?: boolean, offline?: boolean, sources?: string[], onProgress?: (msg: string) => void }} [opts]
 */
export async function syncExternalSources(venueId, opts = {}) {
  const { fetch = false, offline = false, onProgress = () => {} } = opts;
  const requested = opts.sources?.length ? opts.sources : EXTERNAL_ADAPTER_IDS;
  const ctx = { ...venueResearchContext(venueId), fetch, offline };
  const out = {};

  for (const id of requested) {
    onProgress(`sync ${id}…`);
    out[id] = await runAdapter(id, ctx);
  }
  return out;
}

/**
 * Load cached external payloads (no network) and compare where applicable.
 * @param {string} venueId
 * @param {{ pois?: object[] }} [opts]
 */
export async function loadExternalResearch(venueId, opts = {}) {
  const ctx = venueResearchContext(venueId);
  const pois = opts.pois || [];
  const loadOpts = { fetch: false, offline: true };

  const parksApiRaw = await loadParksApiData(venueId, loadOpts);
  const queueTimesRaw = await loadQueueTimesData(venueId, { ...ctx, ...loadOpts });
  const ropedropRaw = await loadRopedropData(venueId, loadOpts);
  const wikidataRaw = await loadWikidataData(venueId, { ...ctx, ...loadOpts });
  const accessibilityRaw = await loadAccessibilityCloudData(venueId, { bounds: ctx.bounds, ...loadOpts });
  const rcdbRaw = await loadRcdbData(venueId, { venueName: ctx.venueName, ...loadOpts });
  const openMeteoRaw = await loadOpenMeteoData(venueId, { center: ctx.center, ...loadOpts });
  const ohmRaw = await loadOhmData(venueId, { bounds: ctx.bounds, ...loadOpts });
  const sidewalkRaw = await loadProjectSidewalkData(venueId, { bounds: ctx.bounds, ...loadOpts });
  const mapillaryRaw = await loadMapillaryData(venueId, { bounds: ctx.bounds, ...loadOpts });
  const orsRaw = await loadOrsRouteQa(venueId, { samples: [], ...loadOpts });

  const parksApi = compareParksApiToBundle({ parksApi: parksApiRaw, pois });
  const queueTimes = compareQueueTimesToBundle({ queueTimes: queueTimesRaw, pois });
  const rcdb = compareRcdbToBundle({ rcdb: rcdbRaw, pois });

  const claims = [
    ...wikidataClaims(wikidataRaw),
    ...accessibilityClaims(accessibilityRaw),
    ...sidewalkClaims(sidewalkRaw),
    ...mapillaryClaims(mapillaryRaw),
    ...rcdbClaims(rcdbRaw, rcdb),
  ];

  return {
    parksApi,
    parksApiRaw,
    queueTimes,
    queueTimesRaw,
    ropedropRaw,
    wikidataRaw,
    accessibilityRaw,
    rcdb,
    rcdbRaw,
    openMeteoRaw,
    ohmRaw,
    sidewalkRaw,
    mapillaryRaw,
    orsRaw,
    claims,
  };
}
