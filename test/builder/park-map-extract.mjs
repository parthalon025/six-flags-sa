#!/usr/bin/env node
/**
 * Park map HTML extraction — Next.js / Sanity seam (#434).
 *
 * Cedar Fair and Six Flags park-map pages embed guest maps via Next.js image
 * proxies pointing at Sanity CDN assets. Without decoding those URLs the
 * deterministic research step finds UI chrome only.
 *
 *   node test/builder/park-map-extract.mjs
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

console.log('\npark map HTML extraction\n');

const FIXTURE = fileURLToPath(
  new URL('./fixtures/park-map-extract/cedar-fair-next.html', import.meta.url),
);

const {
  extractParkMapAssetUrls,
  deterministicParkMapCandidates,
} = await import('../../packages/venue-builder/lib/park-map-research.mjs');
const { certifyVenue } = await import('../../packages/venue-builder/lib/venue-certify.mjs');

const PAGE = 'https://www.visitkingsisland.com/park-map';
const EXPECTED_MAP =
  'https://cdn.sanity.io/images/bsnrdz4t/production/f8c7bf27222e473e28c7015f638071b5a90ea5e5-1920x475.jpg';

await check('decodes _next/image proxy to Sanity park-map asset', () => {
  const html = readFileSync(FIXTURE, 'utf8');
  const assets = extractParkMapAssetUrls(html, PAGE);
  const hit = assets.find((a) => a.imageUrl.startsWith(EXPECTED_MAP));
  assert.ok(hit, `expected Sanity park map URL, got: ${assets.map((a) => a.imageUrl).join(', ')}`);
  assert.equal(hit.mapish, true, 'wide schematic map must be flagged mapish');
  assert.equal(hit.via, 'next_image');
  return true;
});

await check('deterministic candidates include the decoded Sanity map', () => {
  const html = readFileSync(FIXTURE, 'utf8');
  const catalog = {
    sources: [{
      kind: 'official_map',
      id: 'park-map',
      map_kind: 'schematic',
      url: PAGE,
    }],
  };
  const det = deterministicParkMapCandidates({
    catalog,
    official: { pages: [] },
    htmlByUrl: { [PAGE]: html },
  });
  assert.ok(
    det.parkMaps.some((m) => m.imageUrl?.startsWith(EXPECTED_MAP)),
    'deterministic step must surface the guest map for download',
  );
  return true;
});

await check('kings-island park_map_research passes with local maps/ image', () => {
  const doc = certifyVenue('kings-island', { write: false });
  const pm = doc.checks.find((c) => c.key === 'park_map_research');
  assert.equal(pm.pass, true, pm.evidence.detail);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
