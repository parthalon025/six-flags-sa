#!/usr/bin/env node
/**
 * Summarize venues:research --json fleet output for CI.
 *
 *   node scripts/official-research-summary.mjs research-report.json
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  summarizeOfficialResearchParseError,
  summarizeOfficialResearchResults,
} from './lib/official-research-summary.mjs';

const reportPath = process.argv[2];
if (!reportPath) {
  console.error('usage: node scripts/official-research-summary.mjs <report.json>');
  process.exit(2);
}

let packets;
try {
  packets = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch {
  const { exitCode, markdown } = summarizeOfficialResearchParseError();
  writeFileSync('research-summary.md', markdown);
  console.log(markdown);
  process.exit(exitCode);
}
const { exitCode, markdown } = summarizeOfficialResearchResults(packets);
writeFileSync('research-summary.md', markdown);
console.log(markdown);
process.exit(exitCode);
