#!/usr/bin/env node
/**
 * Builder-side venue-data adapter bake-off — themeparks-cubehouse vs ParksAPI (#413).
 *
 *   npm run venues:venue-data-bakeoff
 *   npm run venues:venue-data-bakeoff -- --json
 *   npm run venues:venue-data-bakeoff -- kings-island cedar-point
 */

import path from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { BUILDER_ROOT } from './src/paths.mjs';
import {
  LEGACY_ADAPTER_ID,
  SUCCESSOR_ADAPTER_ID,
  shapeBakeoffSummary,
  renderBakeoffMarkdown,
} from './lib/venue-data-adapter-bakeoff.mjs';
import { BAKEOFF_VENUES, collectBakeoffSamples } from './lib/venue-data-adapter-bakeoff-samples.mjs';

const USAGE = `
Venue-data adapter bake-off — compare legacy cubehouse/themeparks against ParksAPI.

  node packages/venue-builder/venue-data-adapter-bakeoff.mjs [--json] [venue ids…]
`;

const DECISION = {
  recommendation: `reject ${LEGACY_ADAPTER_ID}; keep ${SUCCESSOR_ADAPTER_ID} wrap`,
  legacyAdopt: 'reject',
  rationale: [
    'Upstream README states cubehouse/themeparks 5.x is unmaintained and replaced by ThemeParks.wiki — the same hosted API our parks-api adapter already wraps.',
    'Per-park scraper classes add npm weight and cold-start cost without fields the builder lacks from REST /children.',
    'Committed caches for kings-island, cedar-point, and six-flags-fiesta-texas show inventory + coordinate coverage adequate for research QA.',
    'No builder code path should depend on the legacy npm package after this decision.',
  ],
};

export const bakeoffSummaryFile = () => path.join(
  BUILDER_ROOT,
  'data',
  'venue-data-adapter-bakeoff-summary.json',
);

function parseArgs(argv) {
  const out = { _: [], json: false };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (!a.startsWith('--')) out._.push(a);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const venueIds = args._.length ? args._ : BAKEOFF_VENUES;
  const venueReports = collectBakeoffSamples(venueIds);
  const summary = shapeBakeoffSummary(venueReports, DECISION);

  mkdirSync(path.dirname(bakeoffSummaryFile()), { recursive: true });
  writeFileSync(bakeoffSummaryFile(), `${JSON.stringify(summary, null, 2)}\n`);

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(renderBakeoffMarkdown(summary));
  console.log(`\nArtifact: ${bakeoffSummaryFile()}\n`);
}

main();
