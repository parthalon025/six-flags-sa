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
import { createHash } from 'node:crypto';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capturedManifestRel,
  mediaFiles,
  mediaRel,
  missingFromReadme,
  refreshedShots,
  shotsNeedingRefresh,
  videosNeedingRefresh,
} from './lib/readme-shots.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(root, 'docs/images/readme/shots.json'), 'utf8'));
const readme = readFileSync(join(root, 'README.md'), 'utf8');
// Capture-freshness manifest (#550): a byte-identical recapture never shows
// in the PNG diff, so `npm run readme:shots` records each capture here and a
// refreshed entry clears the shot. Absent or empty, staleness behaves exactly
// as it did before the manifest existed.
const capturedRel = capturedManifestRel(manifest);
const captured = existsSync(join(root, capturedRel))
  ? JSON.parse(readFileSync(join(root, capturedRel), 'utf8'))
  : {};

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
  const staleVideos = videosNeedingRefresh(['apps/party-tracker/components/ParkMap.jsx'], manifest);
  assert.ok(staleVideos.includes('walkthrough.mp4'), 'ParkMap.jsx must stale the walkthrough video');
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

{
  // #550: a pixel-neutral recapture never lands the PNG in the diff — the
  // refreshed captured.json entry is what clears the shot instead.
  const changed = ['apps/party-tracker/components/ParkMap.jsx', 'docs/images/readme/captured.json'];
  const refreshed = refreshedShots(
    { 'map-day.png': { commit: 'bbb', capturedAt: '2026-08-20T00:00:00Z' } },
    { 'map-day.png': { commit: 'aaa', capturedAt: '2026-08-19T00:00:00Z' } },
  );
  assert.deepEqual(refreshed, ['map-day.png'], 'a rewritten entry marks its shot refreshed');
  const stale = shotsNeedingRefresh(changed, manifest, { refreshed });
  assert.ok(!stale.includes('map-day.png'), 'a refreshed manifest entry clears that shot');
  assert.ok(stale.includes('map-night.png'), 'shots the recapture did not touch stay stale');
}

{
  // A first capture (no base manifest) refreshes; an untouched manifest
  // refreshes nothing — absence behaves exactly as before it existed.
  const entry = { 'party.png': { commit: 'ccc', capturedAt: '2026-08-20T00:00:00Z' } };
  assert.deepEqual(refreshedShots(entry, {}), ['party.png'], 'new entries count as refreshed');
  assert.deepEqual(refreshedShots(entry, entry), [], 'identical entries refresh nothing');
  assert.deepEqual(refreshedShots({}, {}), [], 'empty manifests change nothing');

  // The hash guard: an entry only vouches for pixels it matches. A missing
  // or wrong sha256 (hand-typed row, bad merge) cannot clear the gate.
  const hashed = { 'party.png': { commit: 'ccc', capturedAt: '2026-08-20T00:00:00Z', sha256: 'aa11' } };
  assert.deepEqual(
    refreshedShots(hashed, {}, { hashOf: () => 'aa11' }),
    ['party.png'],
    'a matching on-disk hash clears the shot',
  );
  assert.deepEqual(
    refreshedShots(hashed, {}, { hashOf: () => 'bb22' }),
    [],
    'a drifted on-disk hash refreshes nothing',
  );
  assert.deepEqual(
    refreshedShots(entry, {}, { hashOf: () => 'aa11' }),
    [],
    'an entry with no recorded hash refreshes nothing when verification is on',
  );
  const stale = shotsNeedingRefresh(['apps/party-tracker/components/ParkMap.jsx'], manifest, { refreshed: [] });
  assert.ok(stale.includes('map-day.png'), 'no refreshed entries: staleness is unchanged');
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
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
    });
    changed = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    // Thin clones / no base: existence checks above are enough.
  }
  if (changed.length) {
    // The base ref's copy of captured.json, so a recapture recorded within
    // this branch clears its shot even when the pixels came back identical.
    let capturedBase = {};
    try {
      capturedBase = JSON.parse(execFileSync('git', ['show', `${ref}:${capturedRel}`], {
        cwd: root,
        // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
        env: scrubGitEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'], // "not in <ref>" is an expected answer, not noise
      }));
    } catch {
      // No manifest at the base ref (or thin clone): nothing counts as refreshed.
    }
    // A manifest entry only vouches for the pixels it hashes: hand-typed
    // rows and rows carried over a bad merge fail the on-disk comparison.
    const hashOf = (file) => {
      try {
        return createHash('sha256')
          .update(readFileSync(join(root, mediaRel(manifest, file))))
          .digest('hex');
      } catch {
        return null;
      }
    };
    const stale = shotsNeedingRefresh(changed, manifest, {
      refreshed: refreshedShots(captured, capturedBase, { hashOf }),
    });
    assert.equal(
      stale.length,
      0,
      `README media stale after ${ref} changes (${stale.join(', ')}). Run: npm run readme:shots — `
        + `it refreshes ${capturedRel} too, which clears a byte-identical recapture (#550)`,
    );

    // Videos are best-effort (encoding needs ffmpeg — not guaranteed to be
    // installed, #469), so a stale walkthrough warns instead of failing CI.
    const staleVideos = videosNeedingRefresh(changed, manifest);
    if (staleVideos.length) {
      console.warn(
        `readme-shots-check: warning — README walkthrough stale after ${ref} changes (${staleVideos.join(', ')}). Run: npm run readme:shots`,
      );
    }
  }
}

console.log('readme-shots-check: ok');
