#!/usr/bin/env node
/**
 * Catalog allow-no-heights resolution (#428).
 *
 * Seam: resolveAllowNoHeights — CLI flag > catalog default > strict.
 *
 *   node test/builder/allow-no-heights-catalog.mjs
 */
import assert from 'node:assert/strict';

const {
  resolveAllowNoHeights,
  catalogAllowsNoHeights,
  pipelineHeightOptsForPark,
  HEIGHT_LESS_KINDS,
} = await import('../../packages/venue-builder/lib/top-parks-catalog.mjs');

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

console.log('\nallow-no-heights catalog resolution (#428)\n');

await check('coaster park defaults to strict (no catalog escape)', () => {
  assert.equal(
    resolveAllowNoHeights({ cliAllowNoHeights: null, catalogEntry: { id: 'cedar-point', kind: 'theme-park' } }),
    false,
  );
  return true;
});

await check('water-park kind defaults to allow-no-heights', () => {
  assert.ok(HEIGHT_LESS_KINDS.has('water-park'));
  assert.equal(
    resolveAllowNoHeights({ cliAllowNoHeights: null, catalogEntry: { id: 'big-kahunas', kind: 'water-park' } }),
    true,
  );
  return true;
});

await check('explicit catalog allowNoHeights:true without kind', () => {
  assert.equal(
    catalogAllowsNoHeights({ allowNoHeights: true }),
    true,
  );
  return true;
});

await check('CLI --allow-no-heights overrides strict coaster catalog', () => {
  assert.equal(
    resolveAllowNoHeights({
      cliAllowNoHeights: true,
      catalogEntry: { id: 'cedar-point', kind: 'theme-park' },
    }),
    true,
  );
  return true;
});

await check('CLI --no-allow-no-heights overrides water-park catalog default', () => {
  assert.equal(
    resolveAllowNoHeights({
      cliAllowNoHeights: false,
      catalogEntry: { id: 'big-kahunas', kind: 'water-park' },
    }),
    false,
  );
  return true;
});

await check('pipelineHeightOptsForPark skips heights stages for catalog water-park', () => {
  const park = { id: 'fixture-water', rank: 99, name: 'Fixture Water', kind: 'water-park' };
  const opts = pipelineHeightOptsForPark(park, { cliAllowNoHeights: null });
  assert.equal(opts.allowNoHeights, true);
  assert.ok(opts.skip.includes('heights'));
  assert.ok(opts.skip.includes('rebuild'));
  return true;
});

await check('top-100 catalog annotates known water parks (#428)', async () => {
  const { loadCatalog } = await import('../../packages/venue-builder/lib/top-parks-catalog.mjs');
  const catalog = loadCatalog();
  const bigKahunas = catalog.parks.find((p) => p.name === "Big Kahuna's");
  assert.equal(bigKahunas?.kind, 'water-park');
  const annotated = catalog.parks.filter((p) => p.kind === 'water-park' || p.kind === 'aquarium');
  assert.ok(annotated.length >= 10, `expected at least 10 height-less parks, got ${annotated.length}`);
  return true;
});

await check('pipelineHeightOptsForPark keeps strict stages for coaster without CLI flag', () => {
  const park = { id: 'cedar-point', rank: 14, name: 'Cedar Point', kind: 'theme-park' };
  const opts = pipelineHeightOptsForPark(park, { cliAllowNoHeights: null });
  assert.equal(opts.allowNoHeights, false);
  assert.equal(opts.skip.length, 0);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
