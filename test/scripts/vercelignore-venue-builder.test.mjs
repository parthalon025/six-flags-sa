#!/usr/bin/env node
/**
 * .vercelignore must upload the venue-builder files the deployed app actually
 * imports, and must keep the rest of that (large) package excluded.
 *
 * `packages/venue-builder/**` at the top of the old block excluded the whole
 * package, then tried to re-include files under it with patterns like
 * `!packages/venue-builder/lib/delivery/**`. Gitignore/vercelignore semantics
 * forbid re-including a path whose PARENT directory is already excluded — the
 * negation never took effect, `lib/delivery/index.mjs` never uploaded, and
 * every Vercel build died with "Module not found: Can't resolve
 * '@party-tracker/venue-builder/delivery.js'" (#706, commit 640f4e8 hit this
 * same wall by adding more negations under the same excluded parent).
 *
 * This asserts the DECISION `git check-ignore` makes over the real
 * `.vercelignore`, against a fixture git repo (so it also catches a future
 * edit that reintroduces the same excluded-parent trap) — not just that some
 * command exits zero.
 *
 * The must-upload list here is the real transitive import closure of
 * `@party-tracker/venue-builder/delivery.js` and `/paths.js` (the two
 * subpaths `apps/party-tracker` actually imports — see
 * apps/party-tracker/app/api/venues/[venueId]/bundle/route.js and
 * apps/party-tracker/lib/venueCompare.js), traced by following every
 * relative import/export/dynamic-import starting at
 * packages/venue-builder/lib/delivery/index.mjs and
 * packages/venue-builder/src/paths.mjs. Also included:
 * lib/venue-report-gate.mjs and the three files only it needs
 * (venue-checklist.mjs, venue-recipe.mjs, venue-ids.mjs) — that subpath is
 * exported in packages/venue-builder/package.json's `exports` map but wasn't
 * reachable from delivery.js/paths.js, so it stays here for exports-map
 * parity even though nothing in apps/party-tracker imports it today (only
 * bin/ CLI scripts and tests do, and those stay excluded independently).
 *
 *   node test/scripts/vercelignore-venue-builder.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Real transitive import closure of delivery.js + paths.js, plus the
// venue-report-gate.js exports-map subpath (see file header).
const MUST_UPLOAD = [
  'packages/venue-builder/package.json',
  'packages/venue-builder/lib/delivery/index.mjs',
  'packages/venue-builder/lib/delivery/publish-bundle.mjs',
  'packages/venue-builder/lib/delivery/export-from-postdb.mjs',
  'packages/venue-builder/lib/delivery/delta-sync.mjs',
  'packages/venue-builder/lib/delivery/resolve-sync-manifest.mjs',
  'packages/venue-builder/lib/delivery/freshness.mjs',
  'packages/venue-builder/lib/delivery/builder-app-contract.mjs',
  'packages/venue-builder/lib/delivery/delivery-io.mjs',
  'packages/venue-builder/lib/db/postgres.mjs',
  'packages/venue-builder/lib/postdb-io.mjs',
  'packages/venue-builder/lib/venue-io.mjs',
  'packages/venue-builder/lib/venue-bundle.mjs',
  'packages/venue-builder/lib/evidence.mjs',
  'packages/venue-builder/lib/imagery-claims.mjs',
  'packages/venue-builder/lib/quest-seeds.mjs',
  'packages/venue-builder/lib/ship-gaps.mjs',
  'packages/venue-builder/lib/venue-fs.mjs',
  'packages/venue-builder/lib/venue-sources.mjs',
  'packages/venue-builder/lib/evidence-graph.mjs',
  'packages/venue-builder/lib/factory-types.mjs',
  'packages/venue-builder/lib/postdb-seed-from-files.mjs',
  'packages/venue-builder/lib/adapters/_cache.mjs',
  'packages/venue-builder/lib/map-factory/map-io.mjs',
  'packages/venue-builder/lib/map-factory/postdb-sync.mjs',
  'packages/venue-builder/lib/visual-factory/postdb-sync.mjs',
  'packages/venue-builder/lib/venue-report-gate.mjs',
  'packages/venue-builder/lib/venue-checklist.mjs',
  'packages/venue-builder/lib/venue-recipe.mjs',
  'packages/venue-builder/lib/venue-ids.mjs',
  'packages/venue-builder/src/paths.mjs',
  'packages/venue-builder/src/routing-coverage.mjs',
];

// Never needed at runtime by the deployed app — must stay out of the upload
// so it stays lean. lib/adapters, lib/map-factory and lib/visual-factory are
// large factory trees; only the thin seams above (an index.mjs each) are
// pulled in, so the rest of each directory must stay excluded too.
const MUST_STAY_EXCLUDED = [
  'packages/venue-builder/data/whatever.json',
  'packages/venue-builder/bin/build-venue.mjs',
  'packages/venue-builder/bin/attractions.mjs',
  'packages/venue-builder/lib/map-factory/index.mjs',
  'packages/venue-builder/lib/visual-factory/index.mjs',
  'packages/venue-builder/lib/build-pipeline.mjs',
  'packages/venue-builder/src/compare.mjs',
  'packages/venue-builder/src/bake-drift.mjs',
];

// The exact failure this fix repairs — kept as its own headline assertion.
const HEADLINE_FILE = 'packages/venue-builder/lib/delivery/index.mjs';

function gitCheckIgnore(cwd, path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd, env: scrubGitEnv() });
    return true; // exit 0 => ignored
  } catch (err) {
    if (err.status === 1) return false; // not ignored
    throw err; // exit >1 => fatal (bad pattern etc.)
  }
}

const vercelIgnore = readFileSync(join(root, '.vercelignore'), 'utf8');

const fixture = mkdtempSync(join(tmpdir(), 'vercelignore-venue-builder-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: fixture, env: scrubGitEnv() });
  // .vercelignore uses the same pattern syntax as .gitignore (documented Vercel
  // behavior) — check-ignore only reads files literally named .gitignore.
  writeFileSync(join(fixture, '.gitignore'), vercelIgnore);

  for (const path of MUST_UPLOAD) {
    assert.equal(
      gitCheckIgnore(fixture, path),
      false,
      `.vercelignore must upload ${path} (delivery.js's real import closure needs it)`,
    );
  }
  for (const path of MUST_STAY_EXCLUDED) {
    assert.equal(
      gitCheckIgnore(fixture, path),
      true,
      `.vercelignore must keep ${path} excluded — the venue-builder upload must stay lean`,
    );
  }
  assert.equal(
    gitCheckIgnore(fixture, HEADLINE_FILE),
    false,
    `${HEADLINE_FILE} must upload — this exact file is what "Module not found: ` +
      `Can't resolve '@party-tracker/venue-builder/delivery.js'" could not resolve`,
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// Guard the failure mode itself: a bare `packages/venue-builder/**` (or any
// `lib/**`/`src/**` under it) exclude is exactly what breaks re-inclusion of
// anything nested below it — assert the block instead excludes one directory
// LEVEL at a time (`lib/*`, not `lib/**`).
assert.doesNotMatch(
  vercelIgnore,
  /^packages\/venue-builder\/\*\*$/m,
  'packages/venue-builder/** excludes the whole subtree — negations below it silently no-op (the #706 bug)',
);
assert.doesNotMatch(
  vercelIgnore,
  /^packages\/venue-builder\/lib\/\*\*$/m,
  'packages/venue-builder/lib/** excludes the whole lib subtree — negations below it silently no-op',
);
assert.match(
  vercelIgnore,
  /^packages\/venue-builder\/\*$/m,
  'must exclude venue-builder one level at a time so nested re-includes actually apply',
);

console.log('vercelignore-venue-builder: ok');
