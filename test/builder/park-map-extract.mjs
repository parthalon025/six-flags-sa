#!/usr/bin/env node
/**
 * Park-map HTML extraction — Cedar Fair / Six Flags Sanity + Next.js (#434).
 *
 * Seam: extractParkMapAssetUrls public output shape.
 *
 *   node test/builder/park-map-extract.mjs
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

console.log('\npark-map HTML extraction (#434)\n');

const { extractParkMapAssetUrls, pickParkMapForDownload } = await import(
  '../../packages/venue-builder/lib/park-map-research.mjs'
);

const CEDAR_FAIR_SNIPPET = `
  <link rel="preload" as="image" imageSrcSet="/_next/image?url=https%3A%2F%2Fcdn.sanity.io%2Fimages%2Fbsnrdz4t%2Fproduction%2Fe458d97eee03f5b1a67cc97e848d92cca78af9e9-1633x980.png&amp;w=1920&amp;q=75 1920w" />
  <img src="https://cdn.sanity.io/images/bsnrdz4t/production/789430a1b0aae9960f67e5caa02f161b91b5805b-1356x1036.jpg?rect=0,0,828,433&amp;w=1200&amp;h=627&amp;fit=crop&amp;auto=format" />
  <img src="https://cdn.sanity.io/images/bsnrdz4t/production/392fa013120bf34fbef1259268edf52ea16a581f-300x300.png" />
`;

await check('decodes Next.js _next/image url= proxy to underlying CDN asset', () => {
  const assets = extractParkMapAssetUrls(CEDAR_FAIR_SNIPPET, 'https://www.cedarpoint.com/park-map');
  const hit = assets.find((a) => /e458d97eee03f5b1a67cc97e848d92cca78af9e9-1633x980\.png/.test(a.imageUrl));
  assert.ok(hit, 'expected decoded sanity park-map PNG');
  assert.equal(hit.mapish, true, 'large schematic asset should rank as mapish');
  return true;
});

await check('extracts bare cdn.sanity.io URLs with HTML entity ampersands', () => {
  const assets = extractParkMapAssetUrls(CEDAR_FAIR_SNIPPET, 'https://www.cedarpoint.com/park-map');
  const hit = assets.find((a) => /789430a1b0aae9960f67e5caa02f161b91b5805b-1356x1036\.jpg/.test(a.imageUrl));
  assert.ok(hit, 'expected bare sanity JPG');
  assert.equal(hit.mapish, true);
  return true;
});

await check('ignores small sanity icons (favicon-scale)', () => {
  const assets = extractParkMapAssetUrls(CEDAR_FAIR_SNIPPET, 'https://www.cedarpoint.com/park-map');
  const icon = assets.find((a) => /392fa013120bf34fbef1259268edf52ea16a581f-300x300\.png/.test(a.imageUrl));
  assert.ok(icon, 'icon URL may be listed');
  assert.equal(icon.mapish, false, '300x300 icons are not park maps');
  return true;
});

await check('prefers largest mapish asset first', () => {
  const assets = extractParkMapAssetUrls(CEDAR_FAIR_SNIPPET, 'https://www.cedarpoint.com/park-map');
  const mapish = assets.filter((a) => a.mapish);
  assert.ok(mapish.length >= 2);
  const area = (url) => {
    const m = url.match(/-(\d+)x(\d+)\./);
    return m ? Number(m[1]) * Number(m[2]) : 0;
  };
  for (let i = 1; i < mapish.length; i += 1) {
    assert.ok(area(mapish[i - 1].imageUrl) >= area(mapish[i].imageUrl), 'sorted descending by pixel area');
  }
  return true;
});

await check('pickParkMapForDownload prefers mapish moderate over low icon', () => {
  const pick = pickParkMapForDownload([
    { imageUrl: 'https://cdn.example/icon-300x300.png', confidence: 'low', mapish: false },
    { imageUrl: 'https://cdn.example/parkmap-1633x980.png', confidence: 'moderate', mapish: true },
  ]);
  assert.match(pick.imageUrl, /1633x980/);
  return true;
});

await check('pickParkMapForDownload prefers llm_park_map_search over larger html scrape', () => {
  const pick = pickParkMapForDownload([
    {
      imageUrl: 'https://cdn.example/huge-banner-2880x1600.jpg',
      confidence: 'moderate',
      mapish: true,
      source: 'html_extract',
    },
    {
      imageUrl: 'https://cdn.example/guest-park-map-2026.png',
      confidence: 'high',
      mapish: false,
      source: 'llm_park_map_search',
    },
  ]);
  assert.match(pick.imageUrl, /guest-park-map-2026/);
  return true;
});

await check('extractParkMapAssetUrls rejects extensionless park-map page hrefs', () => {
  const html = '<a href="https://www.cedarpoint.com/park-map">Map</a>';
  const assets = extractParkMapAssetUrls(html, 'https://www.cedarpoint.com/park-map');
  assert.equal(assets.length, 0);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
