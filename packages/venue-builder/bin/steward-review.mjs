#!/usr/bin/env node
/**
 * Export steward review packet for a venue (#432).
 *
 *   node packages/venue-builder/bin/steward-review.mjs --venue kings-island
 *   node packages/venue-builder/bin/steward-review.mjs --venue kings-island --json
 *   node packages/venue-builder/bin/steward-review.mjs --venue kings-island --write
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';
import {
  loadStewardReviewForVenue,
  renderStewardReviewMarkdown,
} from '../lib/steward-review.mjs';
import { venueSidecar } from '../lib/venue-io.mjs';

function parseArgs(argv) {
  const out = { venue: null, json: false, write: false, markdown: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--venue') out.venue = argv[++i];
    else if (a === '--json') out.json = true;
    else if (a === '--write') out.write = true;
    else if (a === '--markdown') out.markdown = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help || !args.venue) {
  console.log(`Usage: steward-review.mjs --venue <id> [--json|--markdown|--write]

Emits a deterministic steward review packet: disputed and low-confidence
evidence claims ranked for the human review gate (#280).
`);
  process.exit(args.help ? 0 : 1);
}

const packet = loadStewardReviewForVenue(args.venue);

if (args.write) {
  const outFile = venueSidecar(args.venue, 'steward-review.json');
  writeFileSync(outFile, `${JSON.stringify(packet, null, 2)}\n`);
  console.log(`Wrote ${outFile}`);
  process.exit(0);
}

if (args.json) {
  console.log(JSON.stringify(packet, null, 2));
  process.exit(0);
}

if (args.markdown) {
  console.log(renderStewardReviewMarkdown(packet));
  process.exit(0);
}

console.log(renderStewardReviewMarkdown(packet));
