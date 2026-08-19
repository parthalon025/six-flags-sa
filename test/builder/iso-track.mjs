#!/usr/bin/env node
/**
 * Coaster segment vocabulary + iso variants in the asset ledger —
 * template-driven lift params, target filtering, pinned iso art.
 *
 *   node test/builder/iso-track.mjs
 */
import assert from 'node:assert/strict';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\niso track segments\n');

const { trackSegments, segmentStats } = await import('../../packages/shared/isoTrack.js');

const longLine = [];
for (let x = 0; x <= 176; x += 4) longLine.push([x, 0]);

await check('template lift params flow through — rct-classic vs override move boundaries', () => {
  const classic = trackSegments(longLine, { template: 'rct-classic' });
  assert.ok(classic.some((s) => s.kind === 'climb'), 'rct-classic amp 9 climbs');
  assert.deepEqual(classic, trackSegments(longLine), 'rct-classic is the default template');
  const gentle = trackSegments(longLine, { template: { id: 'gentle', coasterHeightAmp: 2 } });
  assert.deepEqual(gentle.map((s) => s.kind), ['flat'], 'amp 2 never beats the grade threshold');
  assert.notDeepEqual(classic.map((s) => s.fromM), gentle.map((s) => s.fromM), 'boundaries moved');
  return true;
});

await check('explicit opts win over the template, the assembleIsoMeshes way', () => {
  const flattened = trackSegments(longLine, { template: 'rct-classic', heightAmp: 0 });
  assert.deepEqual(flattened.map((s) => s.kind), ['flat'], 'explicit heightAmp 0 beats the template');
  assert.equal(flattened[0].rise, 0);
  const stats = segmentStats(flattened);
  assert.equal(stats.total, 1);
  assert.ok(Math.abs(stats.lengthM - 176) < 0.05);
  return true;
});

console.log('\niso variants in the asset ledger\n');

const {
  ASSET_TARGETS,
  assetPath,
  assetsForTarget,
  readAssetLedger,
  verifyAssetHashes,
} = await import('../../packages/venue-builder/lib/display-assets.mjs');

await check('the ledger validates with the iso entry aboard', () => {
  const ledger = readAssetLedger();
  assert.ok(ledger['parkbound-palm-tree-iso'], 'iso palm rides the ledger');
  assert.equal(ledger['parkbound-palm-tree-iso'].target, 'iso');
  assert.deepEqual(verifyAssetHashes(ledger), [], 'license + source + pin + target all green');
  return true;
});

await check('assetsForTarget splits the tiers; default readers see the flat set', () => {
  const ledger = readAssetLedger();
  const iso = assetsForTarget(ledger, 'iso');
  assert.deepEqual(Object.keys(iso), ['parkbound-palm-tree-iso'], 'exactly the iso set');
  const flat = assetsForTarget(ledger);
  assert.ok(!flat['parkbound-palm-tree-iso'], 'iso art never leaks into the flat tier');
  assert.ok(flat['parkbound-palm-tree'], 'flat sibling stays');
  assert.ok(flat['parkbound-badge-gate'], 'a null target still serves the flat tier');
  assert.equal(Object.keys(flat).length, Object.keys(ledger).length - Object.keys(iso).length);
  return true;
});

await check('an unknown target fails loudly, row or argument', () => {
  const ledger = readAssetLedger();
  const row = ledger['parkbound-palm-tree-iso'];
  const tainted = { 'bad-target': { ...row, target: 'isometric' } };
  assert.throws(() => assetsForTarget(tainted, 'iso'), /target "isometric"/);
  assert.ok(
    verifyAssetHashes(tainted).some((p) => /target "isometric"/.test(p)),
    'the pin gate reports it too',
  );
  assert.throws(() => assetsForTarget(ledger, 'isometric'), /Unknown render target/);
  assert.deepEqual(ASSET_TARGETS, ['flat', 'iso']);
  return true;
});

await check('the iso SVG pin verifies the way vendor-assets does', async () => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  const ledger = readAssetLedger();
  const row = ledger['parkbound-palm-tree-iso'];
  const sha = createHash('sha256').update(readFileSync(assetPath(row))).digest('hex');
  assert.equal(sha, row.sha256, 'committed bytes match the pin');
  const problems = verifyAssetHashes({ 'parkbound-palm-tree-iso': row });
  assert.deepEqual(problems, [], 'verifyAssetHashes (the vendor-assets gate) is green for the row');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
