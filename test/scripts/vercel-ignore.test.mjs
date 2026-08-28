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
  applyLiveAutomationGate,
  applyProductionRedisGuard,
  applyProductionPostgresGuard,
} from '../../scripts/lib/vercel-ignore.mjs';
import { isVersionStampOnlyChange } from '../../scripts/lib/version-stamp.mjs';
import {
  AUTOMATION_DEPLOY_BUDGET,
  USER_DEPLOY_RESERVE,
} from '../../scripts/lib/vercel-budget.mjs';

assert.equal(
  decideVercelBuild({ files: ['apps/party-tracker/lib/party/hostService.js'] }).build,
  true,
  'app file vs first parent must build on production default',
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
  true,
  'post-merge version bump must deploy production (merge build is cancelled by the bump push)',
);
assert.equal(
  decideVercelBuild({ files: bumpOnly, env: 'preview', gitRef: 'main' }).build,
  false,
  'post-merge version bump must skip preview',
);

assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'cursor/fix-map-3b75',
  }).build,
  false,
  'agent preview branch must skip unless user-directed',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'feat/my-human-branch',
  }).build,
  false,
  'human preview branch must skip unless user-directed',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'cursor/fix-map-3b75',
    subject: 'feat: map [vercel build]',
  }).build,
  true,
  '[vercel build] in subject is user-directed',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'feat/my-branch',
    userBuild: '1',
  }).build,
  true,
  'VERCEL_USER_BUILD=1 is user-directed',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
  }).build,
  true,
  'production app changes use automation budget without user directive',
);
// files == null (unreadable diff) must NOT fail open for an agent preview
// branch — isAgentPreviewBranch must be checked before the files == null
// branch, or every claude/worktree-/cursor/ push whose diff can't be read
// builds a preview and burns the 100/day account budget.
assert.equal(
  decideVercelBuild({ files: null, gitRef: 'claude/foo', env: 'preview' }).build,
  false,
  'agent preview branch must skip even when the diff is unreadable',
);
assert.equal(
  decideVercelBuild({ files: null, gitRef: 'claude/foo', env: 'preview' }).category,
  'skip-agent-preview',
  'unreadable-diff agent preview skip must report skip-agent-preview',
);
assert.equal(
  decideVercelBuild({
    files: null,
    gitRef: 'claude/foo',
    env: 'preview',
    subject: 'feat: map [vercel build]',
  }).build,
  true,
  'a user-directed build on an agent branch must still win, even with an unreadable diff',
);

assert.equal(isAgentPreviewBranch('worktree-fix-party', 'preview'), true);
/* Claude Code agent branches are `claude/<slug>`, the prefix its harness mandates.
   They were absent from AGENT_PREVIEW_BRANCH while the policy said agents must not
   push branches hoping for a preview — so every agent push built one and drew from
   the 100/day account budget, the opposite of what vercel-previews.md promises. */
assert.equal(isAgentPreviewBranch('claude/factory-development-status-cc21re', 'preview'), true);
assert.equal(isAgentPreviewBranch('claude/anything', 'preview'), true);
// Not a blanket match: a real branch that merely contains the word must still build.
assert.equal(isAgentPreviewBranch('feat/claude-integration', 'preview'), false);
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
  decideVercelBuild({ files: firstParentFiles, env: 'production', gitRef: 'main' }).build,
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
assert.match(lib, /version-stamp\.mjs/, 'must treat post-merge version bumps via shared stamp list');
assert.match(lib, /bump push cancels the merge deploy/, 'production stamp bumps must deploy after merge cancel');
assert.match(lib, /AGENT_PREVIEW_BRANCH/, 'must skip agent preview branches');
assert.match(lib, /USER_DEPLOY_RESERVE/, 'must document user reserve');
assert.equal(USER_DEPLOY_RESERVE, 25);
assert.equal(AUTOMATION_DEPLOY_BUDGET, 75);

// .vercelignore strips scripts/** — the ignoreCommand chain must be re-included
// or preview deploys fail open and burn the daily preview budget.
const vercelIgnore = readFileSync(join(root, '.vercelignore'), 'utf8');
for (const path of [
  'scripts/vercel-ignore.sh',
  'scripts/lib/vercel-ignore.mjs',
  'scripts/lib/vercel-budget.mjs',
  'scripts/lib/vercel-deploy-gate.mjs',
  'scripts/lib/production-redis-guard.mjs',
  'scripts/lib/version-stamp.mjs',
  'scripts/lib/version-stamp-paths.json',
  'scripts/lib/repo-path.mjs',
  'scripts/lib/app-paths.mjs',
  'scripts/lib/app-paths.json',
  'scripts/lib/gitnexus-only.mjs',
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

// Only the automation-production category is subject to the live stepped gate.
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
  }).category,
  'automation-production',
  'production app change without a marker is the automation category',
);
assert.equal(
  decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    gitRef: 'feat/my-branch',
    subject: 'feat: map [vercel build]',
  }).category,
  'user-directed',
  'user-directed builds never enter the automation category',
);
{
  const userDecision = decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'preview',
    subject: 'feat: map [vercel build]',
  });
  const gated = await applyLiveAutomationGate(userDecision);
  assert.equal(gated, userDecision, 'non-automation decisions pass through the live gate untouched');
}
{
  const skipDecision = decideVercelBuild({ files: [] });
  const gated = await applyLiveAutomationGate(skipDecision);
  assert.equal(gated, skipDecision, 'a skip decision is never re-checked against the live gate');
}
{
  // A 'warn' tier still builds but must surface the warning as the logged reason —
  // otherwise the "60-90%: builds, logs a warning" promise in the policy doc is a no-op.
  const automationDecision = decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
  });
  const gated = await applyLiveAutomationGate(automationDecision, {
    token: 't',
    projectId: 'p',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        deployments: Array.from({ length: 50 }, (_, i) => ({
          createdAt: Date.UTC(2026, 0, 1) + i,
          meta: { githubCommitMessage: 'feat: merge' },
        })),
      }),
    }),
    now: new Date(Date.UTC(2026, 0, 1, 12)),
  });
  assert.equal(gated.build, true);
  assert.equal(gated.liveGate.tier, 'warn');
  assert.match(gated.reason, /approaching the cap/, 'warn-tier reason must reach the logged decision');
}
{
  const prodBuild = decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
  });
  const blocked = applyProductionRedisGuard(prodBuild, 'production', {
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: '',
    UPSTASH_REDIS_REST_TOKEN: '',
  });
  assert.equal(blocked.build, false);
  assert.equal(blocked.category, 'production-redis-missing');
  assert.match(blocked.reason, /Redis/);
  const allowed = applyProductionRedisGuard(prodBuild, 'production', {
    NODE_ENV: 'production',
    UPSTASH_REDIS_REST_URL: 'https://x.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'tok',
  });
  assert.equal(allowed.build, true);
}
{
  const prodBuild = decideVercelBuild({
    files: ['apps/party-tracker/lib/party/hostService.js'],
    env: 'production',
    gitRef: 'main',
  });
  const blocked = applyProductionPostgresGuard(prodBuild, 'production', {
    NODE_ENV: 'production',
    DATABASE_URL: '',
  });
  assert.equal(blocked.build, false);
  assert.equal(blocked.category, 'production-postgres-missing');
  assert.match(blocked.reason, /DATABASE_URL/);
  const allowed = applyProductionPostgresGuard(prodBuild, 'production', {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:pass@host/db',
  });
  assert.equal(allowed.build, true);
}

console.log('vercel-ignore: ok');
