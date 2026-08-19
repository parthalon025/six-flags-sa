#!/usr/bin/env node
/**
 * packages/venue-builder/src/paths.mjs — root computation.
 *
 * Guards two things: the CLI-facing correctness of the exported roots (the
 * `bin/*.mjs` scripts rely on these being right when invoked standalone), and
 * the bundler-safety fix for #490 — the `new URL(relative, import.meta.url)`
 * pattern this module used to compute MONO_ROOT/BUILDER_ROOT is statically
 * intercepted by Turbopack/webpack as an asset reference and fails to
 * resolve once the module is pulled into the Next.js app's bundle graph
 * (apps/party-tracker/app/api/admin/venues/route.js -> venueCompare.js is
 * the route that would pull it in). Regressing back to that pattern breaks
 * `npm run build -w @party-tracker/app` the moment anything on the app side
 * imports this module.
 *
 *   node test/builder/paths.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PASS = [];
const FAIL = [];
const ok = (n) => { PASS.push(n); console.log('  PASS', n); };
const bad = (n, e) => { FAIL.push(`${n} :: ${e}`); console.log('  FAIL', n, '->', e); };

console.log('\nbuilder paths suite\n');

const pathsModule = await import('../../packages/venue-builder/src/paths.mjs');
const {
  APP_ROOT,
  BUILDER_ROOT,
  INDEX_FILE,
  MANIFEST_FILE,
  MONO_ROOT,
  OVERRIDE_DIR,
  ROUTING_COVERAGE_FILE,
  VENUE_DIR,
} = pathsModule;

// --- CLI correctness: the roots must land exactly where the bin/*.mjs
// scripts expect, whether run via `npm run` or invoked directly with `node`.

try {
  assert.equal(
    fs.existsSync(path.join(MONO_ROOT, 'package.json')),
    true,
    `MONO_ROOT (${MONO_ROOT}) should contain the monorepo root package.json`,
  );
  ok('MONO_ROOT resolves to the monorepo root');
} catch (e) { bad('MONO_ROOT resolves to the monorepo root', e.message); }

try {
  assert.equal(
    fs.existsSync(path.join(BUILDER_ROOT, 'package.json')),
    true,
    `BUILDER_ROOT (${BUILDER_ROOT}) should contain the venue-builder package.json`,
  );
  const builderPkg = JSON.parse(fs.readFileSync(path.join(BUILDER_ROOT, 'package.json'), 'utf8'));
  assert.equal(builderPkg.name, '@party-tracker/venue-builder');
  ok('BUILDER_ROOT resolves to packages/venue-builder');
} catch (e) { bad('BUILDER_ROOT resolves to packages/venue-builder', e.message); }

try {
  assert.equal(APP_ROOT, path.join(MONO_ROOT, 'apps', 'party-tracker'));
  assert.equal(fs.existsSync(path.join(APP_ROOT, 'package.json')), true);
  ok('APP_ROOT resolves to apps/party-tracker');
} catch (e) { bad('APP_ROOT resolves to apps/party-tracker', e.message); }

try {
  assert.equal(VENUE_DIR, path.join(APP_ROOT, 'public', 'venues'));
  assert.equal(OVERRIDE_DIR, path.join(BUILDER_ROOT, 'data', 'venues'));
  assert.equal(INDEX_FILE, path.join(APP_ROOT, 'lib', 'venueIndex.js'));
  assert.equal(MANIFEST_FILE, path.join(VENUE_DIR, 'manifest.json'));
  assert.equal(
    ROUTING_COVERAGE_FILE,
    path.join(MONO_ROOT, 'fastlane', 'metadata', 'ios', 'routing_app_coverage.geojson'),
  );
  ok('derived exports stay wired to their declared roots');
} catch (e) { bad('derived exports stay wired to their declared roots', e.message); }

// --- Bundler safety: the exact pattern that broke Turbopack must not come
// back. `new URL('<relative>', import.meta.url)` is statically detected and
// treated as an asset reference by Turbopack/webpack; a directory target
// (not a real file) fails to resolve once this module is bundled.

try {
  const pathsTestDir = path.dirname(fileURLToPath(import.meta.url));
  const pathsModuleSource = fs.readFileSync(
    path.join(pathsTestDir, '..', '..', 'packages', 'venue-builder', 'src', 'paths.mjs'),
    'utf8',
  );
  assert.doesNotMatch(
    pathsModuleSource,
    /new URL\(\s*['"`][^'"`]*['"`]\s*,\s*import\.meta\.url\s*\)/,
    'paths.mjs must not reintroduce new URL(relative, import.meta.url) — it breaks the Turbopack build (#490) once anything on the app side imports this module',
  );
  ok('does not use the bundler-hostile new URL(relative, import.meta.url) pattern');
} catch (e) {
  bad('does not use the bundler-hostile new URL(relative, import.meta.url) pattern', e.message);
}

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
