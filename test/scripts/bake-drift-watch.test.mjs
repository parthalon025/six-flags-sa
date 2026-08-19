#!/usr/bin/env node
/**
 * Bake-certification drift watch — CLI --help/-h short-circuit, plus the
 * drift rule itself against a manufactured staleness case (#509).
 *
 * The CLI's full path re-bakes with Chromium (bin/display-bake.mjs) — too
 * slow and too heavy a dependency for this gate. What's fast to prove, and
 * what actually decides "stale or not", is `driftedBakes` in
 * src/bake-drift.mjs (public entry point `@party-tracker/venue-builder/bake-drift.js`):
 * given a committed signature set and a fresh one, does
 * it flag a mismatch and stay quiet when nothing moved? A real re-bake
 * feeding it real signatures is exercised by `npm run venues:bake-drift-watch`
 * in the weekly workflow (.github/workflows/drift-watch.yml), the same split
 * `drift-watch.mjs` itself uses (--help here, the real rebuild in CI).
 *
 *   node test/scripts/bake-drift-watch.test.mjs
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'packages/venue-builder/bin/bake-drift-watch.mjs');

for (const flag of ['--help', '-h']) {
  const res = spawnSync(process.execPath, [script, flag], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, `${flag} exits 0 (stderr: ${res.stderr})`);
  assert.match(res.stdout, /Bake-certification drift watch/, `${flag} prints the usage banner`);
  assert.match(
    res.stdout,
    /npm run venues:bake-drift-watch/,
    `${flag} shows the npm invocation`,
  );
  // --help must short-circuit before the manifest read / any re-bake — no
  // drift summary line should ever appear alongside the usage text.
  assert.doesNotMatch(
    res.stdout,
    /kit\(s\) drifted/,
    `${flag} does not run the drift check`,
  );
}

const { driftedBakes } = await import('@party-tracker/venue-builder/bake-drift.js');

// A manufactured staleness case: the committed row is exactly what a bake
// produced at some past commit; "fresh" stands in for a re-bake against
// today's kit/profile/compositor. Mutating one signature input (here, the
// fresh signature itself — same effect as a kit or profile edit changing
// what the compositor paints) must be caught, and an unchanged bake must
// pass cleanly.
const committed = {
  'island-brochure': { certified: true, signature: 'fad770c5' },
  'rpg-overworld': { certified: true, signature: '5d5acc6c' },
};

const clean = driftedBakes('big-kahunas', committed, {
  'island-brochure': { certified: true, signature: 'fad770c5' },
  'rpg-overworld': { certified: true, signature: '5d5acc6c' },
});
assert.deepEqual(clean, [], 'a bake matching the committed signatures reports no drift');

const stale = driftedBakes('big-kahunas', committed, {
  'island-brochure': { certified: true, signature: 'fad770c5' },
  // A reference-profile or compositor change that repaints even one pixel
  // changes this signature — the exact staleness #509 asks to be caught.
  'rpg-overworld': { certified: true, signature: 'deadbeef' },
});
assert.equal(stale.length, 1, 'exactly the mutated kit is flagged');
assert.equal(stale[0].venue, 'big-kahunas');
assert.equal(stale[0].kit, 'rpg-overworld');
assert.equal(stale[0].committedSignature, '5d5acc6c');
assert.equal(stale[0].freshSignature, 'deadbeef');

const untracked = driftedBakes('big-kahunas', committed, {
  'midnight-carnival': { certified: true, signature: '8cbc7b75' },
});
assert.equal(untracked.length, 1, 'a freshly-baked kit with no committed row is flagged, not ignored');
assert.equal(untracked[0].committedSignature, null);

console.log('ok bake-drift-watch --help/-h, driftedBakes flags a manufactured mismatch and stays clean otherwise');
