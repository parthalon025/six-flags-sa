#!/usr/bin/env node
/**
 * Builder-side routing QA on the venue path graph (Valhalla/GraphHopper alternative).
 *
 *   npm run venues:route-qa -- cedar-point
 */

import path from 'node:path';
import { readJson, VENUE_DIR } from './lib/venue-io.mjs';
import { qaVenueRouting } from './lib/venue-route-qa-core.mjs';

const USAGE = `
Routing QA — path graph health for a built venue.

  node packages/venue-builder/venue-route-qa.mjs <venue id>
  node packages/venue-builder/venue-route-qa.mjs --all [--json]
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
  const rows = ids.map(qaVenueRouting);
  if (args.json) {
    console.log(JSON.stringify(rows.length === 1 ? rows[0] : rows, null, 2));
    return;
  }
  console.log(renderMarkdown(rows));
}

main();
