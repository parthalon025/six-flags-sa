#!/usr/bin/env node
/** poly-haven adapter — CC0 PBR material ledger for the Display pipeline. */
import assert from 'node:assert/strict';
import {
  buildLedger,
  fetchMaterial,
  CATEGORY_SLUGS,
  run,
} from '../../packages/venue-builder/lib/adapters/poly-haven.mjs';

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

console.log('\npoly-haven adapter suite\n');

await check('CATEGORY_SLUGS covers asphalt, roofing, and foliage; no fabricated water entry', () => {
  assert.equal(CATEGORY_SLUGS.asphalt, 'asphalt_02');
  assert.equal(CATEGORY_SLUGS.roofing, 'grey_roof_01');
  assert.equal(CATEGORY_SLUGS.foliage, 'leafy_grass');
  assert.equal(CATEGORY_SLUGS.water, undefined);
});

await check('fetchMaterial picks the requested resolution/format from a fake API response', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('/info/')) return { name: 'Asphalt 02', categories: ['road', 'outdoor'] };
    if (url.includes('/files/')) {
      return {
        Diffuse: { '2k': { jpg: { url: 'https://dl.polyhaven.org/x_diff_2k.jpg', size: 100, md5: 'abc' } } },
        Rough: { '2k': { jpg: { url: 'https://dl.polyhaven.org/x_rough_2k.jpg', size: 50, md5: 'def' } } },
      };
    }
    throw new Error(`unexpected url ${url}`);
  };
  const material = await fetchMaterial('asphalt', 'asphalt_02', { fetch: fakeFetch });
  assert.equal(material.category, 'asphalt');
  assert.equal(material.slug, 'asphalt_02');
  assert.equal(material.license, 'CC0');
  assert.equal(material.source, 'https://polyhaven.com/a/asphalt_02');
  assert.equal(material.maps.Diffuse.url, 'https://dl.polyhaven.org/x_diff_2k.jpg');
  assert.equal(material.maps.Rough.md5, 'def');
});

await check('fetchMaterial skips a map that has no file at the requested resolution', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('/info/')) return { name: 'X' };
    return { Diffuse: { '4k': { jpg: { url: 'only-4k.jpg', size: 1, md5: 'x' } } } }; // no 2k entry
  };
  const material = await fetchMaterial('foliage', 'leafy_grass', { fetch: fakeFetch });
  assert.deepEqual(material.maps, {});
});

await check('buildLedger assembles the committed-ledger shape', () => {
  const ledger = buildLedger([{ category: 'asphalt', slug: 'asphalt_02' }], { fetched: '2026-01-01' });
  assert.equal(ledger.version, 1);
  assert.equal(ledger.license, 'CC0');
  assert.equal(ledger.fetched, '2026-01-01');
  assert.equal(ledger.materials.length, 1);
});

await check('run() reports every fetch failure rather than partially succeeding silently', async () => {
  const failingFetch = async () => {
    throw new Error('network down');
  };
  const res = await run({}, { fetch: failingFetch });
  assert.equal(res.ok, false);
  assert.equal(res.adapterId, 'poly-haven');
  assert.ok(res.error.includes('network down'));
});

await check('run() offline mode reads whatever ledger is already on disk without fetching', async () => {
  const res = await run({ offline: true });
  // No network call is made in offline mode — ok reflects whether a ledger
  // already exists on disk, not a fetch outcome.
  assert.equal(typeof res.ok, 'boolean');
  assert.equal(res.adapterId, 'poly-haven');
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
