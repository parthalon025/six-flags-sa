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
import { decideVercelBuild } from '../../scripts/lib/vercel-ignore.mjs';

assert.equal(
  decideVercelBuild({ files: ['apps/party-tracker/lib/party/hostService.js'] }).build,
  true,
  'app file vs first parent must build',
);
assert.equal(
  decideVercelBuild({ files: ['package.json'] }).build,
  true,
  'root package.json is an app path',
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
  true,
  'docs-only production must still build so the live alias tracks main',
);
assert.equal(
  decideVercelBuild({ files: ['docs/adr/0001-auth-profiles.md'], gitRef: 'main' }).build,
  true,
  'docs-only main ref must build when VERCEL_ENV is unset in ignore',
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
  'empty first-parent diff (identical trees) must skip only when that IS this commit',
);
assert.equal(
  decideVercelBuild({ files: [], env: 'production' }).build,
  false,
  'empty production diff must still skip',
);
assert.equal(
  decideVercelBuild({ files: null }).build,
  true,
  'unknown parent/diff must fail open and build',
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
  decideVercelBuild({ files: firstParentFiles }).build,
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
assert.match(lib, /VERCEL_ENV/, 'production env must participate in the ignore decision');
assert.match(lib, /VERCEL_GIT_COMMIT_REF/, 'main ref must participate when env is unset');

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
