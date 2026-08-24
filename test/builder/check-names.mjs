#!/usr/bin/env node
/**
 * Check-name guard for the browser-free builder/app suite.
 *
 * `test/builder/unit.mjs` is 9k lines and is being split file by file. A split
 * is only safe if every check survives it, and the cheapest way to lose one is
 * to drop a block while moving it: the suite still passes, with fewer checks.
 *
 * So the names are pinned. This runs the suites named in `sources` and asserts
 * the `section :: check` pairs they *produce* are exactly the pinned set —
 * produced, not merely present in the source text, so a check parked behind a
 * dead `if` is caught too.
 *
 * When a split moves checks between files, update `sources`; the set must not
 * move. When a check is genuinely added or removed, edit `checks` in the same
 * commit and say why in the message — that edit is the review point.
 *
 *   node test/builder/check-names.mjs
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const FIXTURE = path.join(HERE, 'check-names.json');

const pinned = JSON.parse(readFileSync(FIXTURE, 'utf8'));

/** The harness in these suites prints `--- section ---` then `  PASS name`. */
function parseCheckNames(stdout) {
  const names = [];
  let group = '';
  for (const line of String(stdout).split('\n')) {
    const section = line.match(/^--- (.+) ---$/);
    if (section) {
      group = section[1];
      continue;
    }
    const check = line.match(/^ {2}(?:PASS|FAIL) (.*?)(?: -> .*)?$/);
    if (check) names.push(`${group} :: ${check[1]}`);
  }
  return names;
}

const produced = [];
for (const rel of pinned.sources) {
  const run = spawnSync(process.execPath, [rel], { cwd: ROOT, encoding: 'utf8' });
  if (run.status !== 0) {
    console.error(run.stdout);
    console.error(run.stderr);
    throw new Error(`${rel} exited ${run.status} — fix the suite before reading its check names`);
  }
  const names = parseCheckNames(run.stdout);
  assert.ok(names.length, `${rel} produced no named checks — is the harness still printing them?`);
  produced.push(...names);
}

const dupes = produced.filter((n, i) => produced.indexOf(n) !== i);
assert.deepEqual(
  [...new Set(dupes)],
  [],
  'two checks share one section :: name, so one of them cannot be told apart from the other',
);

const have = new Set(produced);
const want = new Set(pinned.checks);
const missing = pinned.checks.filter((n) => !have.has(n));
const added = produced.filter((n) => !want.has(n));

if (missing.length || added.length) {
  console.error(`check-names: ${produced.length} produced, ${pinned.checks.length} pinned`);
  for (const n of missing) console.error(`  LOST  ${n}`);
  for (const n of added) console.error(`  NEW   ${n}`);
  console.error(
    '\nA split must move checks, never lose or rename them. If this change is deliberate,',
    `\nedit ${path.relative(ROOT, FIXTURE)} in the same commit and say why.`,
  );
  process.exit(1);
}

console.log(`check-names: ${produced.length} checks across ${pinned.sources.length} file(s), unchanged`);
