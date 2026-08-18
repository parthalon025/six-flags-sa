#!/usr/bin/env node
/**
 * Asset ledger — license gate, pinned provenance, credits, cache keys.
 *
 *   node test/builder/display-assets.mjs
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

console.log('\nasset ledger\n');

const { readAssetLedger, verifyAssetHashes, creditsManifest, assetContentHash } = await import(
  '../../packages/venue-builder/lib/display-assets.mjs'
);

await check('every ledger row is licensed, sourced, and byte-pinned', () => {
  const problems = verifyAssetHashes();
  assert.deepEqual(problems, []);
  const ledger = readAssetLedger();
  assert.ok(Object.keys(ledger).length >= 3, 'expected the vendored Kenney packs');
  for (const [id, row] of Object.entries(ledger)) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, `asset id "${id}" is not a stable slug`);
    assert.ok(row.import, `${id} lacks import settings beside the asset`);
    if (row.kind === 'tilesheet') {
      assert.ok(row.import.tileSize >= 8, `${id} tilesheet lacks tile geometry`);
      assert.ok(row.source.commit, `${id} lacks a pinned mirror commit`);
    }
    if (row.license === 'original') {
      assert.match(row.path, /^assets\/custom\//, `${id}: original art lives under assets/custom/`);
    }
  }
  return true;
});

await check('a poisoned license or drifted byte fails the gate', () => {
  const ledger = readAssetLedger();
  const [id, row] = Object.entries(ledger)[0];
  const tainted = { [id]: { ...row, license: 'AGPL-3.0' } };
  assert.ok(verifyAssetHashes(tainted).some((p) => /license/.test(p)));
  const drifted = { [id]: { ...row, sha256: '0'.repeat(64) } };
  assert.ok(verifyAssetHashes(drifted).some((p) => /drift/.test(p)));
  return true;
});

await check('credits manifest names every used asset; unknown ids throw', () => {
  const ledger = readAssetLedger();
  const ids = Object.keys(ledger).slice(0, 2);
  const credits = creditsManifest([...ids, ids[0]], ledger);
  assert.equal(credits.assets.length, 2, 'deduped and complete');
  for (const row of credits.assets) {
    assert.ok(row.license && row.source, 'license + source ride every credit row');
  }
  assert.throws(() => creditsManifest(['not-an-asset'], ledger), /Unknown asset/);
  return true;
});

await check('content hash moves with import settings, not just bytes', () => {
  const ledger = readAssetLedger();
  const row = Object.values(ledger)[0];
  const a = assetContentHash(row, 1);
  const b = assetContentHash({ ...row, import: { ...row.import, tileSize: 32 } }, 1);
  const c = assetContentHash(row, 2);
  assert.notEqual(a, b, 'import settings are part of the key');
  assert.notEqual(a, c, 'baker version is part of the key');
  assert.equal(a, assetContentHash(row, 1), 'stable for identical inputs');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
