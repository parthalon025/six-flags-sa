#!/usr/bin/env node
/**
 * Every test suite on disk is wired into a script that CI runs.
 *
 * A suite nobody invokes is worse than no suite: it reads as coverage in the
 * tree, passes review because it genuinely does assert things, and protects
 * nothing. Three landed that way in one afternoon — display-pyramid.mjs,
 * imagery-ledger.mjs and naip.mjs, together over 1,500 lines of assertions —
 * because each was written by a parallel agent scoped to its own files and
 * forbidden from editing package.json, so each correctly reported the wiring as
 * someone else's job and nobody did it.
 *
 * That is a structural gap rather than an oversight: no single lane can see it,
 * and the reviewer of a lane cannot either, because the fact is about the
 * relationship between a directory and a script. Only a repo-wide check sees
 * it, so this is that check.
 *
 *   node test/scripts/suite-wiring.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));

/** Every npm script, concatenated, plus the browser module manifest — a suite
 *  counts as wired if ANY of them reaches it. Some live in test:unit, some in
 *  test:builder, and the functional modules are named in modules.json rather
 *  than in a script. */
const allScripts = [
  Object.values(pkg.scripts).join(' && '),
  readFileSync(path.join(REPO, 'test/app/modules.json'), 'utf8'),
].join('\n');

/** Suites deliberately not run by a script, each with the reason it is exempt.
 *  An entry here is a claim that has to stay true; the test below fails an
 *  exemption whose file no longer exists, so this list cannot rot into an
 *  excuse for a suite somebody merged and forgot. */
const NOT_WIRED = Object.freeze({
  // Hand-run audit tools, not suites: they print findings for a human to read
  // and have no pass/fail contract for CI to gate on.
  'test/app/audit-mobile.mjs': 'hand-run audit tool, prints findings rather than asserting',
  'test/app/audit-overlap.mjs': 'hand-run audit tool, prints findings rather than asserting',
  'test/app/audit-visual.mjs': 'hand-run audit tool, prints findings rather than asserting',
  // A helper the browser modules import; modules.json names it, no script runs
  // it directly because it is not a suite.
  'test/app/browser.mjs': 'shared browser harness imported by the functional modules',
  // The critical-path gate is a library plus a --stamp CLI; the suite that
  // asserts on it is test/app/coverage-contract.test.mjs, which test:unit runs.
  'test/app/coverage-contract.mjs':
    'critical-path contract library and --stamp CLI, asserted by coverage-contract.test.mjs',
});

// test/scripts is deliberately absent: ci-module.test.mjs already asserts every
// test/scripts/*.test.mjs appears in GATE_SCRIPT_TESTS, and duplicating that
// here would fail every one of them, since the gate manifest runs them rather
// than an npm script naming each. Checking a directory that already has a
// guard is how you get a guard that has to be weakened to pass.
const dirs = ['test/builder', 'test/app'];

for (const dir of dirs) {
  const suites = readdirSync(path.join(REPO, dir))
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => `${dir}/${f}`);

  assert.ok(suites.length > 0, `${dir} has no suites — did the directory move?`);

  const orphans = suites.filter(
    (rel) => !allScripts.includes(rel) && !(rel in NOT_WIRED),
  );

  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} suite(s) in ${dir} are in no npm script, so CI never runs them: `
      + `${orphans.join(', ')} — add each to test:builder or test:unit, or declare it in `
      + 'NOT_WIRED with the reason',
  );
}

// An exemption for a file that no longer exists is a stale claim; drop it
// rather than leaving a name that reads as deliberate.
for (const rel of Object.keys(NOT_WIRED)) {
  const suites = readdirSync(path.join(REPO, path.dirname(rel)));
  assert.ok(
    suites.includes(path.basename(rel)),
    `NOT_WIRED names ${rel}, which does not exist — remove the exemption`,
  );
}

console.log('suite-wiring: ok');
