#!/usr/bin/env node
/**
 * Summarize venues:research --json fleet output for CI.
 *
 *   node scripts/official-research-summary.mjs research-report.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { summarizeOfficialResearchResults } from './lib/official-research-summary.mjs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node scripts/official-research-summary.mjs <report.json>');
  process.exit(2);
}

const packets = JSON.parse(readFileSync(reportPath, 'utf8'));
const rows = Array.isArray(packets) ? packets : [packets];
const { exitCode, markdown } = summarizeOfficialResearchResults(rows);
writeFileSync('research-summary.md', markdown);
console.log(markdown);
process.exit(exitCode);
