#!/usr/bin/env node
/**
 * Top-100 catalog — per-park allow-no-heights resolution (#428).
 *
 * Pins flag precedence: CLI --allow-no-heights > catalog entry > kind default > strict.
 *
 *   node test/builder/top-parks-allow-no-heights.mjs
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

console.log('\ntop-100 catalog allow-no-heights\n');

const {
  loadCatalog,
  withIds: catalogWithIds,
  resolveAllowNoHeights,
  pipelineSkipForAllowNoHeights,
  HEIGHT_LESS_KINDS,
} = await import('../../packages/venue-builder/lib/top-parks-catalog.mjs');

await check('coaster park stays strict without CLI or catalog flag', () => {
  const coaster = { id: 'cedar-point', name: 'Cedar Point', kind: 'theme-park' };
  assert.equal(resolveAllowNoHeights(coaster, { cliAllowNoHeights: false }), false);
  return true;
});

await check('water-park kind defaults to allow-no-heights', () => {
  const water = { id: 'schlitterbahn-new-braunfels', name: 'Schlitterbahn', kind: 'water-park' };
  assert.equal(resolveAllowNoHeights(water, { cliAllowNoHeights: false }), true);
  return true;
});

await check('zoo kind defaults to allow-no-heights', () => {
  const zoo = { id: 'discovery-cove', name: 'Discovery Cove', kind: 'zoo' };
  assert.equal(resolveAllowNoHeights(zoo, { cliAllowNoHeights: false }), true);
  return true;
});

await check('CLI --allow-no-heights overrides catalog strictness', () => {
  const coaster = { id: 'cedar-point', name: 'Cedar Point', kind: 'theme-park' };
  assert.equal(resolveAllowNoHeights(coaster, { cliAllowNoHeights: true }), true);
  return true;
});

await check('explicit catalog allow-no-heights false overrides kind default', () => {
  const hybrid = { id: 'busch-gardens-tampa-bay', name: 'Busch Gardens', kind: 'zoo', 'allow-no-heights': false };
  assert.equal(resolveAllowNoHeights(hybrid, { cliAllowNoHeights: false }), false);
  return true;
});

await check('pipelineSkipForAllowNoHeights skips height stages when allowed', () => {
  assert.deepEqual(pipelineSkipForAllowNoHeights(true), ['research', 'aliases', 'heights', 'rebuild', 'agent']);
  assert.deepEqual(pipelineSkipForAllowNoHeights(false), []);
  return true;
});

await check('catalog annotates known water-park and zoo entries', () => {
  const catalog = loadCatalog();
  const byId = Object.fromEntries(catalogWithIds(catalog.parks).map((p) => [p.id, p]));
  assert.equal(byId['schlitterbahn-new-braunfels'].kind, 'water-park');
  assert.equal(byId['discovery-cove'].kind, 'zoo');
  assert.equal(byId['big-kahuna-s'].kind, 'water-park');
  assert.equal(resolveAllowNoHeights(byId['cedar-point'], { cliAllowNoHeights: false }), false);
  assert.ok(HEIGHT_LESS_KINDS.has('water-park'));
  assert.ok(HEIGHT_LESS_KINDS.has('zoo'));
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
