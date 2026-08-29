#!/usr/bin/env node
/**
 * CI stamp files are regenerated on every branch, so any two branches always
 * conflict on them in a merge — pure noise: `shouldSkipGithubCi` rejects a
 * stamp whose diffHash differs from the merged tree ("full CI will run"), and
 * a stale matt-review stamp fails the PR, so auto-resolving to "ours" cannot
 * weaken either gate. `.gitattributes` routes that conflict to a custom merge
 * driver instead of leaving it for a human, and `prepare` registers the
 * driver locally (git does not read a driver's name from `.gitattributes`
 * itself — `merge.<name>.driver` has to be configured, or git falls back to
 * a normal conflict, i.e. today's behaviour, so an unregistered driver can
 * only be a no-op, never a regression).
 *
 *   node test/scripts/gitattributes-ci-stamps.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const gitattributes = readFileSync(join(root, '.gitattributes'), 'utf8');
for (const path of ['scripts/ci/local-ci-pass.json', 'scripts/ci/matt-review-pass.json']) {
  assert.match(
    gitattributes,
    new RegExp(`^${path.replace(/\./g, '\\.')}\\s+merge=keep-ours$`, 'm'),
    `.gitattributes must route ${path} through the keep-ours merge driver`,
  );
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.match(
  pkg.scripts.prepare,
  /husky/,
  'prepare must still run husky (pre-push hook install)',
);
assert.match(
  pkg.scripts.prepare,
  /git config core\.hooksPath \.husky/,
  'prepare must point core.hooksPath at tracked .husky scripts, not husky\'s generated .husky/_ shims',
);
assert.match(
  pkg.scripts.prepare,
  /git config merge\.keep-ours\.driver true/,
  'prepare must register the keep-ours merge driver, or .gitattributes has nothing to point at on a fresh clone',
);
assert.match(
  pkg.scripts.prepare,
  /git config merge\.keep-ours\.driver true\s*\|\|\s*true/,
  'the git-config step must not fail `npm install` outside a git repo (e.g. installing from a tarball)',
);

console.log('gitattributes-ci-stamps: ok');
