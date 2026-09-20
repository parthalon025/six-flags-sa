#!/usr/bin/env node
/**
 * Official page `via` must reflect whether Playwright ran, not just --browser (#410).
 *
 *   node test/scripts/official-page-via.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOfficialData, officialCacheFile } from '../../packages/venue-builder/lib/venue-official-site.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const listingHtml = readFileSync(
  join(root, 'test/builder/fixtures/official-site/big-kahunas-listing.html'),
  'utf8',
);

const venueId = '__official-via-test__';
const catalog = {
  sources: [
    {
      kind: 'official_site',
      id: 'listing',
      url: 'https://bigkahunas.com/destin/attractions/water-park/',
    },
  ],
};

const cachePath = officialCacheFile(venueId);
const realFetch = globalThis.fetch;

try {
  globalThis.fetch = async () => ({
    ok: true,
    text: async () => listingHtml,
  });

  const result = await loadOfficialData(venueId, catalog, { fetch: true, browser: true });
  assert.ok(result.attractions.length > 0, 'fixture listing should parse');
  assert.equal(
    result.pages[0].via,
    'fetch',
    'fetch-only success must not report browser when --browser is enabled',
  );
} finally {
  globalThis.fetch = realFetch;
  if (existsSync(cachePath)) rmSync(cachePath);
}

console.log('ok official-page-via');
