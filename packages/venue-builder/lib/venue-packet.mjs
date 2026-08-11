/**
 * Load a venue research packet — shared by research CLI and build agents.
 */

import path from 'node:path';
import { readJson, VENUE_DIR, OVERRIDE_DIR } from './venue-io.mjs';
import { requests } from './venue-requests.mjs';
import { readSources } from './venue-sources.mjs';
import { judgements, sourcingPlan } from './venue-judge.mjs';
import {
  compareOfficialToBundle,
  loadOfficialData,
  enrichOfficialFromSidecar,
} from './venue-official-site.mjs';
import {
  loadParksApiData,
  compareParksApiToBundle,
} from './adapters/parks-api.mjs';
import { loadExternalResearch } from './external-research.mjs';

export async function loadVenuePacket(id, opts = {}) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venue = manifest.venues.find((v) => v.id === id);
  if (!venue) throw new Error(`No venue called "${id}" in the manifest.`);

  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  const overrides = readJson(path.join(OVERRIDE_DIR, `${id}.overrides.json`), null);
  const heightsSidecar = readJson(path.join(OVERRIDE_DIR, `${id}.heights.json`), null);
  const recipe = readJson(path.join(OVERRIDE_DIR, `${id}.recipe.json`), null);
  const attractions = readJson(path.join(OVERRIDE_DIR, `${id}.attractions.json`), null);
  const { data: catalog } = readSources(id, recipe?.flags?.sources || null);

  const layers = {
    coaster: map.coaster || [],
    slide: map.slide || [],
    path: map.path || [],
    lands: map.lands || [],
  };

  const reqs = requests({ venue, map, pois, overrides });
  const judge = judgements({ pois, layers, overrides });
  const sourcing = sourcingPlan({ catalog, pois, layers, requests: reqs, judgements: judge });

  const officialRaw = enrichOfficialFromSidecar(
    await loadOfficialData(id, catalog, {
      fetch: opts.fetch,
      offline: opts.offline,
      details: opts.fetchDetails,
      browser: opts.browser,
    }),
    heightsSidecar,
    catalog,
  );
  const official = compareOfficialToBundle({ official: officialRaw, pois, heightsSidecar });
  if (officialRaw?.fallback) official.fallback = officialRaw.fallback;

  const parksApiRaw = await loadParksApiData(id, {
    fetch: opts.parksApi || opts.fetch,
    offline: opts.offline,
  });
  const parksApi = compareParksApiToBundle({ parksApi: parksApiRaw, pois });

  const external = await loadExternalResearch(id, { pois });

  return {
    venue,
    map,
    pois,
    overrides,
    heightsSidecar,
    recipe,
    attractions,
    catalog,
    requests: reqs,
    judgements: judge,
    sourcing,
    official,
    parksApi,
    parksApiRaw,
    external,
  };
}

export function packetSummary(packet) {
  const rides = packet.pois?.filter((p) => p.c === 'ride' || p.c === 'coaster') || [];
  const published = rides.filter((p) => p.e?.some((g) => g.src?.confidence === 'moderate' || g.src?.confidence === 'high')).length;
  return {
    id: packet.venue.id,
    name: packet.venue.name,
    rides: rides.length,
    publishedEntrances: published,
    officialMatched: packet.official?.matched ?? 0,
    parksApiMatched: packet.parksApi?.matched ?? 0,
    queueTimesMatched: packet.external?.queueTimes?.matched ?? 0,
    rcdbMatched: packet.external?.rcdb?.matched ?? 0,
    externalClaims: packet.external?.claims?.length ?? 0,
    weaknesses: packet.judgements?.length ?? 0,
    requests: packet.requests?.length ?? 0,
  };
}
