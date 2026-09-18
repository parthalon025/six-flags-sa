#!/usr/bin/env node
/**
 * Nominatim geocoder URL override (#412).
 *
 * Seams: resolveNominatimSearchUrl, buildNominatimSearchRequestUrl, fetchNominatimHits.
 *
 *   node test/builder/nominatim-config.mjs
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

console.log('\nnominatim-config (#412)\n');

const {
  DEFAULT_NOMINATIM_SEARCH_URL,
  resolveNominatimSearchUrl,
  buildNominatimSearchRequestUrl,
  fetchNominatimHits,
} = await import('../../packages/venue-builder/lib/nominatim-config.mjs');

await check('default search URL matches public Nominatim', () => {
  assert.equal(resolveNominatimSearchUrl({}), DEFAULT_NOMINATIM_SEARCH_URL);
  assert.equal(DEFAULT_NOMINATIM_SEARCH_URL, 'https://nominatim.openstreetmap.org/search');
  return true;
});

await check('VENUE_NOMINATIM_URL overrides the public endpoint', () => {
  assert.equal(
    resolveNominatimSearchUrl({ VENUE_NOMINATIM_URL: 'http://localhost:8080' }),
    'http://localhost:8080/search',
  );
  return true;
});

await check('NOMINATIM_URL is accepted when VENUE_NOMINATIM_URL is unset', () => {
  assert.equal(
    resolveNominatimSearchUrl({ NOMINATIM_URL: 'http://nominatim.internal' }),
    'http://nominatim.internal/search',
  );
  return true;
});

await check('VENUE_NOMINATIM_URL wins over NOMINATIM_URL', () => {
  assert.equal(
    resolveNominatimSearchUrl({
      VENUE_NOMINATIM_URL: 'http://venue-host',
      NOMINATIM_URL: 'http://legacy-host',
    }),
    'http://venue-host/search',
  );
  return true;
});

await check('env override may already include /search', () => {
  assert.equal(
    resolveNominatimSearchUrl({ VENUE_NOMINATIM_URL: 'http://localhost:8080/search' }),
    'http://localhost:8080/search',
  );
  return true;
});

await check('default request URL keeps today query parameters', () => {
  const url = buildNominatimSearchRequestUrl('Kings Island', { extratags: true });
  assert.equal(
    url,
    'https://nominatim.openstreetmap.org/search?q=Kings%20Island&format=json&limit=1&polygon_geojson=0&extratags=1',
  );
  return true;
});

await check('fetchNominatimHits reads VENUE_NOMINATIM_URL from env', async () => {
  const seen = [];
  await fetchNominatimHits('Kings Island', {
    env: { VENUE_NOMINATIM_URL: 'http://self-hosted:8080' },
    fetch: async (url) => {
      seen.push(url);
      return { ok: true, json: async () => [] };
    },
    userAgent: 'test-agent',
  });
  assert.ok(seen[0].startsWith('http://self-hosted:8080/search?'));
  return true;
});

await check('fetchNominatimHits uses configured host', async () => {
  const seen = [];
  const stubFetch = async (url, init) => {
    seen.push({ url, init });
    return {
      ok: true,
      json: async () => [
        {
          boundingbox: ['39.33', '39.35', '-84.27', '-84.25'],
          lat: '39.34',
          lon: '-84.26',
          display_name: 'Kings Island, Mason, Ohio',
        },
      ],
    };
  };
  const hits = await fetchNominatimHits('Kings Island', {
    searchUrl: 'http://localhost:8080/search',
    fetch: stubFetch,
    userAgent: 'test-agent',
  });
  assert.equal(hits.length, 1);
  assert.ok(seen[0].url.startsWith('http://localhost:8080/search?'));
  assert.equal(seen[0].init.headers['User-Agent'], 'test-agent');
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log('  -', f);
  process.exit(1);
}
