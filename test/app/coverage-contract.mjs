#!/usr/bin/env node
/**
 * Critical-path coverage contract (middle ground).
 *
 * Not every UI action — just the vertical user capabilities we claim to ship.
 * Fails if a required check title is missing from functional.mjs / grandma.mjs.
 * Upcoming epic rows are listed but not enforced until their `check` is set.
 *
 *   node test/app/coverage-contract.mjs
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const contract = JSON.parse(readFileSync(path.join(HERE, 'critical-paths.json'), 'utf8'));

const sources = {
  functional: readFileSync(path.join(ROOT, contract.suites.functional), 'utf8'),
  grandma: readFileSync(path.join(ROOT, contract.suites.grandma), 'utf8'),
};

const missing = [];
const ok = [];

for (const row of contract.paths) {
  const src = sources[row.suite];
  if (!src) {
    missing.push(`${row.id}: unknown suite ${row.suite}`);
    continue;
  }
  if (row.check) {
    const needle = `await check('${row.check}'`;
    const alt = `await check("${row.check}"`;
    if (!src.includes(needle) && !src.includes(alt)) {
      missing.push(`${row.id}: missing check "${row.check}" in ${row.suite}`);
    } else {
      ok.push(row.id);
    }
  } else if (row.check_includes) {
    if (!new RegExp(row.check_includes, 'i').test(src)) {
      missing.push(`${row.id}: ${row.suite} has no check mentioning /${row.check_includes}/i`);
    } else {
      ok.push(row.id);
    }
  }
}

console.log(`coverage-contract: ${ok.length} critical paths present`);
if (contract.upcoming?.length) {
  console.log(`coverage-contract: ${contract.upcoming.length} upcoming epic rows (not enforced yet)`);
}
if (missing.length) {
  console.error('coverage-contract FAILED:');
  for (const m of missing) console.error(' !', m);
  process.exitCode = 1;
} else {
  console.log('coverage-contract ok');
}
