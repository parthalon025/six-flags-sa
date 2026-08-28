#!/usr/bin/env node
/**
 * Top-100 catalog allow-no-heights resolution (#428).
 *
 * Precedence: CLI --allow-no-heights > CLI --strict-heights > catalog default > strict.
 *
 *   node test/builder/catalog-allow-no-heights.mjs
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

console.log('\ncatalog allow-no-heights resolution\n');

const {
  resolveAllowNoHeights,
  catalogAllowsNoHeights,
  catalogHeightsOptional,
  loadCatalog,
  withIds,
} = await import('../../packages/venue-builder/lib/top-parks-catalog.mjs');

await check('strict by default for coaster parks', () => {
  const park = { id: 'cedar-point', name: 'Cedar Point', kind: 'theme-park' };
  assert.equal(resolveAllowNoHeights(park, {}), false);
  return true;
});

await check('water-park kind defaults to allow-no-heights', () => {
  const park = { id: 'big-kahuna-s', name: "Big Kahuna's", kind: 'water-park' };
  assert.equal(resolveAllowNoHeights(park, {}), true);
  return true;
});

await check('zoo kind defaults to allow-no-heights', () => {
  const park = { id: 'sample-zoo', name: 'Sample Zoo', kind: 'zoo' };
  assert.equal(resolveAllowNoHeights(park, {}), true);
  return true;
});

await check('explicit catalog allowNoHeights field wins over theme-park kind', () => {
  const park = { id: 'custom', name: 'Custom', kind: 'theme-park', allowNoHeights: true };
  assert.equal(resolveAllowNoHeights(park, {}), true);
  return true;
});

await check('CLI --allow-no-heights forces allow for coaster parks', () => {
  const park = { id: 'cedar-point', name: 'Cedar Point', kind: 'theme-park' };
  assert.equal(resolveAllowNoHeights(park, { cliAllow: true }), true);
  return true;
});

await check('CLI --strict-heights forces strict even for water parks', () => {
  const park = { id: 'big-kahuna-s', name: "Big Kahuna's", kind: 'water-park' };
  assert.equal(resolveAllowNoHeights(park, { cliStrict: true }), false);
  return true;
});

await check('CLI --allow-no-heights beats --strict-heights when both set', () => {
  const park = { id: 'big-kahuna-s', name: "Big Kahuna's", kind: 'water-park' };
  assert.equal(resolveAllowNoHeights(park, { cliAllow: true, cliStrict: true }), true);
  return true;
});

await check('catalogAllowsNoHeights identifies annotated water parks', () => {
  const catalog = loadCatalog();
  const parks = withIds(catalog.parks);
  const waterParks = parks.filter((p) => p.kind === 'water-park');
  assert.ok(waterParks.length >= 10, `expected at least 10 water-park entries, got ${waterParks.length}`);
  for (const park of waterParks) {
    assert.ok(catalogAllowsNoHeights(park), `${park.id} should allow no heights`);
  }
  return true;
});

await check('coaster parks in catalog stay strict without CLI flag', () => {
  const catalog = loadCatalog();
  const parks = withIds(catalog.parks);
  const cedar = parks.find((p) => p.id === 'cedar-point');
  const kings = parks.find((p) => p.id === 'kings-island');
  assert.ok(cedar && kings);
  assert.equal(catalogAllowsNoHeights(cedar), false);
  assert.equal(catalogAllowsNoHeights(kings), false);
  return true;
});

await check('catalogHeightsOptional for water parks without CLI flags', () => {
  const park = { id: 'big-kahuna-s', name: "Big Kahuna's", kind: 'water-park' };
  assert.equal(catalogHeightsOptional(park, {}), true);
  return true;
});

await check('catalogHeightsOptional geometry-only when CLI --allow-no-heights', () => {
  const park = { id: 'cedar-point', name: 'Cedar Point', kind: 'theme-park' };
  assert.equal(catalogHeightsOptional(park, { allowNoHeights: true }), true);
  return true;
});

await check('catalogHeightsOptional strict when CLI --strict-heights on water park', () => {
  const park = { id: 'big-kahuna-s', name: "Big Kahuna's", kind: 'water-park' };
  assert.equal(catalogHeightsOptional(park, { strictHeights: true }), false);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
