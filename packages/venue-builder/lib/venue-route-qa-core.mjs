/**
 * Shared routing QA for a built venue — used by venue-route-qa CLI and certify.
 */

import path from 'node:path';
import * as routing from '../../../apps/party-tracker/lib/routing.js';
import { isRideable } from '@party-tracker/shared/ontology.js';
import { readJson, VENUE_DIR } from './venue-io.mjs';

/** Kings Island standard — at most this many disconnected path islands. */
export const MAX_ROUTING_ISLANDS = 2;

/** Rides farther than this from the walk network fail pin-near-path. */
export const MAX_RIDE_SNAP_METRES = 35;

export function estimateComponents(graph) {
  const seen = new Set();
  let count = 0;
  let largest = 0;
  const byKey = new Map((graph.nodes || []).map((n) => [n.key, n]));
  for (const node of graph.nodes || []) {
    if (seen.has(node.key)) continue;
    count += 1;
    let size = 0;
    const stack = [node.key];
    while (stack.length) {
      const k = stack.pop();
      if (seen.has(k)) continue;
      seen.add(k);
      size += 1;
      const cur = byKey.get(k);
      for (const e of cur?.edges || []) {
        if (!seen.has(e.to)) stack.push(e.to);
      }
    }
    if (size > largest) largest = size;
  }
  return { count, largest };
}

/**
 * @param {string} id venue id
 * @returns routing QA result for certify and CLI
 */
export function qaVenueRouting(id) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  const graph = routing.buildRouteGraph(map);
  const components = estimateComponents(graph);
  const rides = pois.filter((p) => isRideable(p));
  const far = [];
  for (const ride of rides) {
    const snap = routing.snapToGraph(graph, ride.lat, ride.lng);
    const offset = snap?.offset ?? null;
    if (!snap || offset > MAX_RIDE_SNAP_METRES) {
      far.push({ name: ride.n, metres: offset != null ? Math.round(offset) : null });
    }
  }
  const centre = map.meta?.center || { lat: rides[0]?.lat, lng: rides[0]?.lng };
  const samples = [];
  if (centre && rides.length >= 2) {
    for (const t of rides.slice(0, 5)) {
      const gate = t.e?.[0];
      const dest = gate?.lat
        ? { lat: gate.lat, lng: gate.lng, label: t.n }
        : { lat: t.lat, lng: t.lng, label: t.n };
      const start = performance.now();
      const route = routing.findRoute(graph, centre, dest);
      const ms = performance.now() - start;
      samples.push({
        to: t.n,
        metres: route?.metres ?? null,
        seconds: route?.seconds ?? null,
        mode: route?.mode ?? 'none',
        ms,
        viaEntrance: Boolean(gate?.lat),
      });
    }
  }
  return {
    venue: id,
    name: map.meta?.name || id,
    pathWays: (map.path || []).length,
    graphNodes: graph.nodes?.length ?? 0,
    components: components.count,
    largestComponent: components.largest,
    ridesFarFromNetwork: far.length,
    rideCount: rides.length,
    farRides: far.slice(0, 12),
    samples,
    pass:
      components.count <= MAX_ROUTING_ISLANDS
      && far.length === 0,
  };
}
