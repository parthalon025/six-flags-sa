#!/usr/bin/env node
/**
 * Exported-entry-point discovery for dependency-cruiser — unit + live repo.
 *
 *   node test/scripts/dependency-boundaries.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  escapeRegExpPath,
  exportTargetLeaves,
  exportedEntryPointPatterns,
} from '../../scripts/lib/dependency-boundaries.cjs';

// escapeRegExpPath — dots and regex specials must not stay live.
assert.equal(escapeRegExpPath('a.b/c+d'), 'a\\.b/c\\+d');
assert.ok(new RegExp(`^${escapeRegExpPath('src/compare.mjs')}$`).test('src/compare.mjs'));
assert.ok(!new RegExp(`^${escapeRegExpPath('src/compare.mjs')}$`).test('src/compareXmjs'), 'dot does not match any char');

// exportTargetLeaves — plain strings, conditional objects, ./ stripping.
assert.deepEqual(
  exportTargetLeaves({
    './a.js': './src/a.mjs',
    '.': { import: './index.mjs', require: './index.cjs' },
    './weird': { types: 42 },
  }),
  ['src/a.mjs', 'index.mjs', 'index.cjs'],
);
assert.deepEqual(exportTargetLeaves(undefined), [], 'missing exports map yields none');

// exportedEntryPointPatterns — fixture packages on disk.
{
  const dir = mkdtempSync(join(tmpdir(), 'dep-bounds-'));
  mkdirSync(join(dir, 'pkgs/alpha'), { recursive: true });
  mkdirSync(join(dir, 'pkgs/no-manifest'), { recursive: true });
  writeFileSync(
    join(dir, 'pkgs/alpha/package.json'),
    JSON.stringify({ exports: { './x.js': './sub/x.mjs' } }),
  );
  const patterns = exportedEntryPointPatterns(join(dir, 'pkgs'));
  assert.equal(patterns.length, 1, 'dir without package.json is skipped');
  assert.ok(
    new RegExp(patterns[0]).test(join(dir, 'pkgs') + '/alpha/sub/x.mjs'),
    'subfolder export target matches its own path',
  );
  rmSync(dir, { recursive: true, force: true });
}

// Live repo — the documented venue-builder exports are entry points.
{
  const patterns = exportedEntryPointPatterns('packages');
  const matches = (p) => patterns.some((re) => new RegExp(re).test(p));
  assert.ok(matches('packages/venue-builder/src/compare.mjs'), 'compare.mjs is public');
  assert.ok(matches('packages/venue-builder/src/routing-coverage.mjs'), 'routing-coverage.mjs is public');
  assert.ok(!matches('packages/venue-builder/lib/consolidate.mjs'), 'lib internals stay private');
}

console.log('dependency-boundaries: ok');
