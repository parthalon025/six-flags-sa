/**
 * Origin/destination pairs and client A* baseline routes for routing-engine bake-offs.
 */

import path from 'node:path';
import * as routing from '../../../apps/party-tracker/lib/routing.js';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { readJson, VENUE_DIR } from './venue-io.mjs';

const MAX_PAIRS = 5;

/**
 * @param {string} venueId
 * @returns {{ pairs: Array<object>, baselineRoutes: Array<object>, graphNodes: number }}
 */
export function collectBakeoffSamples(venueId) {
  const map = readJson(path.join(VENUE_DIR, `${venueId}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
  const graph = routing.buildRouteGraph(map);
  const rides = pois.filter((p) => isRideable(p));
  const centre = map.meta?.center;
  const pairs = [];
  const baselineRoutes = [];

  if (!centre || rides.length < 1) {
    return { pairs, baselineRoutes, graphNodes: graph.nodes?.length ?? 0 };
  }

  for (const ride of rides.slice(0, MAX_PAIRS)) {
    const gate = ride.e?.[0];
    const dest = gate?.lat
      ? { lat: gate.lat, lng: gate.lng, label: ride.n }
      : { lat: ride.lat, lng: ride.lng, label: ride.n };
    const start = performance.now();
    const route = routing.findRoute(graph, centre, dest);
    const ms = Math.round((performance.now() - start) * 10) / 10;
    pairs.push({
      label: ride.n,
      from: { lat: centre.lat, lng: centre.lng },
      to: { lat: dest.lat, lng: dest.lng },
    });
    baselineRoutes.push({
      label: ride.n,
      ok: Number.isFinite(route?.metres),
      metres: route?.metres ?? null,
      seconds: route?.seconds ?? null,
      ms,
      mode: route?.mode ?? 'none',
    });
  }

  return { pairs, baselineRoutes, graphNodes: graph.nodes?.length ?? 0 };
}
