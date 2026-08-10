#!/usr/bin/env node
/** Builder compare suite — built bundles must match manifest. */
import { compareAll, summary } from '../../packages/venue-builder/src/compare.mjs';

const PASS = [];
const FAIL = [];
const ok = (n) => { PASS.push(n); console.log('  PASS', n); };
const bad = (n, e) => { FAIL.push(`${n} :: ${e}`); console.log('  FAIL', n, '->', e); };

console.log('\nbuilder compare suite\n');

const reports = compareAll();
const s = summary(reports);

for (const { stats, issues } of reports) {
  if (stats.ok) ok(`${stats.id} matches manifest`);
  else bad(`${stats.id} drift`, issues.join('; ') || 'unknown');
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed (${s.passed}/${s.total} venues) ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
