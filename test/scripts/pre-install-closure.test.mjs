#!/usr/bin/env node
/**
 * The pre-install import closure — nothing the CI gate loads before `npm ci`
 * may reach for a workspace package by name.
 *
 * `scripts/ci/gate-tests.mjs` runs on a runner that has not linked the npm
 * workspaces yet. `scripts/lib/venue-report-gate.mjs` says so in its own header
 * and imports its implementation by relative path for exactly this reason, and
 * `venue-ids.mjs` reaches the app's `slug()` the same way. But nothing enforced
 * it: wiring the inventory lane into `ship-gaps.mjs` pulled
 * `@party-tracker/shared` into the closure through two new modules, every local
 * suite stayed green because node_modules is linked here, and CI failed on a
 * runner with ERR_MODULE_NOT_FOUND (#29).
 *
 * So this walks the real static-import graph from the gate's own entry points
 * and fails on the first bare workspace specifier, naming the file and the
 * chain that reached it. A relative import of the same file is fine — that is
 * the established way across this boundary.
 */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Entry points the gate loads before `npm ci` has run. */
const ENTRY_POINTS = [
  'scripts/lib/venue-report-gate.mjs',
  'scripts/ci/gate-tests.mjs',
  'scripts/ci/manifest.mjs',
];

/** A specifier npm only resolves once the workspaces are linked. */
const WORKSPACE_SPECIFIER = /^@party-tracker\//;

/** Static `import … from '…'` and `export … from '…'` specifiers. */
function specifiersOf(source) {
  const out = [];
  const re = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s*['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  for (const m of source.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

function resolveRelative(fromFile, spec) {
  const abs = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [abs, `${abs}.mjs`, `${abs}.js`, path.join(abs, 'index.mjs')]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  }
  return null;
}

/** @returns {{file: string, spec: string, chain: string[]}[]} */
function workspaceReaches(entry) {
  const found = [];
  const seen = new Set();
  const stack = [{ file: path.join(REPO, entry), chain: [entry] }];
  while (stack.length) {
    const { file, chain } = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of specifiersOf(source)) {
      if (WORKSPACE_SPECIFIER.test(spec)) {
        found.push({ file: path.relative(REPO, file), spec, chain });
        continue;
      }
      if (!spec.startsWith('.')) continue; // node: builtins and real deps
      const next = resolveRelative(file, spec);
      if (next) stack.push({ next: null, file: next, chain: [...chain, path.relative(REPO, next)] });
    }
  }
  return found;
}

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${err.message}`);
  }
}

console.log('\npre-install closure\n');

check('the graph walker actually reaches past the entry file', () => {
  // Guard against a walker that silently resolves nothing and passes vacuously.
  const seen = new Set();
  const stack = [path.join(REPO, 'scripts/lib/venue-report-gate.mjs')];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let src;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    for (const spec of specifiersOf(src)) {
      if (!spec.startsWith('.')) continue;
      const next = resolveRelative(file, spec);
      if (next) stack.push(next);
    }
  }
  assert.ok(
    seen.size > 15,
    `walked only ${seen.size} files from venue-report-gate — the resolver is not following imports`,
  );
  assert.ok(
    [...seen].some((f) => f.endsWith('/ship-gaps.mjs')),
    'ship-gaps.mjs is in this closure via venue-io.mjs; a walk that misses it proves nothing',
  );
});

for (const entry of ENTRY_POINTS) {
  check(`${entry} reaches no workspace package by name`, () => {
    const hits = workspaceReaches(entry);
    assert.deepEqual(
      hits.map((h) => `${h.file} imports ${h.spec}`),
      [],
      hits
        .map((h) => `${h.file} imports "${h.spec}"\n      reached by: ${h.chain.join(' -> ')}`)
        .join('\n    ')
        + '\n    The CI gate loads this before `npm ci` links the workspaces, so a bare'
        + '\n    "@party-tracker/…" specifier is ERR_MODULE_NOT_FOUND on a runner.'
        + '\n    Import the same file by relative path, as venue-ids.mjs does.',
    );
  });
}

check('a bare workspace specifier in the closure is what this refuses', () => {
  // The refusal itself, exercised on a synthetic source rather than by breaking
  // a real file: a test that can only fail by regression proves nothing today.
  const specs = specifiersOf("import { isRideable } from '@party-tracker/shared/ontology.js';\n");
  assert.deepEqual(specs, ['@party-tracker/shared/ontology.js']);
  assert.ok(WORKSPACE_SPECIFIER.test(specs[0]), 'the rule must match a workspace specifier');
  assert.ok(!WORKSPACE_SPECIFIER.test('../../shared/ontology.js'), 'a relative import is allowed');
});

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
if (failed) process.exit(1);
