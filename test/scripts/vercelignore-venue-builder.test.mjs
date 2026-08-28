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
 * The must-upload set is not a hand-typed list — a hardcoded list silently
 * drifts the next time someone adds an import (that is exactly how
 * lib/ambient-signal-seeds.mjs got missed once already: it is imported by
 * lib/quest-seeds.mjs and lib/ship-gaps.mjs, both of which WERE on the
 * hand-typed list, but the file they import was not). Instead this computes
 * the real transitive import closure — via computeImportClosure()
 * (scripts/lib/import-closure.mjs), which follows every relative
 * import/export/dynamic-import()/require() — from the entry points below,
 * and asserts every file it finds is not ignored.
 *
 * ENTRY_POINTS:
 *   - lib/delivery/index.mjs, src/paths.mjs — the two subpaths
 *     apps/party-tracker actually imports (see
 *     apps/party-tracker/app/api/venues/[venueId]/bundle/route.js and
 *     apps/party-tracker/lib/venueCompare.js). Real runtime need.
 *   - lib/venue-report-gate.mjs — exported in package.json's `exports` map
 *     (./venue-report-gate.js) but not reachable from the two entries above,
 *     and nothing in apps/party-tracker imports it today (only bin/ CLI
 *     scripts and tests do, and those stay excluded independently). Kept
 *     uploaded for exports-map parity, not runtime need.
 *
 * This asserts the DECISION `git check-ignore` makes over the real
 * `.vercelignore`, against a fixture git repo (so it also catches a future
 * edit that reintroduces the same excluded-parent trap) — not just that some
 * command exits zero.
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
import { computeImportClosure } from '../../scripts/lib/import-closure.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Entries as repo-root-relative paths (not package-relative): the closure
// can legitimately reach outside packages/venue-builder — venue-report-gate.mjs
// reaches into apps/party-tracker/lib/venue/ids.js — and repo-root-relative
// paths are what .vercelignore patterns (and git check-ignore) key on, so
// nothing needs re-prefixing (and mis-prefixing) after the trace.
const REAL_ENTRIES = [
  'packages/venue-builder/lib/delivery/index.mjs',
  'packages/venue-builder/src/paths.mjs',
];
const EXTRA_ENTRIES = ['packages/venue-builder/lib/venue-report-gate.mjs'];

const closure = computeImportClosure({ root, entries: [...REAL_ENTRIES, ...EXTRA_ENTRIES] });

assert.deepEqual(
  closure.unresolved,
  [],
  `import-closure trace found unresolved relative imports (broken source, or the tracer needs a fix): ${closure.unresolved.join(', ')}`,
);

// package.json is never imported by JS, but npm workspaces needs it on disk
// to resolve the package at all.
const MUST_UPLOAD = ['packages/venue-builder/package.json', ...closure.files];

// Never needed at runtime by the deployed app — must stay out of the upload
// so it stays lean. lib/adapters, lib/map-factory and lib/visual-factory are
// large factory trees; only the thin seams the closure above pulls in are
// needed, so the rest of each directory must stay excluded.
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
      `.vercelignore must upload ${path} — reached by the real import closure of ${[...REAL_ENTRIES, ...EXTRA_ENTRIES].join(', ')}`,
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

console.log(`vercelignore-venue-builder: ok (${MUST_UPLOAD.length} must-upload files derived from the import closure)`);
