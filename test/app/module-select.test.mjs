#!/usr/bin/env node
/**
 * Unit tests for change-scoped module selection (no browser).
 */
import {
  globToRegExp,
  pathMatches,
  selectModulesFromFiles,
  parseModulesArg,
  wantModule,
  loadModulesManifest,
  toGithubOutputs,
} from './lib/module-select.mjs';

let failed = 0;
const assert = (cond, msg) => {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('PASS', msg);
  }
};

assert(pathMatches('apps/party-tracker/lib/party/x.js', 'apps/party-tracker/lib/party/**'), 'party glob');
assert(pathMatches('packages/venue-builder/lib/a.mjs', 'packages/venue-builder/**'), 'builder glob');
assert(
  pathMatches('apps/party-tracker/components/HeightPanel.jsx', 'apps/party-tracker/components/Height*'),
  'height star',
);
assert(!pathMatches('README.md', 'apps/party-tracker/**'), 'readme not app');

const re = globToRegExp('a/**/b/*.js');
assert(re.test('a/x/b/c.js'), 'nested glob');

const manifest = loadModulesManifest();

{
  const sel = selectModulesFromFiles(['docs/readme-only.md'], manifest);
  assert(sel.modules.includes('contract'), 'docs still get contract');
  assert(!sel.modules.includes('party'), 'docs do not pull party');
  assert(!sel.modules.includes('builder'), 'docs do not pull builder');
  assert(!sel.fullSuite, 'docs not full suite');
}

{
  const sel = selectModulesFromFiles(
    ['.gitnexus/lbug', '.gitnexus/meta.json', 'AGENTS.md', 'CLAUDE.md'],
    manifest,
  );
  assert(sel.modules.includes('contract'), 'gitnexus still get contract');
  assert(!sel.modules.includes('party'), 'gitnexus do not pull party');
  assert(!sel.modules.includes('builder'), 'gitnexus do not pull builder');
  assert(!sel.fullSuite, 'gitnexus not full suite');
}

{
  const sel = selectModulesFromFiles(
    ['.gitnexus/meta.json', 'apps/party-tracker/components/HeightPanel.jsx'],
    manifest,
  );
  assert(sel.modules.includes('heights'), 'mixed gitnexus + heights still selects heights');
  assert(!sel.fullSuite, 'mixed gitnexus is not full suite');
}

{
  const sel = selectModulesFromFiles(['apps/party-tracker/lib/party/client.js'], manifest);
  assert(sel.modules.includes('party'), 'party path → party');
  assert(sel.modules.includes('grandma'), 'party path → grandma via pulls');
  assert(sel.modules.includes('contract'), 'always contract');
  assert(!sel.modules.includes('walk'), 'party path skips walk');
}

{
  const sel = selectModulesFromFiles(['packages/venue-builder/lib/foo.mjs'], manifest);
  assert(sel.modules.includes('builder'), 'builder path');
  assert(!sel.modules.includes('party'), 'builder alone skips party');
}

{
  const sel = selectModulesFromFiles(['.github/workflows/test-app.yml'], manifest);
  assert(sel.fullSuite, 'workflow edit → full suite');
  assert(sel.modules.includes('grandma'), 'full includes grandma');
  assert(sel.modules.includes('builder'), 'full includes builder');
}

{
  const sel = selectModulesFromFiles(['apps/party-tracker/lib/obscure-new-thing.js'], manifest);
  // No module-specific glob → uiDefaultWhenAppTouches
  assert(sel.modules.includes('grandma'), 'unknown app file → UI default includes grandma');
  assert(sel.modules.includes('smoke'), 'unknown app file → UI default includes smoke');
}

{
  const sel = selectModulesFromFiles(['apps/party-tracker/components/HeightPanel.jsx'], manifest);
  assert(sel.modules.includes('heights'), 'height panel → heights');
  assert(!sel.modules.includes('party'), 'height panel skips party');
  assert(!sel.modules.includes('grandma'), 'height panel does not pull grandma');
}

{
  const set = parseModulesArg(['--modules=party,smoke'], {});
  assert(set.has('party') && set.has('smoke') && set.size === 2, 'parse --modules=');
  assert(wantModule(set, 'party') && !wantModule(set, 'walk'), 'wantModule');
  assert(wantModule(null, 'walk'), 'null means all');
}

{
  const sel = selectModulesFromFiles(['apps/party-tracker/lib/party/x.js'], manifest);
  const gh = toGithubOutputs(sel, manifest);
  assert(gh.builder === 'false', 'github builder false');
  assert(gh.any_ui === 'true', 'github any_ui');
  const matrix = JSON.parse(gh.ui_matrix);
  assert(matrix.includes('party'), 'matrix has party');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nmodule-select unit ok');
}
