#!/usr/bin/env node
/**
 * lib/venue/download.js — the venue download manager's decision logic
 * (ADR-0018), pure modules in bare node with injected fetch / Cache Storage.
 *
 * The offline contract under test: bytes reach the bundle cache only after
 * their sha256 matches the manifest pin; a half-landed sync never commits
 * its manifest; bytes already on the phone are adopted without a network
 * fetch; and the service worker preserves the bundle cache across deploys.
 *
 *   node test/app/venue-download.test.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const {
  VENUE_BUNDLE_CACHE,
  bundleUrlFor,
  hashedUrlFor,
  bundleIndexOf,
  planBundleSync,
  sha256Hex,
  contentTypeFor,
  syncVenueBundle,
} = await import('../../apps/party-tracker/lib/venue/download.js');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

/* ------------------------------------------------------------- fixtures -- */

const sha = (text) => createHash('sha256').update(text).digest('hex');

const BODIES = {
  '/venues/p.map.json': '{"meta":{"id":"p"}}',
  '/venues/p.pois.json': '[]',
  '/venues/p/display/trail.style.json': '{"version":8}',
};

const manifestFor = (paths) => ({
  version: 1,
  venue: 'p',
  basedOn: { map: '2026-08-15' },
  files: paths.map((p) => ({ path: p, bytes: BODIES[p].length, sha256: sha(BODIES[p]) })),
});

const MANIFEST = manifestFor(Object.keys(BODIES));
const MANIFEST_URL = '/venues/p.bundle.json';
const VENUE = { id: 'p', bundle: MANIFEST_URL };

/** In-memory CacheStorage: open() per name, match() across every cache. */
function fakeCaches() {
  const stores = new Map();
  const cacheFor = () => {
    const entries = new Map();
    return {
      entries,
      async match(key) {
        return entries.get(key);
      },
      async put(key, res) {
        entries.set(key, res);
      },
      async delete(key) {
        return entries.delete(key);
      },
    };
  };
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, cacheFor());
      return stores.get(name);
    },
    async match(key) {
      for (const cache of stores.values()) {
        const hit = await cache.match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

/** fetch fake serving the manifest + hash-addressed bodies; records calls. */
function fakeFetch({ manifest = MANIFEST, corrupt = [], down = [] } = {}) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    if (down.includes(url)) throw new TypeError('network down');
    if (url === MANIFEST_URL) {
      return new Response(JSON.stringify(manifest), { status: 200 });
    }
    const clean = url.split('?')[0];
    if (!(clean in BODIES)) return new Response('', { status: 404 });
    const body = corrupt.includes(clean) ? 'not-the-bytes' : BODIES[clean];
    return new Response(body, { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

const bundleCacheOf = (caches) => caches.stores.get(VENUE_BUNDLE_CACHE);
const textOf = async (caches, key) => {
  const hit = await bundleCacheOf(caches)?.match(key);
  return hit ? hit.text() : null;
};

/* ------------------------------------------------------------ pure bits -- */

await check('bundleUrlFor: manifest row wins, id falls back, nothing is null', () => {
  assert.equal(bundleUrlFor(VENUE), MANIFEST_URL);
  assert.equal(bundleUrlFor({ id: 'q' }), '/venues/q.bundle.json');
  assert.equal(bundleUrlFor(null), null);
  assert.equal(bundleUrlFor({}), null);
});

await check('hashedUrlFor addresses the fetch by content', () => {
  const entry = MANIFEST.files[0];
  assert.equal(hashedUrlFor(entry), `${entry.path}?v=${entry.sha256.slice(0, 16)}`);
});

await check('sha256Hex agrees with node crypto', async () => {
  const hex = await sha256Hex(new TextEncoder().encode('abc'));
  assert.equal(hex, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(new Uint8Array(), { subtle: null }), null);
});

await check('contentTypeFor knows the bundle file kinds', () => {
  assert.equal(contentTypeFor('/venues/p.map.json'), 'application/json');
  assert.equal(contentTypeFor('/venues/p/display/trail.world.png'), 'image/png');
  assert.equal(contentTypeFor('/venues/p/display/base.pmtiles'), 'application/octet-stream');
});

await check('planBundleSync: changed fetches, unchanged keeps, removed drops', () => {
  const previous = bundleIndexOf(manifestFor(['/venues/p.map.json', '/venues/p.pois.json']));
  previous.set('/venues/p.pois.json', 'stale-hash');
  previous.set('/venues/gone.json', 'x');
  const plan = planBundleSync(MANIFEST, previous);
  assert.deepEqual(plan.keep.map((f) => f.path), ['/venues/p.map.json']);
  assert.deepEqual(plan.fetch.map((f) => f.path).sort(), [
    '/venues/p.pois.json',
    '/venues/p/display/trail.style.json',
  ]);
  assert.deepEqual(plan.drop, ['/venues/gone.json']);
  // No held manifest: everything fetches, nothing drops.
  const cold = planBundleSync(MANIFEST, bundleIndexOf(null));
  assert.equal(cold.fetch.length, 3);
  assert.deepEqual(cold.drop, []);
});

/* ----------------------------------------------------------------- sync -- */

await check('first sync downloads by hash, verifies, and commits the manifest', async () => {
  const caches = fakeCaches();
  const fetchImpl = fakeFetch();
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches });
  assert.deepEqual(result, { ok: true, fetched: 3, reused: 0, kept: 0, dropped: 0, failed: [] });
  for (const [clean, body] of Object.entries(BODIES)) {
    assert.equal(await textOf(caches, clean), body, `${clean} cached under its clean path`);
  }
  assert.equal(await textOf(caches, MANIFEST_URL), JSON.stringify(MANIFEST), 'manifest committed');
  const bodyCalls = fetchImpl.calls.filter((u) => u !== MANIFEST_URL);
  for (const url of bodyCalls) {
    assert.match(url, /\?v=[0-9a-f]{16}$/, `${url} fetched hash-addressed`);
  }
});

await check('re-sync of an unchanged bundle touches only the manifest', async () => {
  const caches = fakeCaches();
  await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage: caches });
  const fetchImpl = fakeFetch();
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches });
  assert.deepEqual(result, { ok: true, fetched: 0, reused: 0, kept: 3, dropped: 0, failed: [] });
  assert.deepEqual(fetchImpl.calls, [MANIFEST_URL], 'no body bytes re-downloaded');
});

await check('seed short-circuit: bytes already in any cache are adopted, not fetched', async () => {
  const caches = fakeCaches();
  // The service worker's precache holds the seed venue's files.
  const seed = await caches.open('tracker-1.0.0');
  await seed.put('/venues/p.map.json', new Response(BODIES['/venues/p.map.json']));
  await seed.put('/venues/p.pois.json', new Response(BODIES['/venues/p.pois.json']));
  const fetchImpl = fakeFetch();
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches });
  assert.deepEqual(result, { ok: true, fetched: 1, reused: 2, kept: 0, dropped: 0, failed: [] });
  assert.deepEqual(
    fetchImpl.calls,
    [MANIFEST_URL, hashedUrlFor(MANIFEST.files.find((f) => f.path.endsWith('trail.style.json')))],
    'network only for what the phone does not already hold',
  );
});

await check('a wrong-hash download is never cached and blocks the manifest commit', async () => {
  const caches = fakeCaches();
  const result = await syncVenueBundle(VENUE, {
    fetchImpl: fakeFetch({ corrupt: ['/venues/p.pois.json'] }),
    cacheStorage: caches,
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.failed, ['/venues/p.pois.json']);
  assert.equal(result.fetched, 2, 'good entries still land');
  assert.equal(await textOf(caches, '/venues/p.pois.json'), null, 'corrupt bytes never cached');
  assert.equal(await textOf(caches, MANIFEST_URL), null, 'half-landed sync stays uncommitted');
  // Next sync re-fetches everything the failed run could not commit as kept.
  const again = await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage: caches });
  assert.equal(again.ok, true);
  assert.equal(await textOf(caches, MANIFEST_URL), JSON.stringify(MANIFEST));
});

await check('a file the new manifest no longer ships is dropped', async () => {
  const caches = fakeCaches();
  await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage: caches });
  const smaller = manifestFor(['/venues/p.map.json', '/venues/p.pois.json']);
  const result = await syncVenueBundle(VENUE, {
    fetchImpl: fakeFetch({ manifest: smaller }),
    cacheStorage: caches,
  });
  assert.deepEqual(result, { ok: true, fetched: 0, reused: 0, kept: 2, dropped: 1, failed: [] });
  assert.equal(await textOf(caches, '/venues/p/display/trail.style.json'), null);
  assert.equal(await textOf(caches, MANIFEST_URL), JSON.stringify(smaller));
});

await check('offline, missing manifest, and missing WebCrypto are ordinary states', async () => {
  const caches = fakeCaches();
  assert.deepEqual(
    await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage: caches, online: false }),
    { ok: false, reason: 'offline' },
  );
  assert.deepEqual(
    await syncVenueBundle(VENUE, {
      fetchImpl: fakeFetch({ down: [MANIFEST_URL] }),
      cacheStorage: caches,
    }),
    { ok: false, reason: 'offline' },
  );
  assert.deepEqual(
    await syncVenueBundle({ id: 'unknown' }, { fetchImpl: fakeFetch(), cacheStorage: caches }),
    { ok: false, reason: 'no-manifest' },
  );
  assert.deepEqual(
    await syncVenueBundle(VENUE, {
      fetchImpl: fakeFetch(),
      cacheStorage: caches,
      cryptoImpl: {},
    }),
    { ok: false, reason: 'no-crypto' },
  );
  assert.deepEqual(await syncVenueBundle(null, { fetchImpl: fakeFetch(), cacheStorage: caches }), {
    ok: false,
    reason: 'no-venue',
  });
  assert.equal(caches.stores.get(VENUE_BUNDLE_CACHE)?.entries.size ?? 0, 0, 'nothing cached');
});

/* ------------------------------------------------- service worker seams -- */

await check('sw.js names the same bundle cache and preserves it on activate', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const sw = readFileSync(path.join(root, 'apps/party-tracker/public/sw.js'), 'utf8');
  assert.ok(
    sw.includes(`const BUNDLE_CACHE = '${VENUE_BUNDLE_CACHE}';`),
    'BUNDLE_CACHE in sw.js matches VENUE_BUNDLE_CACHE',
  );
  assert.ok(
    sw.includes('k !== CACHE && k !== BUNDLE_CACHE'),
    'activate never deletes the bundle cache',
  );
  assert.ok(sw.includes(".endsWith('.bundle.json')"), 'bundle manifests are network-first');
  assert.doesNotMatch(
    sw,
    /BUNDLE_CACHE = 'tracker-__APP_VERSION__/,
    'the bundle cache name is not version-stamped',
  );
});

console.log(`\nvenue-download: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exit(1);
}
