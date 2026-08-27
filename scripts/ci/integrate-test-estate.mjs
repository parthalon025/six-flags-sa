#!/usr/bin/env node
/**
 * Integrator checklist — audit test wiring before merging slice stacks.
 *
 *   node scripts/ci/integrate-test-estate.mjs --audit
 *   node scripts/ci/integrate-test-estate.mjs --suggest
 *   npm run test:estate:audit
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditTestIntegration,
  suggestIntegrationFixes,
} from '../lib/integrate-test-estate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function parseArgs(argv) {
  const opts = { audit: false, suggest: false };
  for (const arg of argv) {
    if (arg === '--audit') opts.audit = true;
    else if (arg === '--suggest') opts.suggest = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  integrate-test-estate.mjs --audit     print estate, gate, and wiring problems
  integrate-test-estate.mjs --suggest   print dry-run fix hints for each problem`);
      process.exit(0);
    }
  }
  if (!opts.audit && !opts.suggest) opts.audit = true;
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const report = auditTestIntegration(root);

if (opts.audit) {
  const sections = [
    ['estate', report.estate],
    ['gate', report.gate],
    ['wiring', report.wiring],
  ];
  for (const [name, problems] of sections) {
    console.log(`\n## ${name} (${problems.length})`);
    for (const p of problems) console.log(p);
  }
  console.log(report.clean ? '\nintegrate-test-estate: ok' : `\nintegrate-test-estate: ${report.estate.length + report.gate.length + report.wiring.length} problem(s)`);
}

if (opts.suggest) {
  const hints = suggestIntegrationFixes(report);
  console.log(`\n## suggestions (${hints.length})`);
  for (const h of hints) console.log(`- ${h}`);
}

if (!report.clean) process.exit(1);
