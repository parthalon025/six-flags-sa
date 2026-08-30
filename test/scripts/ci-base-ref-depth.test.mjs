#!/usr/bin/env node
/**
 * The stamp-reading job must not shallow-fetch its base ref.
 *
 * `select` checks out at `fetch-depth: 0` and then used to run
 * `git fetch origin "$BASE_REF" --depth=1`. A shallow fetch on top of a full
 * checkout writes `.git/shallow` and grafts the base to a parentless commit,
 * and a grafted base stops excluding anything: `mergeBase..HEAD` then reached
 * stamps already merged to main, so a branch that had never run the gate
 * inherited another branch's stamp and CI skipped the matrix for it.
 *
 * Only a YAML comment stood between that and a reintroduction, which is the
 * same shape of gap that let the maxBuffer cap regress unnoticed. This asserts
 * the invariant instead.
 *
 *   node test/scripts/ci-base-ref-depth.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/test-app.yml'), 'utf8');

/** The job block starting at `name:` and running to the next top-level job. */
function jobBlock(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `test-app.yml has no ${id} job`);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n {2}[a-z][a-z0-9-]*:\n {4}name:/);
  return next === -1 ? rest : rest.slice(0, next);
}

const select = jobBlock('select');

assert.match(select, /fetch-depth:\s*0/, 'select still checks out full history');

const baseFetches = [...select.matchAll(/git fetch origin[^\n]*/g)].map((m) => m[0]);
assert.ok(baseFetches.length > 0, 'select still fetches its base ref');
for (const line of baseFetches) {
  assert.ok(
    !/--depth[= ]/.test(line) && !/--shallow/.test(line),
    `select must not shallow-fetch its base ref — a graft makes mergeBase..HEAD stop excluding it:\n    ${line}`,
  );
}

// The gate job is a different case and deliberately unchanged: it checks out at
// fetch-depth: 2 and reads no stamps, so its shallow fetch is what makes
// origin/main resolvable there at all.
assert.match(jobBlock('gate'), /fetch-depth:\s*2/, 'gate still checks out shallow');

console.log(`ci-base-ref-depth: ok (${baseFetches.length} base fetch(es) in select, none shallow)`);
