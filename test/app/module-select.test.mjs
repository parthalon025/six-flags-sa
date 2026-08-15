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
  assert(sel.modules.length === 0, 'docs select nothing');
  assert(!sel.modules.includes('contract'), 'docs do not run contract');
  assert(!sel.modules.includes('lint'), 'docs do not run lint');
  assert(!sel.fullSuite, 'docs not full suite');
}

{
  const sel = selectModulesFromFiles(
    ['.gitnexus/lbug', '.gitnexus/meta.json', 'AGENTS.md', 'CLAUDE.md'],
    manifest,
  );
  assert(sel.modules.length === 0, 'gitnexus-only select nothing');
  assert(!sel.modules.includes('contract'), 'gitnexus do not run contract');
  assert(!sel.modules.includes('party'), 'gitnexus do not pull party');
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
  assert(sel.modules.includes('contract'), 'UI module pulls contract');
  assert(sel.modules.includes('lint'), 'party JS runs lint');
  assert(!sel.modules.includes('walk'), 'party path skips walk');
}

{
  const sel = selectModulesFromFiles(['packages/venue-builder/lib/foo.mjs'], manifest);
  assert(sel.modules.includes('builder'), 'builder path');
  assert(!sel.modules.includes('party'), 'builder alone skips party');
}

{
  const sel = selectModulesFromFiles(['fastlane/metadata/ios/routing_app_coverage.geojson'], manifest);
  assert(sel.modules.includes('builder'), 'routing coverage geojson → builder');
  assert(sel.modules.includes('venues'), 'routing coverage geojson → venues');
  assert(sel.modules.includes('contract'), 'venues pulls contract');
  assert(!sel.modules.includes('party'), 'routing coverage skips party');
}

{
  const sel = selectModulesFromFiles(
    [
      'package.json',
      'package-lock.json',
      'apps/party-tracker/package.json',
      'apps/party-tracker/public/app-version.json',
      'apps/party-tracker/public/sw.js',
      'apps/party-tracker/data/release-notes.json',
    ],
    manifest,
  );
  assert(sel.modules.length === 0, 'version-stamp-only selects nothing');
  assert(!sel.fullSuite, 'version-stamp-only is not full suite despite package.json');
}

{
  const sel = selectModulesFromFiles(['.github/workflows/test-app.yml'], manifest);
  assert(sel.fullSuite, 'workflow edit → full suite');
  assert(sel.modules.includes('grandma'), 'full includes grandma');
  assert(sel.modules.includes('builder'), 'full includes builder');
  assert(sel.modules.includes('lint'), 'full includes lint');
  assert(sel.modules.includes('selector'), 'full includes selector');
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
  assert(sel.modules.includes('contract'), 'height panel pulls contract');
  assert(sel.modules.includes('lint'), 'height panel runs lint');
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
  assert(gh.lint === 'true', 'github lint');
  assert(gh.contract === 'true', 'github contract');
  assert(gh.selector === 'false', 'github selector skipped');
  const matrix = JSON.parse(gh.ui_matrix);
  assert(matrix.includes('party'), 'matrix has party');
}

{
  const sel = selectModulesFromFiles(['eslint.config.mjs'], manifest);
  assert(sel.modules.includes('lint'), 'eslint config → lint');
  assert(!sel.modules.includes('party'), 'eslint config skips UI');
  assert(!sel.modules.includes('contract'), 'eslint config skips contract');
  const gh = toGithubOutputs(sel, manifest);
  assert(gh.lint === 'true', 'eslint config github lint');
  assert(gh.any_ui === 'false', 'eslint config no UI matrix');
}

{
  const sel = selectModulesFromFiles(['test/app/module-select.test.mjs'], manifest);
  assert(sel.modules.includes('selector'), 'selector test → selector unit');
  assert(!sel.modules.includes('smoke'), 'selector test does not default the UI suite');
  assert(!sel.fullSuite, 'selector test is not full suite');
}

{
  const sel = selectModulesFromFiles(['packages/shared/ontology.js'], manifest);
  assert(sel.modules.includes('smoke'), 'shared package → UI default');
  assert(sel.modules.includes('contract'), 'shared package pulls contract');
  assert(!sel.modules.includes('lint'), 'shared package is not eslint-covered');
}

{
  const sel = selectModulesFromFiles(['test/app/critical-paths.json'], manifest);
  assert(sel.modules.includes('contract'), 'contract file → contract');
  assert(!sel.modules.includes('party'), 'contract file skips UI');
}

{
  const sel = selectModulesFromFiles(['apps/party-tracker/app/sign-in/[[...sign-in]]/page.jsx'], manifest);
  assert(sel.modules.includes('auth'), 'sign-in page → auth');
  assert(sel.modules.includes('smoke'), 'auth pulls smoke');
  assert(!sel.fullSuite, 'sign-in alone is not full suite');
}

{
  const sel = selectModulesFromFiles(['docs/readme-only.md'], manifest);
  const gh = toGithubOutputs(sel, manifest);
  assert(gh.modules === '', 'docs github modules empty');
  assert(gh.lint === 'false', 'docs github lint false');
  assert(gh.contract === 'false', 'docs github contract false');
  assert(gh.any_ui === 'false', 'docs github any_ui false');
  assert(gh.ui_matrix === '[]', 'docs github empty matrix');
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exitCode = 1;
} else {
  console.log('\nmodule-select unit ok');
}
