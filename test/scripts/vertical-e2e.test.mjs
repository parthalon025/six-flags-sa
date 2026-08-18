#!/usr/bin/env node
/**
 * Vertical e2e gate — which verticals a diff owes, and what blocks a merge.
 *
 *   node test/scripts/vertical-e2e.test.mjs
 */
import assert from 'node:assert/strict';
import {
  VERTICALS,
  VERTICAL_IDS,
  isCodeFile,
  requiredVerticals,
  stampCoversVerticals,
  unclassifiedCodeFiles,
  verticalE2eBlockReason,
  verticalPlan,
  verticalsForFiles,
} from '../../scripts/lib/vertical-e2e.mjs';

// Every row has to name the output it asserts on — a vertical without an
// output check is the thing this gate exists to prevent.
for (const v of VERTICALS) {
  assert.ok(v.id && v.title, 'vertical needs an id and title');
  assert.match(v.command, /^npm run /, `${v.id} names a runnable command`);
  assert.ok(v.validates.length > 20, `${v.id} says what output it validates`);
  assert.ok(v.paths.length, `${v.id} claims paths`);
}

// Code vs not — stamps are gate output, never the work being proven.
assert.equal(isCodeFile('apps/party-tracker/app/page.js'), true);
assert.equal(isCodeFile('scripts/lib/vercel-ignore.mjs'), true);
assert.equal(isCodeFile('.github/workflows/test-app.yml'), true);
assert.equal(isCodeFile('docs/agents/ci.md'), false);
assert.equal(isCodeFile('CONTEXT.md'), false);
assert.equal(isCodeFile('scripts/ci/local-ci-pass.json'), false);
assert.equal(isCodeFile('scripts/ci/matt-review-pass.json'), false);

// Selection
assert.deepEqual(requiredVerticals(['docs/guide/testing.md']), []);
assert.deepEqual(requiredVerticals(['apps/party-tracker/components/Sheet.jsx']), ['app']);
assert.deepEqual(requiredVerticals(['scripts/lib/vercel-ignore.mjs']), ['automation']);
assert.deepEqual(
  requiredVerticals(['packages/venue-builder/venue-adapters.mjs']),
  ['app', 'builder'],
  'builder changes are proven upstream and in the app',
);
assert.deepEqual(
  requiredVerticals(['scripts/ci/local-ci-pass.json']),
  [],
  'a stamp-only commit owes nothing',
);

// Fails closed: unknown diff, and code no vertical claims.
assert.deepEqual(requiredVerticals(null), VERTICAL_IDS, 'unknown diff owes every vertical');
assert.deepEqual(unclassifiedCodeFiles(['test/nowhere/thing.mjs']), ['test/nowhere/thing.mjs']);
assert.deepEqual(requiredVerticals(['test/nowhere/thing.mjs']), VERTICAL_IDS);
assert.deepEqual(unclassifiedCodeFiles(['apps/party-tracker/app/page.js']), []);
assert.deepEqual(
  unclassifiedCodeFiles(VERTICALS.flatMap((v) => v.paths.map((p) => p.replace(/\*\*/g, 'x')))),
  [],
  'every declared path stays claimed by its own vertical',
);

// Plan reports the command and the output for each required vertical.
const plan = verticalPlan(['apps/party-tracker/app/page.js']);
assert.deepEqual(plan.required, ['app']);
assert.equal(plan.steps[0].command, 'npm run test:validate-ui:changed');

// --skip-browser cannot stand in for the app vertical.
assert.match(
  verticalE2eBlockReason({
    files: ['apps/party-tracker/components/Sheet.jsx'],
    ran: ['app'],
    skipBrowser: true,
  }),
  /do not --skip-browser/,
);
assert.equal(
  verticalE2eBlockReason({ files: ['scripts/lib/x.mjs'], ran: ['automation'], skipBrowser: true }),
  null,
  'a diff that does not touch app behaviour may skip the browser',
);

// A vertical that never ran blocks, and says which command to run.
const missing = verticalE2eBlockReason({
  files: ['packages/venue-builder/venue-adapters.mjs'],
  ran: ['app'],
});
assert.match(missing, /vertical e2e missing for this diff: builder/);
assert.match(missing, /npm run test:builder/);
assert.match(missing, /generated venue output/);

assert.match(
  verticalE2eBlockReason({ files: ['test/nowhere/thing.mjs'], ran: [] }),
  /add the path to VERTICALS/,
);
assert.equal(verticalE2eBlockReason({ files: ['README.md'], ran: [] }), null);
assert.equal(
  verticalE2eBlockReason({ files: ['apps/party-tracker/app/page.js'], ran: ['app'] }),
  null,
);

// Stamp coverage
assert.equal(stampCoversVerticals({ verticals: ['app'] }, ['app']), true);
assert.equal(stampCoversVerticals({ verticals: ['app'] }, ['app', 'builder']), false);
assert.equal(stampCoversVerticals(null, []), true, 'nothing required is covered by nothing');
assert.equal(stampCoversVerticals(null, ['app']), false);
assert.equal(
  stampCoversVerticals({ browserVertical: true }, ['app']),
  false,
  'a pre-verticals stamp never covers a code diff',
);

// verticalsForFiles is the raw match; requiredVerticals adds the fail-closed rules.
assert.deepEqual(verticalsForFiles(['test/nowhere/thing.mjs']), []);

console.log('vertical-e2e.test: ok');
