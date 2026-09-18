#!/usr/bin/env node
/**
 * Universal parks ship path (#425) — slug-map registration and operator seam.
 *
 *   node test/builder/universal-ship.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

console.log('\nuniversal ship path (#425)\n');

const UNIVERSAL_TOP100 = [
  'universal-studios-florida',
  'universal-s-islands-of-adventure',
  'universal-studios-hollywood',
];

const {
  QUEUE_TIMES_SLUGS,
  WIKIDATA_QIDS,
} = await import('../../packages/venue-builder/lib/park-slug-map.mjs');

const { operatorForUrl, parseListingForUrl } = await import(
  '../../packages/venue-builder/lib/operators/index.mjs'
);

const { officialSiteForPark } = await import(
  '../../packages/venue-builder/lib/park-official-urls.mjs'
);

await check('top-100 Universal parks have queue-times slugs in park-slug-map', () => {
  for (const id of UNIVERSAL_TOP100) {
    assert.ok(QUEUE_TIMES_SLUGS[id], `missing QUEUE_TIMES_SLUGS[${id}]`);
  }
  return true;
});

await check('top-100 Universal parks have Wikidata Q-ids in park-slug-map', () => {
  for (const id of UNIVERSAL_TOP100) {
    assert.match(WIKIDATA_QIDS[id] || '', /^Q\d+$/, `missing WIKIDATA_QIDS[${id}]`);
  }
  return true;
});

await check('Universal official URLs dispatch to the universal operator parser', () => {
  const florida = officialSiteForPark({ id: 'universal-studios-florida' });
  assert.equal(operatorForUrl(florida), 'universal');
  const fixture = readFileSync(
    new URL('./fixtures/universal-studios-florida-listing.html', import.meta.url),
    'utf8',
  );
  const rows = parseListingForUrl(fixture, florida);
  assert.ok(rows.length >= 2, 'expected multiple attractions from fixture HTML');
  assert.ok(rows.some((r) => /mummy/i.test(r.name)), 'fixture should include Revenge of the Mummy');
  return true;
});

await check('universal-studios-florida queue-times cache resolves via park-slug-map', async () => {
  const { loadQueueTimesData } = await import(
    '../../packages/venue-builder/lib/adapters/queue-times.mjs'
  );
  const data = await loadQueueTimesData('universal-studios-florida', {
    venueName: 'Universal Studios Florida',
    fetch: true,
  });
  assert.equal(data.parkId, 65);
  assert.ok(data.rides?.length > 0, 'expected live queue-times rides');
  return true;
});

await check('universal-studios-florida venue bundle has certification output on disk', () => {
  const certPath = new URL(
    '../../packages/venue-builder/data/venues/universal-studios-florida/certification.json',
    import.meta.url,
  );
  const doc = JSON.parse(readFileSync(certPath, 'utf8'));
  assert.equal(doc.venue.id, 'universal-studios-florida');
  assert.ok(Array.isArray(doc.checks) && doc.checks.length > 0, 'certification checks present');
  assert.equal(typeof doc.certified, 'boolean');
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log('  -', f);
  process.exit(1);
}
