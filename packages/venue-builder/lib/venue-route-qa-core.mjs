/**
 * Shared routing QA for a built venue — used by venue-route-qa CLI and certify.
 */

import path from 'node:path';
import * as routing from '../../../apps/party-tracker/lib/routing.js';
import { isRideable } from '@party-tracker/shared/ontology.js';
// The normalisation the builder already joins ride names on. `osmGaps` walks
// these same coaster/slide layers and lowercases both sides before comparing,
// because raw OpenStreetMap names and POI names diverge — Cedar Point ships
// aliases for exactly that. Matching raw strings here would have silently
// dropped a ride back to its centroid on nothing worse than a case change.
import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
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

/** Map layers whose ways are a ride's own structure. */
const RIDE_GEOMETRY_LAYERS = ['coaster', 'slide'];

/**
 * Where a guest could actually be standing to have reached this ride.
 *
 * Not the POI point alone. That point is a centroid, and the centroid of a big
 * coaster is in the middle of its own footprint — Cedar Point's Siren's Curse
 * measured 64 m from the nearest walkway by its centroid while its **track**
 * runs 9.5 m from one, in this venue's own map. Snapping the centroid reported
 * a ride a guest cannot reach, and a guest can walk right up to it (#23).
 *
 * So: the recorded queue entrance if the bundle carries one, else the ride's own
 * mapped structure, else the point. A ride genuinely stranded on a routing
 * island still fails — none of its points is near the network either.
 */
export function reachablePoints(ride, map, rides = [ride]) {
  const entrance = (ride.e || []).find((e) => Number.isFinite(e?.lat) && Number.isFinite(e?.lng));
  if (entrance) return [{ lat: entrance.lat, lng: entrance.lng }];

  const point = [{ lat: ride.lat, lng: ride.lng }];
  const key = normaliseRideName(ride.n);
  if (!key) return point;

  /* A name two rides share cannot attribute geometry to either of them, and the
     normalisation is lossy enough to create that case on its own — it drops a
     leading article, so "The Beast" and "Beast" land on the same key. Where the
     venue is ambiguous the ride falls back to its point rather than snapping to
     a structure that may belong to its twin. Pass the venue's rides to get this
     guard; the default only ever sees one, where no ambiguity can exist. */
  const wearingKey = (rides || []).filter((r) => normaliseRideName(r?.n) === key).length;
  if (wearingKey > 1) return point;

  const own = [];
  for (const layer of RIDE_GEOMETRY_LAYERS) {
    for (const way of map?.[layer] || []) {
      if (normaliseRideName(way?.n) !== key) continue;
      for (const [lng, lat] of way.r || []) {
        if (Number.isFinite(lat) && Number.isFinite(lng)) own.push({ lat, lng });
      }
    }
  }
  return own.length ? own : point;
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
    let offset = null;
    for (const point of reachablePoints(ride, map, rides)) {
      const snap = routing.snapToGraph(graph, point.lat, point.lng);
      if (snap?.offset == null) continue;
      if (offset == null || snap.offset < offset) offset = snap.offset;
    }
    if (offset == null || offset > MAX_RIDE_SNAP_METRES) {
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
