/**
 * Vercel ignore must look at THIS commit vs its first parent.
 *
 * Diffing against VERCEL_GIT_PREVIOUS_SHA skips production after a successful
 * preview: the merge commit tree matches the PR head, git diff is empty, and
 * the live alias never moves.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decideVercelBuild,
  isAgentPreviewBranch,
  isVersionStampOnlyChange,
} from '../../scripts/lib/vercel-ignore.mjs';

assert.equal(
  decideVercelBuild({ files: ['apps/party-tracker/lib/party/hostService.js'] }).build,
  true,
  'app file vs first parent must build',
);
assert.equal(
  decideVercelBuild({ files: ['apps/party-tracker/lib/party/hostService.js', 'package.json'] }).build,
  true,
  'app file with package.json must build',
);
assert.equal(
  decideVercelBuild({ files: ['.gitnexus/meta.json'] }).build,
  false,
  'gitnexus-only commit must skip',
);
assert.equal(
  decideVercelBuild({ files: ['docs/adr/0001-auth-profiles.md'] }).build,
  false,
  'docs-only commit must skip',
);
assert.equal(
  decideVercelBuild({ files: ['docs/adr/0001-auth-profiles.md'], env: 'preview' }).build,
  false,
  'docs-only preview must skip',
);
assert.equal(
  decideVercelBuild({ files: ['docs/adr/0001-auth-profiles.md'], env: 'production' }).build,
  false,
  'docs-only production must skip to preserve deploy budget',
);
assert.equal(
  decideVercelBuild({ files: ['docs/adr/0001-auth-profiles.md'], gitRef: 'main' }).build,
  false,
  'docs-only main ref must skip when VERCEL_ENV is unset in ignore',
);
assert.equal(
  decideVercelBuild({ files: ['.gitnexus/meta.json', 'AGENTS.md'], gitRef: 'main' }).build,
  false,
  'gitnexus-only main must skip',
);
assert.equal(
  decideVercelBuild({ files: ['.gitnexus/meta.json', 'AGENTS.md'], env: 'production' }).build,
  false,
  'gitnexus-only production must skip',
);
assert.equal(
  decideVercelBuild({ files: [] }).build,
  false,
  'empty first-parent diff (identical trees) must skip',
);
assert.equal(
  decideVercelBuild({ files: [], env: 'production' }).build,
  false,
  'empty production diff must skip',
);
assert.equal(
  decideVercelBuild({ files: null }).build,
  true,
  'unknown parent/diff must fail open and build',
);

const bumpOnly = [
  'package.json',
  'package-lock.json',
  'apps/party-tracker/package.json',
  'packages/shared/package.json',
  'packages/venue-builder/package.json',
  'apps/party-tracker/public/app-version.json',
  'apps/party-tracker/public/sw.js',
  'apps/party-tracker/data/release-notes.json',
];
assert.equal(isVersionStampOnlyChange(bumpOnly), true, 'bump workflow files are stamp-only');
assert.equal(
  decideVercelBuild({ files: bumpOnly, env: 'production', gitRef: 'main' }).build,
  false,
  'post-merge version bump must not trigger a second production deploy',
);

assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'cursor/fix-map-3b75',
    forceBuild: false,
  }).build,
  false,
  'agent preview branch must skip unless forced',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'cursor/fix-map-3b75',
    subject: 'feat: map [vercel build]',
  }).build,
  true,
  '[vercel build] in subject overrides agent preview skip',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
    forceBuild: true,
  }).build,
  true,
  'production forceBuild still builds app changes',
);
assert.equal(isAgentPreviewBranch('worktree-fix-party', 'preview'), true);
assert.equal(isAgentPreviewBranch('main', 'preview'), false);

assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    subject: 'chore: wip [skip vercel]',
  }).build,
  false,
  '[skip vercel] in subject must skip even for app files',
);

// The preview-vs-merge trap: previous-SHA diff is empty, first-parent has app files.
const previousShaFiles = []; // merge tree === last preview
const firstParentFiles = [
  'apps/party-tracker/lib/party/hostService.js',
  'package.json',
];
assert.equal(
  decideVercelBuild({ files: previousShaFiles }).build,
  false,
  'empty previous-SHA diff would skip — do not use it',
);
assert.equal(
  decideVercelBuild({ files: firstParentFiles, env: 'production', forceBuild: true }).build,
  true,
  'first-parent app files must still build production',
);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sh = readFileSync(join(root, 'scripts/vercel-ignore.sh'), 'utf8');
assert.match(sh, /scripts\/lib\/vercel-ignore\.mjs/);

const lib = readFileSync(join(root, 'scripts/lib/vercel-ignore.mjs'), 'utf8');
assert.doesNotMatch(
  lib,
  /VERCEL_GIT_PREVIOUS_SHA/,
  'ignore decision must not diff against the last preview SHA',
);
assert.match(lib, /\^1/, 'must diff against the first parent');
assert.match(lib, /VERSION_STAMP_PATHS/, 'must skip post-merge version bumps');
assert.match(lib, /AGENT_PREVIEW_BRANCH/, 'must skip agent preview branches');

// .vercelignore strips scripts/** — the ignoreCommand chain must be re-included
// or preview deploys fail open and burn the daily preview budget.
const vercelIgnore = readFileSync(join(root, '.vercelignore'), 'utf8');
for (const path of [
  'scripts/vercel-ignore.sh',
  'scripts/lib/vercel-ignore.mjs',
  'scripts/lib/app-paths.mjs',
  'scripts/lib/app-paths.json',
  'scripts/gitnexus-ci.mjs',
]) {
  assert.match(
    vercelIgnore,
    new RegExp(`^!${path.replace(/\./g, '\\.')}$`, 'm'),
    `.vercelignore must keep ${path} for ignoreCommand`,
  );
}

const sw = readFileSync(join(root, 'apps/party-tracker/public/sw.js'), 'utf8');
assert.match(
  sw,
  /const copy = res\.clone\(\);\s*caches\.open\(CACHE\)\.then\(\(c\) => c\.put\(request, copy\)\)/,
  'cacheFirstRevalidate must clone before the page consumes the body',
);
assert.doesNotMatch(
  sw,
  /c\.put\(request, res\.clone\(\)\)/,
  'late res.clone() after respondWith races and throws',
);

console.log('vercel-ignore: ok');
