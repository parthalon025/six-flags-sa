#!/usr/bin/env node
/**
 * lib/venue/download.js — the venue download manager's decision logic
 * (ADR-0018), pure modules in bare node with injected fetch / Cache Storage.
 *
 * The offline contract under test: bytes reach the bundle cache only after
 * their sha256 matches the manifest pin; a half-landed sync never commits
 * its manifest; bytes already on the phone are adopted without a network
 * fetch; and the service worker serves those bytes, keeps them across a
 * deploy, and stays out of the way of the fetches that build them.
 *
 *   node test/app/venue-download.test.mjs
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const {
  VENUE_BUNDLE_CACHE,
  BUNDLE_SINCE_QUERY,
  bundleUrlFor,
  bundleSyncUrl,
  hashedUrlFor,
  bundleIndexOf,
  mergeManifestDelta,
  planBundleSync,
  pyramidBandIdFromPath,
  isOptionalPyramidEntry,
  pyramidBandEntries,
  estimatePyramidBytes,
  formatBundleBytes,
  manifestFilesForScope,
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
  // The page caches by relative path and the worker caches whole Requests; the
  // browser resolves both against one origin, so they are one key. Model that,
  // or the two halves of the offline contract would never meet in here.
  const keyOf = (key) => {
    const url = typeof key === 'string' ? key : key.url;
    if (!url.startsWith('http')) return url;
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  };
  const cacheFor = () => {
    const entries = new Map();
    return {
      entries,
      async match(key) {
        return entries.get(keyOf(key));
      },
      async put(key, res) {
        entries.set(keyOf(key), res);
      },
      async delete(key) {
        return entries.delete(keyOf(key));
      },
    };
  };
  return {
    stores,
    async open(name) {
      if (!stores.has(name)) stores.set(name, cacheFor());
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
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
  const impl = async (input) => {
    // The page fetches by relative path; the worker passes the Request whose
    // url the browser already made absolute. Same origin, same served bytes.
    const raw = typeof input === 'string' ? input : input.url;
    const url = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw;
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

const PYRAMID_MANIFEST = {
  ...MANIFEST,
  files: [
    ...MANIFEST.files,
    {
      path: '/venues/p/display/overview.pmtiles',
      bytes: 1_500_000,
      sha256: sha('overview-tiles'),
    },
    {
      path: '/venues/p/display/close.pmtiles',
      bytes: 2_500_000,
      sha256: sha('close-tiles'),
    },
    {
      path: '/venues/p/display/mid.pmtiles',
      bytes: 800_000,
      sha256: sha('mid-tiles'),
    },
  ],
};

await check('pyramid helpers identify overview and close, not mid', () => {
  assert.equal(pyramidBandIdFromPath('/venues/p/display/overview.pmtiles'), 'overview');
  assert.equal(pyramidBandIdFromPath('/venues/p/display/close.pmtiles'), 'close');
  assert.equal(pyramidBandIdFromPath('/venues/p/display/mid.pmtiles'), null);
  assert.equal(isOptionalPyramidEntry(PYRAMID_MANIFEST.files.at(-2)), true);
  assert.equal(isOptionalPyramidEntry(PYRAMID_MANIFEST.files.at(-1)), false);
  assert.deepEqual(
    pyramidBandEntries(PYRAMID_MANIFEST).map((f) => f.path),
    ['/venues/p/display/overview.pmtiles', '/venues/p/display/close.pmtiles'],
  );
  assert.equal(estimatePyramidBytes(PYRAMID_MANIFEST), 4_000_000);
  assert.equal(formatBundleBytes(4_000_000), '3.8 MB');
});

await check('manifestFilesForScope splits floor from guest opt-in pyramid bands', () => {
  const floor = manifestFilesForScope(PYRAMID_MANIFEST, 'floor');
  const pyramid = manifestFilesForScope(PYRAMID_MANIFEST, 'pyramid');
  assert.ok(floor.some((f) => f.path.endsWith('mid.pmtiles')));
  assert.ok(!floor.some((f) => f.path.endsWith('overview.pmtiles')));
  assert.deepEqual(
    pyramid.map((f) => f.path),
    ['/venues/p/display/overview.pmtiles', '/venues/p/display/close.pmtiles'],
  );
});

await check('floor sync never fetches optional pyramid bands', async () => {
  const caches = fakeCaches();
  const extendedBodies = {
    ...BODIES,
    '/venues/p/display/overview.pmtiles': 'overview-bytes',
    '/venues/p/display/close.pmtiles': 'close-bytes',
  };
  const manifestWithPyramid = {
    ...MANIFEST,
    files: [
      ...MANIFEST.files,
      {
        path: '/venues/p/display/overview.pmtiles',
        bytes: extendedBodies['/venues/p/display/overview.pmtiles'].length,
        sha256: sha(extendedBodies['/venues/p/display/overview.pmtiles']),
      },
      {
        path: '/venues/p/display/close.pmtiles',
        bytes: extendedBodies['/venues/p/display/close.pmtiles'].length,
        sha256: sha(extendedBodies['/venues/p/display/close.pmtiles']),
      },
    ],
  };
  const fetchImpl = async (input) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw;
    fetchImpl.calls.push(url);
    if (url === MANIFEST_URL) {
      return new Response(JSON.stringify(manifestWithPyramid), { status: 200 });
    }
    const clean = url.split('?')[0];
    if (clean in extendedBodies) return new Response(extendedBodies[clean], { status: 200 });
    return new Response('', { status: 404 });
  };
  fetchImpl.calls = [];
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches, scope: 'floor' });
  assert.equal(result.ok, true);
  assert.equal(
    fetchImpl.calls.filter((u) => u.includes('overview.pmtiles') || u.includes('close.pmtiles')).length,
    0,
    'floor scope must not touch guest opt-in pyramid bands',
  );
});

await check('pyramid sync fetches only overview and close, and never drops the floor', async () => {
  const caches = fakeCaches();
  const extendedBodies = {
    ...BODIES,
    '/venues/p/display/overview.pmtiles': 'overview-bytes',
    '/venues/p/display/close.pmtiles': 'close-bytes',
  };
  const manifestWithPyramid = {
    ...MANIFEST,
    files: [
      ...MANIFEST.files,
      {
        path: '/venues/p/display/overview.pmtiles',
        bytes: extendedBodies['/venues/p/display/overview.pmtiles'].length,
        sha256: sha(extendedBodies['/venues/p/display/overview.pmtiles']),
      },
      {
        path: '/venues/p/display/close.pmtiles',
        bytes: extendedBodies['/venues/p/display/close.pmtiles'].length,
        sha256: sha(extendedBodies['/venues/p/display/close.pmtiles']),
      },
    ],
  };
  const makeFetch = (manifest) => {
    const calls = [];
    const impl = async (input) => {
      const raw = typeof input === 'string' ? input : input.url;
      const url = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw;
      calls.push(url);
      if (url === MANIFEST_URL) return new Response(JSON.stringify(manifest), { status: 200 });
      const clean = url.split('?')[0];
      if (clean in extendedBodies) return new Response(extendedBodies[clean], { status: 200 });
      return new Response('', { status: 404 });
    };
    impl.calls = calls;
    return impl;
  };
  await syncVenueBundle(VENUE, {
    fetchImpl: makeFetch(MANIFEST),
    cacheStorage: caches,
    scope: 'floor',
  });
  const fetchImpl = makeFetch(manifestWithPyramid);
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches, scope: 'pyramid' });
  assert.equal(result.ok, true);
  assert.equal(result.fetched, 2);
  assert.equal(await textOf(caches, '/venues/p.map.json'), BODIES['/venues/p.map.json']);
  assert.equal(
    await textOf(caches, '/venues/p/display/overview.pmtiles'),
    extendedBodies['/venues/p/display/overview.pmtiles'],
  );
});

await check('bundleSyncUrl: delta API when a revision cursor exists, static path otherwise', () => {
  assert.equal(bundleSyncUrl({ id: 'p', bundle: MANIFEST_URL }, null), MANIFEST_URL);
  const delta = bundleSyncUrl({ id: 'p', bundle: MANIFEST_URL }, 'rev-a');
  assert.match(delta, /^\/api\/venues\/p\/bundle\?/);
  assert.equal(new URLSearchParams(delta.split('?')[1]).get(BUNDLE_SINCE_QUERY), 'rev-a');
});

await check('mergeManifestDelta: overlay changed entries onto the cached full manifest', () => {
  const cached = manifestFor(['/venues/p.map.json', '/venues/p.pois.json']);
  const incoming = {
    ...cached,
    basedOn: { map: '2026-08-16', revisionId: 'rev-b' },
    files: [{ path: '/venues/p.map.json', bytes: 9, sha256: sha('{"meta":{"id":"p","v":2}}') }],
  };
  const merged = mergeManifestDelta(cached, incoming);
  assert.equal(merged.files.length, 2);
  assert.equal(merged.files.find((f) => f.path.endsWith('.map.json')).sha256, incoming.files[0].sha256);
  assert.equal(merged.files.find((f) => f.path.endsWith('.pois.json')).sha256, cached.files[1].sha256);
  assert.equal(mergeManifestDelta(null, incoming), incoming);
});

const REV_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const REV_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const MAP_V1 = '{"meta":{"id":"p","generated":"2026-08-15"}}';
const MAP_V2 = '{"meta":{"id":"p","generated":"2026-08-16"}}';
const DELTA_BODIES = {
  '/venues/p.map.json': MAP_V2,
  '/venues/p.pois.json': BODIES['/venues/p.pois.json'],
  '/venues/p/display/trail.style.json': BODIES['/venues/p/display/trail.style.json'],
};
const manifestV1 = {
  version: 1,
  venue: 'p',
  basedOn: { map: '2026-08-15', revisionId: REV_A },
  files: Object.keys(BODIES).map((p) => ({ path: p, bytes: BODIES[p].length, sha256: sha(BODIES[p]) })),
};
const manifestV2Full = {
  version: 1,
  venue: 'p',
  basedOn: { map: '2026-08-16', revisionId: REV_B },
  files: Object.keys(DELTA_BODIES).map((p) => ({
    path: p,
    bytes: DELTA_BODIES[p].length,
    sha256: sha(DELTA_BODIES[p]),
  })),
};
const manifestV2Delta = {
  ...manifestV2Full,
  files: manifestV2Full.files.filter((f) => f.path.endsWith('.map.json')),
};

function fakeFetchDelta({ deltaManifest = manifestV2Delta } = {}) {
  const calls = [];
  const impl = async (input) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = raw.startsWith('http') ? new URL(raw).pathname + new URL(raw).search : raw;
    calls.push(url);
    if (url.startsWith('/api/venues/p/bundle')) {
      return new Response(JSON.stringify(deltaManifest), { status: 200 });
    }
    if (url === MANIFEST_URL) {
      return new Response(JSON.stringify(manifestV1), { status: 200 });
    }
    const clean = url.split('?')[0];
    const body = DELTA_BODIES[clean];
    if (!body) return new Response('', { status: 404 });
    return new Response(body, { status: 200 });
  };
  impl.calls = calls;
  return impl;
}

await check('revision-cursor sync: delta manifest merges and only changed hashes are fetched', async () => {
  const caches = fakeCaches();
  const bundleCache = await caches.open(VENUE_BUNDLE_CACHE);
  await bundleCache.put(
    MANIFEST_URL,
    new Response(JSON.stringify(manifestV1), { status: 200, headers: { 'Content-Type': 'application/json' } }),
  );
  for (const [path, body] of Object.entries(BODIES)) {
    await bundleCache.put(path, new Response(body));
  }
  const fetchImpl = fakeFetchDelta();
  const result = await syncVenueBundle(VENUE, { fetchImpl, cacheStorage: caches });
  assert.equal(result.ok, true);
  assert.equal(result.fetched, 1, 'only the changed map file is re-downloaded');
  assert.equal(result.kept, 2, 'pois and display bytes already match');
  assert.match(fetchImpl.calls[0], /\/api\/venues\/p\/bundle\?since=/, 'delta API used when cache carries revisionId');
  assert.equal(await textOf(caches, '/venues/p.map.json'), MAP_V2);
  const committed = JSON.parse(await textOf(caches, MANIFEST_URL));
  assert.equal(committed.basedOn.revisionId, REV_B);
  assert.equal(committed.files.length, 3);
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

// The one seam the download manager cannot reach from here: the cache it
// writes into and the cache the service worker keeps are two separate
// declarations of one name, in two files that never import each other. Read the
// name out of sw.js rather than matching a formatted line, so this fails when
// the names diverge and not when the file is reformatted.
const SW_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../apps/party-tracker/public/sw.js',
);
const SW_ORIGIN = 'https://parkbound.test';

await check('sw.js opens the same bundle cache the download manager writes to', () => {
  const sw = readFileSync(SW_PATH, 'utf8');
  const declared = sw.match(/BUNDLE_CACHE\s*=\s*['"`]([^'"`]+)['"`]/);
  assert.ok(declared, 'sw.js declares a BUNDLE_CACHE name');
  assert.equal(declared[1], VENUE_BUNDLE_CACHE, 'sw.js and lib/venue/download.js name one cache');
});

/**
 * Evaluate sw.js with a fake `self`, `caches` and `fetch`, and hand back a way
 * to drive the listeners it registered.
 *
 * The worker is the other half of this contract and nothing imports it, so it
 * used to be checked by grepping its source for formatted lines — which broke
 * on reformatting and said nothing about what the lines did. Run it instead:
 * these checks read no source text, so whitespace is free and a deleted branch
 * is not.
 */
function loadServiceWorker({ cacheStorage, fetchImpl }) {
  const listeners = new Map();
  const self = {
    addEventListener: (type, fn) => listeners.set(type, fn),
    location: { origin: SW_ORIGIN },
    skipWaiting() {},
    clients: { claim: async () => {} },
    registration: { scope: `${SW_ORIGIN}/`, showNotification: async () => {} },
  };
  const sandbox = { self, caches: cacheStorage, fetch: fetchImpl, URL, Response, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(readFileSync(SW_PATH, 'utf8'), sandbox, { filename: 'sw.js' });

  return {
    /** Run the activate handler to completion. */
    async activate() {
      const waited = [];
      listeners.get('activate')({ waitUntil: (p) => waited.push(p) });
      await Promise.all(waited);
    },
    /** GET a path through the fetch handler; null means "left to the browser". */
    async get(pathname) {
      let answered = null;
      listeners.get('fetch')({
        request: { url: `${SW_ORIGIN}${pathname}`, method: 'GET' },
        respondWith: (r) => {
          answered = r;
        },
      });
      return answered && (await answered);
    },
  };
}

/** Let a background cache write the worker started actually land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

await check('activate keeps the venue bundle cache and sweeps what is stale', async () => {
  const cacheStorage = fakeCaches();
  // A phone that downloaded a venue, then took a deploy. The shell cache is
  // version-stamped and stale; the bundles are addressed by their sha256 pins
  // and a deploy invalidates nothing in them.
  await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage });
  const previousShell = await cacheStorage.open('tracker-0.0.1');
  await previousShell.put('/', new Response('last release'));
  const sw = loadServiceWorker({ cacheStorage, fetchImpl: fakeFetch() });

  await sw.activate();

  assert.ok(!(await cacheStorage.keys()).includes('tracker-0.0.1'), 'the stale shell is swept');
  assert.equal(
    await textOf(cacheStorage, '/venues/p.map.json'),
    BODIES['/venues/p.map.json'],
    'a downloaded venue survives the deploy that swept the shell',
  );
});

await check('verified bundle bytes answer from the bundle cache, off the network', async () => {
  const cacheStorage = fakeCaches();
  await syncVenueBundle(VENUE, { fetchImpl: fakeFetch(), cacheStorage });
  const fetchImpl = fakeFetch();
  const sw = loadServiceWorker({ cacheStorage, fetchImpl });

  const res = await sw.get('/venues/p.map.json');

  assert.equal(await res.text(), BODIES['/venues/p.map.json']);
  // This is also what proves the two cache names are one name: served from any
  // other cache the worker would revalidate, and park wifi would pay for it.
  assert.deepEqual(fetchImpl.calls, [], 'exactly-current bytes are not revalidated');
});

await check('a bundle manifest is network-first, and offline falls back to the held one', async () => {
  const held = () => new Response('{"version":"held"}');

  const online = fakeCaches();
  await (await online.open(VENUE_BUNDLE_CACHE)).put(MANIFEST_URL, held());
  const live = loadServiceWorker({ cacheStorage: online, fetchImpl: fakeFetch() });
  assert.equal(
    await (await live.get(MANIFEST_URL)).text(),
    JSON.stringify(MANIFEST),
    'the deployed manifest is the freshness point, so it outranks the held copy',
  );

  const offline = fakeCaches();
  await (await offline.open(VENUE_BUNDLE_CACHE)).put(MANIFEST_URL, held());
  const cut = loadServiceWorker({
    cacheStorage: offline,
    fetchImpl: fakeFetch({ down: [MANIFEST_URL] }),
  });
  assert.equal(
    await (await cut.get(MANIFEST_URL)).text(),
    '{"version":"held"}',
    'with the network gone the held manifest still answers',
  );
});

await check('a hash-addressed fetch goes straight to the network and is not cached', async () => {
  const cacheStorage = fakeCaches();
  const fetchImpl = fakeFetch();
  const sw = loadServiceWorker({ cacheStorage, fetchImpl });
  const hashed = hashedUrlFor(MANIFEST.files.find((f) => f.path.endsWith('.map.json')));

  const res = await sw.get(hashed);

  assert.equal(await res.text(), BODIES['/venues/p.map.json'], 'answered from the network');
  assert.deepEqual(fetchImpl.calls, [hashed]);
  await settle();
  // The download manager stores these bytes itself, under the clean path. A
  // worker that also kept them would duplicate every changed file under a hash
  // key nothing ever asks for again.
  const keys = [...cacheStorage.stores.values()].flatMap((c) => [...c.entries.keys()]);
  assert.deepEqual(keys, [], 'nothing is held under the ?v= key');
});

console.log(`\nvenue-download: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exit(1);
}
