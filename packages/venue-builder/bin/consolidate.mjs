#!/usr/bin/env node
/**
 * Consolidate accepted durable contributions into data/venues/<id>/ (E0.5).
 *
 *   node packages/venue-builder/bin/consolidate.mjs --dry-run
 *   node packages/venue-builder/bin/consolidate.mjs --apply --queue path.json
 *   node packages/venue-builder/bin/consolidate.mjs --venue kings-island --force
 *
 * Never writes public/venues/* — follow with `npm run venues:overrides`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consolidate,
  loadContributionQueue,
  readVenueCadence,
  CADENCES,
  DEFAULT_CADENCE,
} from '../lib/consolidate.mjs';
import { listVenuePackages, MONO_ROOT } from '../lib/venue-io.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_QUEUE = path.join(MONO_ROOT, 'data', 'consolidate', 'queue.json');

function parseArgs(argv) {
  const out = { dryRun: true, apply: false, force: false, json: false, venue: null, queue: DEFAULT_QUEUE };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') {
      out.apply = true;
      out.dryRun = false;
    } else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--force') out.force = true;
    else if (a === '--json') out.json = true;
    else if (a === '--venue') out.venue = argv[++i];
    else if (a === '--queue') out.queue = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(`Usage: consolidate.mjs [--dry-run|--apply] [--queue file] [--venue id] [--force] [--json]

Cadences (${CADENCES.join('|')}; default ${DEFAULT_CADENCE}) live in
data/venues/<id>/recipe.json under consolidate.cadence.
`);
  process.exit(0);
}

const venues = args.venue ? [args.venue] : listVenuePackages();
const contributions = loadContributionQueue(args.queue);

const report = {
  queue: path.relative(MONO_ROOT, args.queue),
  cadence: Object.fromEntries(venues.map((id) => [id, readVenueCadence(id)])),
  ...consolidate({
    contributions,
    venueIds: venues,
    force: args.force,
    apply: args.apply,
  }),
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Consolidate ${args.apply ? 'APPLY' : 'dry-run'} · queue ${report.queue}`);
  console.log(`Due: ${report.due.join(', ') || '(none)'}`);
  if (report.skippedCadence.length) {
    console.log(`Skipped (cadence): ${report.skippedCadence.join(', ')}`);
  }
  console.log(`Plans applied: ${report.applied.length}`);
  for (const p of report.applied) {
    console.log(`  · ${p.action} ${p.venueId} ${p.placeName || ''} (${p.contributionId || ''})`);
  }
  if (report.writes.length) {
    console.log('Wrote:');
    for (const w of report.writes) console.log(`  · ${path.relative(MONO_ROOT, w)}`);
  }
  if (report.next.length) {
    console.log('Next:');
    for (const n of report.next) console.log(`  · ${n}`);
  }
}

process.exit(0);
