#!/usr/bin/env node
/**
 * Builder-side routing-engine bake-off — GraphHopper vs client A* (#407).
 *
 *   npm run venues:routing-bakeoff -- cedar-point
 *   npm run venues:routing-bakeoff -- cedar-point --fetch
 *   npm run venues:routing-bakeoff -- --all [--json]
 */

import path from 'node:path';
import { readJson, VENUE_DIR } from './lib/venue-io.mjs';
import { renderBakeoffMarkdown } from './lib/routing-engine-bakeoff.mjs';
import { collectBakeoffSamples } from './lib/routing-engine-bakeoff-samples.mjs';
import { loadGraphHopperBakeoff, graphhopperCacheFile } from './lib/adapters/graphhopper.mjs';

const USAGE = `
Routing engine bake-off — compare GraphHopper against the shipped client A* baseline.

  node packages/venue-builder/routing-engine-bakeoff.mjs <venue id>
  node packages/venue-builder/routing-engine-bakeoff.mjs --all [--json] [--fetch]
`;

function parseArgs(argv) {
  const out = { _: [], all: false, json: false, fetch: false, offline: false };
  for (const a of argv) {
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--fetch') out.fetch = true;
    else if (a === '--offline') out.offline = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

async function bakeoffVenue(id, { fetch, offline, json }) {
  const sample = collectBakeoffSamples(id);
  const report = await loadGraphHopperBakeoff(id, {
    pairs: sample.pairs,
    baselineRoutes: sample.baselineRoutes,
    fetch,
    offline,
  });
  if (json) return report;
  return renderBakeoffMarkdown(report);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = readJson(path.join(VENUE_DIR, 'manifest.json'), { venues: [] });
  const ids = args.all ? manifest.venues.map((v) => v.id) : args._;
  if (!ids.length) {
    console.error(USAGE.trim());
    process.exit(1);
  }

  if (args.json && ids.length > 1) {
    const reports = [];
    for (const id of ids) {
      reports.push(await bakeoffVenue(id, { fetch: args.fetch, offline: args.offline, json: true }));
    }
    console.log(JSON.stringify(reports, null, 2));
    return;
  }

  for (const id of ids) {
    const body = await bakeoffVenue(id, { fetch: args.fetch, offline: args.offline, json: args.json });
    console.log(body);
    if (!args.json) {
      console.log(`\nArtifact: ${graphhopperCacheFile(id)}\n`);
    }
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
