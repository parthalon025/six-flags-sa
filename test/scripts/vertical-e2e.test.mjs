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
  guestBrowserRequired,
  isCodeFile,
  noCodeWorkRequired,
  requiredVerticals,
  stampCoversVerticals,
  unclassifiedCodeFiles,
  verticalE2eBlockReason,
  verticalPlan,
  verticalsForFiles,
} from '../../scripts/lib/vertical-e2e.mjs';

for (const v of VERTICALS) {
  assert.ok(v.id && v.title, 'vertical needs an id and title');
  assert.match(v.command, /^npm run /, `${v.id} names a runnable command`);
  if (v.id !== 'app') assert.ok(v.paths.length, `${v.id} claims paths`);
}

assert.equal(isCodeFile('apps/party-tracker/app/page.js'), true);
assert.equal(isCodeFile('scripts/lib/vercel-ignore.mjs'), true);
assert.equal(isCodeFile('.github/workflows/test-app.yml'), true);
assert.equal(isCodeFile('docs/agents/ci.md'), false);
assert.equal(isCodeFile('scripts/ci/local-ci-pass.json'), false);

assert.deepEqual(requiredVerticals(['docs/guide/testing.md']), []);
assert.deepEqual(
  requiredVerticals(['.scratch/factories-to-app/map.md', 'scripts/lib/operating-stack.json']),
  [],
  'agent-policy diff owes no vertical',
);
assert.equal(
  noCodeWorkRequired(['.scratch/factories-to-app/map.md', 'scripts/lib/operating-stack.json']),
  true,
);

assert.deepEqual(requiredVerticals(['scripts/lib/vercel-ignore.mjs']), ['backside']);
assert.deepEqual(requiredVerticals(['apps/party-tracker/app/api/version/route.js']), ['backside']);
assert.deepEqual(
  requiredVerticals(['packages/venue-builder/venue-adapters.mjs']),
  ['builder'],
  'builder packages do not pull the guest app vertical',
);
assert.deepEqual(
  requiredVerticals(['packages/shared/zoomBands.js']),
  ['backside'],
  'non-builder packages are backside',
);
assert.deepEqual(requiredVerticals(['scripts/ci/local-ci-pass.json']), []);
assert.deepEqual(requiredVerticals(['apps/party-tracker/public/app-version.json']), []);

assert.ok(
  guestBrowserRequired(['apps/party-tracker/components/Sheet.jsx']),
  'guest components select UI modules',
);
assert.equal(
  guestBrowserRequired(['apps/party-tracker/lib/serverStore.js']),
  false,
  'server lib alone does not select guest browser suites',
);

assert.deepEqual(
  requiredVerticals(['apps/party-tracker/components/Sheet.jsx']),
  ['app'],
  'guest UI module selection pulls app vertical only',
);
assert.deepEqual(
  requiredVerticals(['apps/party-tracker/lib/serverStore.js']),
  ['backside'],
  'server lib is backside without browser',
);

assert.deepEqual(requiredVerticals(['CLAUDE.md', '.gitnexus/graph.db']), []);
assert.equal(noCodeWorkRequired(['docs/guide/testing.md']), true);
assert.equal(noCodeWorkRequired(null), false);
assert.equal(noCodeWorkRequired(['scripts/lib/foo.mjs']), false);

assert.deepEqual(requiredVerticals(null), VERTICAL_IDS);
assert.deepEqual(unclassifiedCodeFiles(['test/nowhere/thing.mjs']), ['test/nowhere/thing.mjs']);
assert.deepEqual(requiredVerticals(['test/nowhere/thing.mjs']), VERTICAL_IDS);
assert.deepEqual(unclassifiedCodeFiles(['apps/party-tracker/app/api/route.js']), []);

const plan = verticalPlan(['apps/party-tracker/components/Sheet.jsx']);
assert.deepEqual(plan.required, ['app']);
assert.equal(plan.steps[0].command, 'npm run test:validate-ui:changed');

assert.match(
  verticalE2eBlockReason({
    files: ['apps/party-tracker/components/Sheet.jsx'],
    ran: ['app'],
    skipBrowser: true,
  }),
  /do not --skip-browser/,
);
assert.equal(
  verticalE2eBlockReason({ files: ['scripts/lib/x.mjs'], ran: ['backside'], skipBrowser: true }),
  null,
);

const missing = verticalE2eBlockReason({
  files: ['packages/venue-builder/venue-adapters.mjs'],
  ran: [],
});
assert.match(missing, /vertical e2e missing for this diff: builder/);
assert.match(missing, /npm run test:builder/);

assert.equal(verticalE2eBlockReason({ files: ['README.md'], ran: [] }), null);
assert.equal(
  verticalE2eBlockReason({ files: ['apps/party-tracker/components/Sheet.jsx'], ran: ['app'] }),
  null,
);

assert.equal(stampCoversVerticals({ verticals: ['app'] }, ['app']), true);
assert.equal(stampCoversVerticals({ verticals: ['app'] }, ['app', 'builder']), false);
assert.equal(stampCoversVerticals(null, []), true);
assert.equal(stampCoversVerticals(null, ['app']), false);

assert.deepEqual(verticalsForFiles(['test/nowhere/thing.mjs']), []);

console.log('vertical-e2e.test: ok');
