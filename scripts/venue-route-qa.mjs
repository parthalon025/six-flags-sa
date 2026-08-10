#!/usr/bin/env node
/**
 * Builder-side routing QA on the venue path graph (Valhalla/GraphHopper alternative).
 *
 *   npm run venues:route-qa -- cedar-point
 */

import path from 'node:path';
import { readJson, VENUE_DIR } from './lib/venue-io.mjs';
import * as routing from '../lib/routing.js';
import { isRideable } from '../lib/ontology.js';

const USAGE = `
Routing QA — path graph health for a built venue.

  node scripts/venue-route-qa.mjs <venue id>
  node scripts/venue-route-qa.mjs --all [--json]
`;

function parseArgs(argv) {
  const out = { _: [], all: false, json: false };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function estimateComponents(graph) {
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

function qaVenue(id) {
  const map = readJson(path.join(VENUE_DIR, `${id}.map.json`), {});
  const pois = readJson(path.join(VENUE_DIR, `${id}.pois.json`), []);
  const graph = routing.buildRouteGraph(map);
  const components = estimateComponents(graph);
  const rides = pois.filter((p) => isRideable(p));
  const far = [];
  for (const ride of rides) {
    const snap = routing.snapToGraph(graph, ride.lat, ride.lng);
    const offset = snap?.offset ?? null;
    if (!snap || offset > 35) {
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
    farRides: far.slice(0, 12),
    samples,
  };
}

function renderMarkdown(rows) {
  const lines = ['# Routing QA', ''];
  for (const r of rows) {
    lines.push(`## ${r.name} (\`${r.venue}\`)`, '');
    lines.push(`- Path ways: ${r.pathWays} · graph nodes: ${r.graphNodes}`);
    lines.push(`- Connected components: ${r.components} (largest ${r.largestComponent} nodes)`);
    lines.push(`- Rides >35 m from network: ${r.ridesFarFromNetwork}`);
    if (r.farRides.length) {
      lines.push('', '**Far rides**', '');
      r.farRides.forEach((x) => lines.push(`- ${x.name}: ${x.metres ?? 'no snap'} m`));
    }
    if (r.samples.length) {
      lines.push('', '| To | m | s | mode | ms | entrance |', '| --- | ---: | ---: | --- | ---: | --- |');
      for (const s of r.samples) {
        lines.push(`| ${s.to} | ${s.metres ?? '—'} | ${s.seconds ?? '—'} | ${s.mode} | ${s.ms.toFixed(1)} | ${s.viaEntrance ? 'yes' : 'no'} |`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const ids = args.all ? manifest.venues.map((v) => v.id) : args._;
  if (!ids.length) {
    console.error(USAGE.trim());
    process.exit(1);
  }
  const rows = ids.map(qaVenue);
  if (args.json) {
    console.log(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2));
    return;
  }
  console.log(renderMarkdown(rows));
}

main();
