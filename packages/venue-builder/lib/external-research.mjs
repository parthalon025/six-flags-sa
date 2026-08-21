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
import { loadGuestTracesData, guestTraceClaims, guestGroundTruthClaims } from './adapters/guest-traces.mjs';
import { loadMapillaryData, mapillaryClaims } from './adapters/mapillary-api.mjs';
import { loadOrsRouteQa } from './adapters/openrouteservice.mjs';
import { worldcoverCacheFile } from './adapters/esa-worldcover.mjs';
import { WIKIDATA_QIDS } from './park-slug-map.mjs';
import { readSources, externalAdaptersFromCatalog, DEFAULT_EXTERNAL_ADAPTERS } from './venue-sources.mjs';
import { normalizeExternalClaims } from './external-claims.mjs';

export { EXTERNAL_ADAPTER_IDS, DEFAULT_EXTERNAL_ADAPTERS };

/* OpenRouteService route QA needs a handful of real from/to samples — see
 * deriveOrsRouteSamples() below. "Entrance" POIs use the same 'gate' category
 * as the rest of the builder (venue-checklist.mjs's "A way in" check). */
const ORS_ENTRANCE_CATEGORIES = ['gate', 'parking'];
const ORS_DESTINATION_CATEGORIES = ['coaster', 'ride', 'show', 'landmark'];
const ORS_MIN_SAMPLES = 3;
const ORS_MAX_SAMPLES = 4;

function hasCoords(poi) {
  return Boolean(poi) && Number.isFinite(poi.lat) && Number.isFinite(poi.lng);
}

/**
 * Derive a small, fixed set of OpenRouteService route samples from a venue's
 * own POIs: one entrance/parking POI as the walking origin, paired with a
 * few ride/attraction POIs (one per distinct category, for variety) as
 * destinations. Deliberately simple — straightforward filtering, no
 * route-graph logic. Returns [] when the venue's POIs can't cleanly support
 * at least ORS_MIN_SAMPLES samples (missing coordinates, no entrance-like
 * POI, too few distinct attraction categories) rather than guessing.
 * @param {object[]} [pois]
 * @returns {{ from: { lat: number, lng: number }, to: { lat: number, lng: number }, label: string }[]}
 */
export function deriveOrsRouteSamples(pois = []) {
  const usable = (pois || []).filter(hasCoords);
  const from = ORS_ENTRANCE_CATEGORIES.map((cat) => usable.find((p) => p.c === cat)).find(Boolean);
  if (!from) return [];

  const seenCategories = new Set();
  const destinations = [];
  for (const poi of usable) {
    if (poi === from || !ORS_DESTINATION_CATEGORIES.includes(poi.c) || seenCategories.has(poi.c)) continue;
    seenCategories.add(poi.c);
    destinations.push(poi);
    if (destinations.length >= ORS_MAX_SAMPLES) break;
  }
  if (destinations.length < ORS_MIN_SAMPLES) return [];

  return destinations.map((to) => ({
    from: { lat: from.lat, lng: from.lng },
    to: { lat: to.lat, lng: to.lng },
    label: `${from.n || from.i} → ${to.n || to.i}`,
  }));
}

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
 * Adapter ids to sync: explicit opts.sources, else sources.json datasets.external, else defaults.
 */
export function resolveExternalAdapterIds(venueId, opts = {}) {
  if (opts.sources?.length) return opts.sources;
  const { data: catalog } = readSources(venueId);
  return externalAdaptersFromCatalog(catalog, { fallback: DEFAULT_EXTERNAL_ADAPTERS });
}

/**
 * @param {string} venueId
 * @param {{ fetch?: boolean, offline?: boolean, sources?: string[], pois?: object[], onProgress?: (msg: string) => void }} [opts]
 */
export async function syncExternalSources(venueId, opts = {}) {
  const { fetch = false, offline = false, onProgress = () => {} } = opts;
  const requested = resolveExternalAdapterIds(venueId, opts);
  const pois = opts.pois || readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
  const samples = deriveOrsRouteSamples(pois);
  const ctx = { ...venueResearchContext(venueId), fetch, offline, samples };
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
  const guestTracesRaw = await loadGuestTracesData(venueId, { ...loadOpts });
  const mapillaryRaw = await loadMapillaryData(venueId, { bounds: ctx.bounds, ...loadOpts });
  const orsRaw = await loadOrsRouteQa(venueId, { samples: deriveOrsRouteSamples(pois), ...loadOpts });
  /* esa-worldcover has no `load*Data` twin — its offline read lives inside the
     adapter's own `run()`, which would need a ctx it does not have here. The
     cache is the whole payload, so read it directly, exactly as
     external-claims.mjs does. */
  const worldcoverRaw = readJson(worldcoverCacheFile(venueId), null);

  const parksApi = compareParksApiToBundle({ parksApi: parksApiRaw, pois });
  const queueTimes = compareQueueTimesToBundle({ queueTimes: queueTimesRaw, pois });
  const rcdb = compareRcdbToBundle({ rcdb: rcdbRaw, pois });

  const normalised = normalizeExternalClaims(venueId, {
    pois,
    external: {
      parksApiRaw,
      queueTimesRaw,
      queueTimesCompare: queueTimes,
      ropedropRaw,
      wikidataRaw,
      accessibilityRaw,
      sidewalkRaw,
      mapillaryRaw,
      rcdbRaw,
      rcdbCompare: rcdb,
      ohmRaw,
      openMeteoRaw,
      worldcoverRaw,
      llm: null,
    },
  });

  /* Unbound imagery/a11y retained for research packets; fusion uses normalised claims. */
  const claims = [
    ...normalised.claims,
    ...wikidataClaims(wikidataRaw),
    ...accessibilityClaims(accessibilityRaw),
    ...sidewalkClaims(sidewalkRaw),
    ...guestTraceClaims(guestTracesRaw),
    ...guestGroundTruthClaims(guestTracesRaw),
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
    guestTracesRaw,
    mapillaryRaw,
    orsRaw,
    worldcoverRaw,
    claims,
    normalised,
    declaredAdapters: resolveExternalAdapterIds(venueId),
  };
}
