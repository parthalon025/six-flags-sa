#!/usr/bin/env node
/** CLI: compare every built venue against its manifest row. */
import { compareAll, summary } from '../src/compare.mjs';

const reports = compareAll();
const s = summary(reports);

for (const { stats, issues } of reports) {
  const mark = stats.ok ? 'ok' : 'FAIL';
  console.log(`${mark}  ${stats.id}  pois=${stats.actual.pois ?? '?'} paths=${stats.actual.paths ?? '?'} heights=${stats.actual.heights ?? '?'}`);
  for (const issue of issues) console.log(`       - ${issue}`);
}

console.log(`\n==== ${s.passed}/${s.total} venues match manifest ====`);
if (s.failed) process.exitCode = 1;
