#!/usr/bin/env node
/**
 * Conventional Commits version bump: kind, digit, and app-path skip.
 *
 *   node test/scripts/bump-version.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bumpPatchVersion,
  bumpVersion,
  releaseKindFromMessages,
} from '../../apps/party-tracker/lib/version.js';
import { isAppChange, loadAppPaths } from '../../scripts/lib/app-paths.mjs';
import { decideBump } from '../../scripts/lib/release-bump.mjs';

assert.equal(releaseKindFromMessages(['feat: add party Plan reordering']), 'minor');
assert.equal(releaseKindFromMessages(['feat(plan): add reordering']), 'minor');
assert.equal(releaseKindFromMessages(['fix: grandma arrive uses closeGate']), 'patch');
assert.equal(releaseKindFromMessages(['fix(test): grandma ignore Vercel 404s']), 'patch');
assert.equal(releaseKindFromMessages(['feat!: change party wire handshake']), 'major');
assert.equal(releaseKindFromMessages(['fix(api)!: drop old invite token']), 'major');
assert.equal(
  releaseKindFromMessages(['fix: typo\n\nBREAKING CHANGE: party wire handshake changed']),
  'major',
);

assert.equal(releaseKindFromMessages(['feat: add Plan', 'fix: typo']), 'minor');
assert.equal(releaseKindFromMessages(['docs: update CONTEXT.md']), 'none');
assert.equal(releaseKindFromMessages(['chore: lock skills']), 'none');
assert.equal(releaseKindFromMessages(['test: add restroom identity check']), 'none');
assert.equal(releaseKindFromMessages(['refactor: extract ids']), 'none');
assert.equal(releaseKindFromMessages(['perf: map node budget']), 'none');
assert.equal(releaseKindFromMessages(['ci: skip gitnexus-only']), 'none');
assert.equal(releaseKindFromMessages(['style: format']), 'none');

assert.equal(
  releaseKindFromMessages(['Fix main CI: restore bump-version script. (#101)']),
  'patch',
);
assert.equal(
  releaseKindFromMessages(['Merge pull request #105 from parthalon025/feat/align-context-domain']),
  'patch',
);
assert.equal(releaseKindFromMessages(['chore: bump version to 1.1.19']), 'none');
assert.equal(
  releaseKindFromMessages([
    'Merge pull request #1 from x/y',
    'docs: only the title is conventional',
  ]),
  'none',
);

assert.equal(bumpVersion('1.1.16', 'patch'), '1.1.17');
assert.equal(bumpVersion('1.1.16', 'minor'), '1.2.0');
assert.equal(bumpVersion('1.1.16', 'major'), '2.0.0');
assert.equal(bumpVersion('1.1.16', 'none'), '1.1.16');
assert.equal(bumpVersion('2.0.9', 'patch'), '2.0.10');
assert.equal(bumpPatchVersion('1.1.0'), '1.1.1');
assert.equal(bumpVersion('not-semver', 'patch'), '0.0.1');

const paths = loadAppPaths();
assert.equal(isAppChange(['docs/foo.md'], paths), false);
assert.equal(isAppChange(['apps/party-tracker/lib/x.js'], paths), true);
assert.equal(isAppChange(['data/venues/ki.overrides.json'], paths), false);
assert.equal(isAppChange(['public/venues/ki.map.json'], paths), true);
assert.equal(isAppChange(['packages/shared/index.js'], paths), true);
assert.equal(isAppChange(['scripts/build-venue.mjs'], paths), false);
assert.equal(isAppChange(['docs/foo.md', 'apps/party-tracker/lib/x.js'], paths), true);

assert.equal(
  decideBump(['docs/CONTEXT.md'], ['feat: pretend this is a feature']).skip,
  true,
);
assert.equal(
  decideBump(['apps/party-tracker/lib/x.js'], ['docs: comment only']).skip,
  true,
);
assert.equal(
  decideBump(['apps/party-tracker/lib/x.js'], ['feat: add Plan']).kind,
  'minor',
);
assert.equal(
  decideBump(['apps/party-tracker/lib/x.js'], ['Untagged sentence title']).kind,
  'patch',
);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ignore = readFileSync(join(root, 'scripts/vercel-ignore.sh'), 'utf8');
assert.match(ignore, /scripts\/lib\/app-paths\.json/);

const bumpYml = readFileSync(join(root, '.github/workflows/bump-version.yml'), 'utf8');
assert.match(bumpYml, /steps\.bump\.outputs\.skipped/);
assert.match(bumpYml, /fetch-depth:\s*0/);

console.log('bump-version tests: ok');
