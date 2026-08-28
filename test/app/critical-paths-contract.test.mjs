#!/usr/bin/env node
/**
 * critical-paths.json is the shipped-capability contract; each row's `check`
 * must name a string that actually appears in the suite file it points at.
 * Without this gate the registry drifts silently — real coverage reported as
 * upcoming, and absent coverage reported as shipped.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contract = JSON.parse(readFileSync(path.join(REPO, 'test/app/critical-paths.json'), 'utf8'));
const suites = contract.suites ?? {};

const suiteSources = Object.fromEntries(
  Object.entries(suites).map(([id, rel]) => [id, readFileSync(path.join(REPO, rel), 'utf8')]),
);

const uncoveredSuites = Object.keys(suiteSources).filter((id) => id !== 'functional' && id !== 'grandma');
if (uncoveredSuites.length) {
  assert.fail(
    `critical-paths gate covers functional and grandma only; add a matcher for: ${uncoveredSuites.join(', ')}`,
  );
}

function checkAppearsIn(source, needle) {
  if (source.includes(`check('${needle}'`) || source.includes(`check("${needle}"`)) {
    return true;
  }
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`check\\(\\s*['"]${escaped}['"]`).test(source);
}

const orphans = [];
for (const row of contract.paths ?? []) {
  const suite = row.suite;
  const source = suiteSources[suite];
  if (!source) {
    orphans.push(`${row.id}: unknown suite "${suite}"`);
    continue;
  }
  if (suite === 'functional') {
    const needle = row.check;
    if (!needle) {
      orphans.push(`${row.id}: functional row missing check`);
      continue;
    }
    if (!checkAppearsIn(source, needle)) {
      orphans.push(`${row.id}: check not in functional.mjs — ${JSON.stringify(needle)}`);
    }
    continue;
  }
  if (suite === 'grandma') {
    const needle = row.check_includes;
    if (!needle) {
      orphans.push(`${row.id}: grandma row missing check_includes`);
      continue;
    }
    if (!source.includes(needle)) {
      orphans.push(`${row.id}: check_includes not in grandma.mjs — ${JSON.stringify(needle)}`);
    }
  }
}

assert.deepEqual(
  orphans,
  [],
  `critical-paths.json rows without a matching suite check:\n${orphans.map((o) => `  - ${o}`).join('\n')}`,
);

console.log(`critical-paths contract: ${contract.paths.length} rows wired to suite checks`);
