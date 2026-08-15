#!/usr/bin/env node
/**
 * Current release mode for how Park Bound actually ships (merge-driven web, manual store).
 *
 *   npm run store:release-cycle
 *   npm run store:release-cycle -- --json
 *   npm run store:release-cycle -- --since store/1.12.0
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildReleaseCycleReport,
  formatReleaseCycleReport,
  releaseCycleChecklist,
} from './lib/release-cycle.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = { json: false, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--since') opts.since = argv[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: release-cycle.mjs [--json] [--since REF]

REF — git tag or ref for native diff (default: latest store/* tag, else recent commits)`);
      process.exit(0);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const report = buildReleaseCycleReport({
  repoRoot,
  sinceRef: opts.since,
});
const checklist = releaseCycleChecklist(report);

if (opts.json) {
  console.log(JSON.stringify({ ...report, checklist }, null, 2));
} else {
  console.log(formatReleaseCycleReport(report, checklist));
}
