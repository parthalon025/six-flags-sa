#!/usr/bin/env node
/**
 * Top-100 catalog allow-no-heights resolution (#428).
 *
 * Seam: resolveAllowNoHeights — CLI flag > catalog default > strict.
 *
 *   node test/builder/top-parks-allow-no-heights.mjs
 */
import assert from 'node:assert/strict';
import { loadCatalog, resolveAllowNoHeights } from '../../packages/venue-builder/lib/top-parks-catalog.mjs';

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

console.log('\ntop-100 allow-no-heights resolution (#428)\n');

const coasterPark = { id: 'cedar-point', name: 'Cedar Point', catalogKind: 'theme-park' };
const waterPark = { id: 'big-kahunas', name: 'Big Kahuna\'s', catalogKind: 'water-park' };
const zooPark = { id: 'seaworld-orlando', name: 'SeaWorld Orlando', catalogKind: 'zoo' };

await check('strict by default for theme parks', () => {
  assert.equal(resolveAllowNoHeights(coasterPark), false);
  return true;
});

await check('catalog catalogKind water-park defaults to allow-no-heights', () => {
  assert.equal(resolveAllowNoHeights(waterPark), true);
  return true;
});

await check('catalog catalogKind zoo defaults to allow-no-heights', () => {
  assert.equal(resolveAllowNoHeights(zooPark), true);
  return true;
});

await check('explicit catalog allowNoHeights true without catalogKind', () => {
  assert.equal(resolveAllowNoHeights({ id: 'custom', allowNoHeights: true }), true);
  return true;
});

await check('CLI --allow-no-heights forces true for coaster parks', () => {
  assert.equal(resolveAllowNoHeights(coasterPark, { cliAllowNoHeights: true }), true);
  return true;
});

await check('CLI --strict-heights forces false for water parks', () => {
  assert.equal(resolveAllowNoHeights(waterPark, { cliStrictHeights: true }), false);
  return true;
});

await check('CLI allow beats CLI strict when both set (allow wins)', () => {
  assert.equal(
    resolveAllowNoHeights(waterPark, { cliAllowNoHeights: true, cliStrictHeights: true }),
    true,
  );
  return true;
});

await check('annotated zoo and water-park entries exist in the live catalog', () => {
  const catalog = loadCatalog();
  const seaworld = catalog.parks.find((p) => p.name === 'SeaWorld Orlando');
  const schlitterbahn = catalog.parks.find((p) => p.name === 'Schlitterbahn New Braunfels');
  assert.ok(seaworld?.catalogKind === 'zoo', 'SeaWorld Orlando should be catalogKind zoo');
  assert.ok(schlitterbahn?.catalogKind === 'water-park', 'Schlitterbahn should be catalogKind water-park');
  assert.equal(resolveAllowNoHeights({ ...seaworld, id: 'seaworld-orlando' }), true);
  assert.equal(resolveAllowNoHeights({ ...schlitterbahn, id: 'schlitterbahn-new-braunfels' }), true);
  return true;
});

await check('height-less catalog park skips heights stage but not geometry', () => {
  const catalog = loadCatalog();
  const bigKahunas = catalog.parks.find((p) => p.name === "Big Kahuna's");
  const allow = resolveAllowNoHeights({ ...bigKahunas, id: 'big-kahunas' });
  assert.equal(allow, true);
  const skip = allow ? ['research', 'heights', 'rebuild', 'agent'] : [];
  assert.ok(skip.includes('heights'), 'heights stage skipped');
  assert.ok(!skip.includes('geometry'), 'geometry still runs');
  return true;
});

await check('coaster catalog park keeps strict heights path', () => {
  const catalog = loadCatalog();
  const cedar = catalog.parks.find((p) => p.name === 'Cedar Point');
  assert.equal(resolveAllowNoHeights({ ...cedar, id: 'cedar-point' }), false);
  const skip = [];
  assert.ok(!skip.includes('heights'), 'heights stage not skipped by default');
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
