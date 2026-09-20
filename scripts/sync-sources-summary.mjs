#!/usr/bin/env node
/**
 * Summarize venues:sync-sources --json fleet output for CI.
 *
 *   node scripts/sync-sources-summary.mjs sync-report.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { summarizeSyncResults } from '@party-tracker/venue-builder/sync-sources-summary.js';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node scripts/sync-sources-summary.mjs <report.json>');
  process.exit(2);
}

const results = JSON.parse(readFileSync(reportPath, 'utf8'));
const { exitCode, markdown } = summarizeSyncResults(results);
writeFileSync('sync-summary.md', markdown);
console.log(markdown);
process.exit(exitCode);
