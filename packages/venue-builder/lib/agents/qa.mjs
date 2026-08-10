/**
 * QA agent — audit weaknesses and routing graph health.
 */

import path from 'node:path';
import { auditVenue } from '../venue-audit.mjs';
import { readJson, VENUE_DIR, OVERRIDE_DIR } from '../venue-io.mjs';
import { readSources } from '../venue-sources.mjs';
import { enrichOfficialFromSidecar, loadOfficialData } from '../venue-official-site.mjs';
import * as routing from '../../../../apps/party-tracker/lib/routing.js';
import { isRideable } from '@party-tracker/shared/ontology.js';

export async function runQaAgent(venueId, opts = {}) {
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const venue = manifest.venues.find((v) => v.id === venueId);
  if (!venue) throw new Error(`No venue "${venueId}"`);

  const map = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
  const overrides = readJson(path.join(OVERRIDE_DIR, `${venueId}.overrides.json`), null);
  const heightsSidecar = readJson(path.join(OVERRIDE_DIR, `${venueId}.heights.json`), null);
  const { data: catalog } = readSources(venueId);

  const officialRaw = enrichOfficialFromSidecar(
    await loadOfficialData(venueId, catalog, { fetch: opts.fetch, offline: opts.offline }),
    heightsSidecar,
    catalog,
  );

  const audit = auditVenue({
    venue,
    map,
    pois,
    overrides,
    heightsSidecar,
    official: officialRaw,
    catalog,
  });

  const graph = routing.buildRouteGraph(map);
  const rides = pois.filter((p) => isRideable(p));
  let farFromNetwork = 0;
  for (const ride of rides) {
    const snap = routing.snapToGraph(graph, ride.lat, ride.lng);
    if (!snap || snap.offset > 35) farFromNetwork += 1;
  }

  return {
    role: 'qa',
    ok: true,
    weaknesses: audit.weaknesses?.length ?? 0,
    checklistFails: audit.checklistFails?.length ?? 0,
    routing: {
      pathWays: (map.path || []).length,
      graphNodes: graph.nodes?.length ?? 0,
      ridesFarFromNetwork: farFromNetwork,
    },
    audit,
    recommendations: audit.weaknesses?.map((w) => w.capability?.tool).filter(Boolean) || [],
  };
}
