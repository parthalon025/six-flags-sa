#!/usr/bin/env node
/**
 * README gallery media must exist, be linked from the README, and be recaptured
 * when the screens they show change.
 *
 *   node test/app/readme-shots-check.mjs
 *   node test/app/readme-shots-check.mjs --base origin/main
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mediaFiles,
  missingFromReadme,
  shotsNeedingRefresh,
} from './lib/readme-shots.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/images/readme/shots.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');

assert.ok((manifest.shots || []).length >= 4, 'gallery needs several capability shots');
assert.ok((manifest.videos || []).length >= 1, 'gallery needs a walkthrough video');

for (const rel of mediaFiles(manifest)) {
  assert.equal(existsSync(join(root, rel)), true, `missing ${rel} — run npm run readme:shots`);
}

const unlinked = missingFromReadme(readme, manifest);
assert.equal(unlinked.length, 0, `README must link gallery media: ${unlinked.join(', ')}`);

assert.match(readme, /<table/, 'README gallery should use a two-column table');
assert.match(readme, /walkthrough/i, 'README should include a walkthrough');

{
  const none = shotsNeedingRefresh(['docs/guide/features.md'], manifest);
  assert.equal(none.length, 0, 'docs-only edits do not stale shots');
}

{
  const stale = shotsNeedingRefresh(['apps/party-tracker/components/ParkMap.jsx'], manifest);
  assert.ok(stale.includes('map-day.png'), 'ParkMap.jsx must stale the day map shot');
  assert.ok(stale.includes('walkthrough.mp4'), 'ParkMap.jsx must stale the walkthrough video');
}

{
  const stale = shotsNeedingRefresh(
    ['apps/party-tracker/components/ParkMap.jsx', 'docs/images/readme/map-day.png'],
    manifest,
  );
  assert.ok(!stale.includes('map-day.png'), 'updating the PNG clears that shot');
}

{
  const stale = shotsNeedingRefresh(['test/app/readme-shots.mjs'], manifest);
  assert.ok(stale.length > 0, 'capture-script edits stale every shot until recaptured');
}

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf('--base');
const base = baseIdx >= 0 ? argv[baseIdx + 1] : '';
if (base) {
  const ref = base.startsWith('origin/') ? base : `origin/${base}`;
  let changed = [];
  try {
    const out = execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], {
      cwd: root,
      encoding: 'utf8',
    });
    changed = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    // Thin clones / no base: existence checks above are enough.
  }
  if (changed.length) {
    const stale = shotsNeedingRefresh(changed, manifest);
    assert.equal(
      stale.length,
      0,
      `README media stale after ${ref} changes (${stale.join(', ')}). Run: npm run readme:shots`,
    );
  }
}

console.log('readme-shots-check: ok');
