#!/usr/bin/env node
/**
 * Operator-family listing parsers — SeaWorld, Legoland, Herschend (#426).
 *
 * Seam: parseListingForUrl + operatorForUrl dispatch from lib/operators/index.mjs.
 *
 *   node test/builder/operator-parsers.mjs
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

function loadFixture(rel) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  return readFileSync(path, 'utf8');
}

console.log('\noperator-family listing parsers (#426)\n');

const { operatorForUrl, parseListingForUrl } = await import(
  '../../packages/venue-builder/lib/operators/index.mjs'
);

await check('operatorForUrl routes SeaWorld Parks hostnames', () => {
  assert.equal(operatorForUrl('https://seaworld.com/orlando/rides'), 'seaworld');
  assert.equal(operatorForUrl('https://buschgardens.com/tampa/rides'), 'seaworld');
  assert.equal(operatorForUrl('https://sesameplace.com/philadelphia/rides'), 'seaworld');
  assert.equal(operatorForUrl('https://adventureisland.com/rides'), 'seaworld');
  return true;
});

await check('operatorForUrl routes Legoland hostnames', () => {
  assert.equal(operatorForUrl('https://www.legoland.com/florida/things-to-do/rides/'), 'legoland');
  return true;
});

await check('operatorForUrl routes Herschend hostnames', () => {
  assert.equal(operatorForUrl('https://www.dollywood.com/thepark/rides-attractions'), 'herschend');
  assert.equal(operatorForUrl('https://www.silverdollarcity.com/rides-attractions'), 'herschend');
  assert.equal(operatorForUrl('https://www.idlewild.com/attractions'), 'herschend');
  assert.equal(operatorForUrl('https://www.dutchwonderland.com/rides-attractions/'), 'herschend');
  return true;
});

await check('SeaWorld parser reads ride cards from fixture', () => {
  const html = loadFixture('./fixtures/official-site/seaworld-orlando-listing.html');
  const url = 'https://seaworld.com/orlando/rides';
  const rows = parseListingForUrl(html, url);
  assert.ok(rows.length >= 3, `expected at least 3 rides, got ${rows.length}`);
  assert.equal(rows[0].operator, 'seaworld');
  const mako = rows.find((r) => r.name === 'Mako');
  assert.ok(mako, 'Mako missing');
  assert.match(String(mako.url), /\/orlando\/rides\/mako/);
  return true;
});

await check('Legoland parser reads ride tiles from fixture', () => {
  const html = loadFixture('./fixtures/official-site/legoland-florida-listing.html');
  const url = 'https://www.legoland.com/florida/things-to-do/rides/';
  const rows = parseListingForUrl(html, url);
  assert.ok(rows.length >= 3, `expected at least 3 rides, got ${rows.length}`);
  assert.equal(rows[0].operator, 'legoland');
  const dragon = rows.find((r) => r.name === 'The Dragon');
  assert.ok(dragon, 'The Dragon missing');
  assert.match(String(dragon.url), /the-dragon/);
  return true;
});

await check('Herschend parser reads attraction cards from fixture', () => {
  const html = loadFixture('./fixtures/official-site/dollywood-listing.html');
  const url = 'https://www.dollywood.com/thepark/rides-attractions';
  const rows = parseListingForUrl(html, url);
  assert.ok(rows.length >= 3, `expected at least 3 attractions, got ${rows.length}`);
  assert.equal(rows[0].operator, 'herschend');
  const rod = rows.find((r) => r.name === 'Lightning Rod');
  assert.ok(rod, 'Lightning Rod missing');
  assert.match(String(rod.url), /lightning-rod/);
  return true;
});

await check('SeaWorld URL does not fall through to generic operator', () => {
  const html = loadFixture('./fixtures/official-site/seaworld-orlando-listing.html');
  const rows = parseListingForUrl(html, 'https://seaworld.com/orlando/rides');
  assert.ok(rows.every((r) => r.operator === 'seaworld'));
  assert.equal(rows.some((r) => r.operator === 'generic'), false);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
