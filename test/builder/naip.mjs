#!/usr/bin/env node
/**
 * NAIP via Microsoft Planetary Computer — STAC search, SAS signing, windowed
 * COG read (ADR-0021 clause 9, ADR-0020 clauses 1-2).
 *
 * No network: the STAC response is the committed canned fixture under
 * fixtures/naip/, the SAS endpoint and the COG are both injected fakes. The
 * load-bearing assertion is the readRasters one — `lib/adapters/cog.mjs`
 * carries a hard-won comment saying never to pass `{ bbox }` to a remote COG
 * read (it fans one small request into ~1300 internal tile fetches that die
 * under this environment's connection limits). This suite turns that comment
 * into a test.
 *
 *   node test/builder/naip.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';

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

console.log('\nnaip-planetary adapter suite\n');

const {
  ID,
  LICENSE,
  SAS_TOKEN_URL,
  STAC_SEARCH,
  PAD,
  searchUrl,
  searchItems,
  provenanceFor,
  pickItem,
  geographicToPixel,
  windowFor,
  readNaipWindow,
  sha256OfRaster,
  signHref,
  naipCacheFile,
  naipClaims,
  run,
} = await import('../../packages/venue-builder/lib/adapters/naip-planetary.mjs');

const SEARCH_FIXTURE = JSON.parse(
  readFileSync(new URL('./fixtures/naip/kings-island-stac-search.json', import.meta.url), 'utf8'),
);
const ITEM_2023 = SEARCH_FIXTURE.features[0];
const ITEM_2021 = SEARCH_FIXTURE.features[1];

/** Kings Island's published display bounds (display-certification.json). */
const KI = { west: -84.2775, south: 39.3364963, east: -84.2595, north: 39.348 };

/**
 * Four bands of four pixels. The sha256 below was computed independently
 * (node crypto over the 16 bytes R,G,B,NIR in band order) and pasted here as
 * a literal, not read back out of the adapter.
 */
const BANDS = [
  Uint8Array.from([120, 118, 96, 200]),
  Uint8Array.from([130, 128, 110, 202]),
  Uint8Array.from([90, 88, 84, 198]),
  Uint8Array.from([210, 205, 150, 120]),
];
const BANDS_SHA256 = '9a41b4f9afc419f239388c90a730a426a2b364f12a75217d4f4bd57f5b5464ab';

const TOKEN_A = 'st=2026-08-21T17%3A00%3A00Z&se=2026-08-21T17%3A45%3A00Z&sig=FIRSTsignature';
const TOKEN_B = 'st=2026-08-21T17%3A44%3A00Z&se=2026-08-21T18%3A29%3A00Z&sig=SECONDsignature';

/** Fake fetch: routes the SAS endpoint and the STAC search, records both. */
function fakeFetch({ stacBody = SEARCH_FIXTURE, tokens = [TOKEN_A, TOKEN_B], stacStatus = 200 } = {}) {
  const calls = { search: [], token: [] };
  let issued = 0;
  const fn = async (url) => {
    if (String(url).startsWith(SAS_TOKEN_URL)) {
      calls.token.push(String(url));
      const token = tokens[Math.min(issued, tokens.length - 1)];
      issued += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ 'msft:expiry': '2026-08-21T17:45:00Z', token }),
      };
    }
    calls.search.push(String(url));
    return { ok: stacStatus < 400, status: stacStatus, json: async () => stacBody };
  };
  return { fn, calls };
}

/** Fake COG: records every open and every readRasters argument object. */
function fakeCog({ width = 12500, height = 12500, bands = BANDS, forbidFirst = 0 } = {}) {
  const rec = { opens: [], reads: [] };
  const openTiff = async (url) => {
    rec.opens.push(String(url));
    if (rec.opens.length <= forbidFirst) {
      const err = new Error('Error fetching image data: 403 Forbidden');
      err.status = 403;
      throw err;
    }
    return {
      getImage: async () => ({
        getWidth: () => width,
        getHeight: () => height,
        getOrigin: () => [733200, 4360200],
        getResolution: () => [0.552, -0.552],
        readRasters: async (opts) => {
          rec.reads.push(opts);
          return bands;
        },
      }),
    };
  };
  return { openTiff, rec };
}

const scrub = (id) => {
  try {
    rmSync(new URL(`../../packages/venue-builder/data/venues/${id}`, import.meta.url), {
      recursive: true,
      force: true,
    });
  } catch {
    // best-effort cleanup
  }
};

await check('searchUrl asks the naip collection for the bbox as [west, south, east, north]', () => {
  const url = searchUrl(KI, { limit: 10 });
  assert.equal(
    url,
    'https://planetarycomputer.microsoft.com/api/stac/v1/search'
      + '?collections=naip&bbox=-84.2775,39.3364963,-84.2595,39.348&limit=10',
  );
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, STAC_SEARCH);
  assert.equal(parsed.searchParams.get('collections'), 'naip');
  // Longitude first, south-west corner first. A latitude-first box is a
  // different, plausible-looking place on earth, not an error the API raises.
  assert.deepEqual(
    parsed.searchParams.get('bbox').split(',').map(Number),
    [KI.west, KI.south, KI.east, KI.north],
  );
});

await check('searchUrl refuses bounds that are not four finite numbers', () => {
  assert.throws(() => searchUrl({ west: -84.2775, south: 39.33, east: -84.25 }), /north/);
  assert.throws(() => searchUrl({ ...KI, west: NaN }), /west/);
});

await check('searchItems returns every item in the canned STAC response', async () => {
  const { fn, calls } = fakeFetch();
  const { url, items } = await searchItems(KI, { fetchFn: fn, limit: 10 });
  assert.equal(items.length, 2, 'the canned response carries two NAIP items');
  assert.deepEqual(items.map((i) => i.id), [
    'oh_m_3908427_sw_16_060_20230716',
    'oh_m_3908427_sw_16_100_20210625',
  ]);
  assert.equal(calls.search.length, 1, 'one search request, not one per item');
  assert.equal(calls.search[0], url);
  assert.equal(url, searchUrl(KI, { limit: 10 }));
  assert.equal(calls.token.length, 0, 'STAC search itself is anonymous — no SAS token needed');
});

await check('provenanceFor pins source, capture date, gsd and licence class', () => {
  const p = provenanceFor(ITEM_2023);
  assert.equal(p.source, 'planetary-computer:naip');
  assert.equal(p.tile, 'oh_m_3908427_sw_16_060_20230716');
  assert.equal(p.captured, '2023-07-16');
  assert.equal(p.gsd, 0.6);
  assert.equal(p.license, 'public-domain');
  assert.equal(LICENSE, 'public-domain');
  assert.equal(p.epsg, 26916);
  assert.equal(
    p.href,
    'https://naipeuwest.blob.core.windows.net/naip/v002/oh/2023/oh_060cm_2023/39084/m_3908427_sw_16_060_20230716.tif',
    'the pinned href is the unsigned one — a SAS token is a credential and expires',
  );
  // The 1 m 2021 capture is the same tile, a different vintage.
  assert.equal(provenanceFor(ITEM_2021).captured, '2021-06-25');
  assert.equal(provenanceFor(ITEM_2021).gsd, 1);
});

await check('pickItem takes the most recent capture that fully covers the venue', () => {
  const best = pickItem(SEARCH_FIXTURE.features, KI);
  assert.equal(best.item.id, 'oh_m_3908427_sw_16_060_20230716');
  assert.equal(best.complete, true);
  // Order in the response must not decide it.
  const reversed = pickItem([...SEARCH_FIXTURE.features].reverse(), KI);
  assert.equal(reversed.item.id, 'oh_m_3908427_sw_16_060_20230716');
  assert.equal(pickItem([], KI), null);
});

await check('windowFor computes the pixel window by arithmetic off the item footprint', () => {
  // The fixture item's footprint spans 0.08 deg of longitude over 12500 px
  // (156250 px/deg) and 0.0625 deg of latitude over 12500 px (200000 px/deg),
  // with its NW corner at (-84.291234, 39.372347). So:
  //   west  col = (-84.2775  + 84.291234) * 156250 = 0.013734  * 156250 = 2145.9375
  //   east  col = (-84.2595  + 84.291234) * 156250 = 0.031734  * 156250 = 4958.4375
  //   north row = ( 39.372347 - 39.348   ) * 200000 = 0.024347  * 200000 = 4869.4
  //   south row = ( 39.372347 - 39.3364963)* 200000 = 0.0358507 * 200000 = 7170.14
  // floor/ceil outward, then PAD (8 px) on each side:
  //   left 2145-8=2137 · right 4959+8=4967 · top 4869-8=4861 · bottom 7171+8=7179
  assert.equal(PAD, 8);
  const win = windowFor(ITEM_2023, KI);
  assert.equal(win.left, 2137);
  assert.equal(win.top, 4861);
  assert.equal(win.right, 4967);
  assert.equal(win.bottom, 7179);
  assert.equal(win.width, 2830, '4967 - 2137');
  assert.equal(win.height, 2318, '7179 - 4861');
  assert.equal(win.complete, true);
  // Cross-check against the ground: the venue box is ~1550 m x 1272 m, so
  // 2830 x 2318 px is ~0.55 m per pixel — the 60 cm product, as claimed.
  assert.ok(Math.abs(1550 / win.width - 0.55) < 0.02, 'x ground sample distance ~0.55 m');
  assert.ok(Math.abs(1272 / win.height - 0.55) < 0.02, 'y ground sample distance ~0.55 m');
});

await check('windowFor follows the tile rotation instead of lerping across its bbox', () => {
  // A NAIP quad is square in UTM metres, so its WGS84 footprint is a rotated
  // quadrilateral. This one is rotated by the 3-4-5 angle (cos 0.8, sin 0.6):
  // the +col axis runs 0.1 deg along (0.8, 0.6) from the NW corner, the +row
  // axis 0.1 deg along (0.6, -0.8), over 10000 x 10000 px = 100000 px/deg of
  // tile axis. A point's column is therefore 100000*(0.8*dLng + 0.6*dLat) and
  // its row 100000*(0.6*dLng - 0.8*dLat), measured from the NW corner.
  const rotated = {
    id: 'rotated-quad',
    geometry: {
      type: 'Polygon',
      // Deliberately not in corner order — the corners are identified by
      // position, because STAC ring order is not guaranteed.
      coordinates: [[[-84.24, 39.32], [-84.16, 39.38], [-84.22, 39.46], [-84.30, 39.40], [-84.24, 39.32]]],
    },
    properties: { 'proj:shape': [10000, 10000] },
    assets: { image: { href: 'https://example.invalid/rotated.tif' } },
  };
  const map = geographicToPixel(rotated);
  assert.deepEqual(map.nw, [-84.30, 39.40], 'NW corner picked by position, not ring order');
  assert.deepEqual(map.ne, [-84.22, 39.46]);
  assert.deepEqual(map.sw, [-84.24, 39.32]);
  const [neCol, neRow] = map.toPixel(-84.22, 39.46);
  assert.ok(Math.abs(neCol - 10000) < 1e-6 && Math.abs(neRow) < 1e-6, 'NE corner lands on (width, 0)');
  const [swCol, swRow] = map.toPixel(-84.24, 39.32);
  assert.ok(Math.abs(swCol) < 1e-6 && Math.abs(swRow - 10000) < 1e-6, 'SW corner lands on (0, height)');

  const box = { west: -84.260005, east: -84.250005, north: 39.390005, south: 39.380005 };
  // Corners, by the arithmetic above: (2599.9, 3199.3) (3399.9, 3799.3)
  // (2799.9, 4599.3) (1999.9, 3999.3) -> cols 1999.9..3399.9, rows 3199.3..4599.3.
  const win = windowFor(rotated, box);
  assert.deepEqual([win.left, win.top, win.right, win.bottom], [1991, 3191, 3408, 4608]);
  assert.equal(win.width, 1417);
  assert.equal(win.height, 1417);

  // Lerping across the item's *bounding box* (lng -84.30..-84.16, lat
  // 39.32..39.46) would put the left edge at ~2857 and the top at ~5000 —
  // hundreds of pixels, ~500 m, from the truth. That is the bug this guards.
  const naiveLeft = ((box.west - -84.30) / 0.14) * 10000;
  const naiveTop = ((39.46 - box.north) / 0.14) * 10000;
  assert.ok(Math.abs(naiveLeft - 1999.9) > 800, `naive bbox lerp gives ${naiveLeft}`);
  assert.ok(Math.abs(naiveTop - 3199.3) > 800, `naive bbox lerp gives ${naiveTop}`);
});

await check('windowFor flags a venue that runs off the tile as incomplete', () => {
  // Nudge the box west of the fixture tile's own west edge (-84.291234).
  const straddling = { ...KI, west: -84.30 };
  const win = windowFor(ITEM_2023, straddling);
  assert.equal(win.complete, false);
  assert.equal(win.left, 0, 'clamped to the tile, never negative');
  assert.throws(
    () => windowFor(ITEM_2023, { west: -85.1, east: -85.0, north: 39.35, south: 39.34 }),
    /outside/,
  );
});

await check('readNaipWindow makes exactly one readRasters call, with {window} and never {bbox}', async () => {
  const { fn, calls } = fakeFetch();
  const { openTiff, rec } = fakeCog();
  const read = await readNaipWindow(ITEM_2023, KI, { openTiff, fetchFn: fn });

  assert.equal(rec.reads.length, 1, 'one windowed range read for the whole venue');
  const [opts] = rec.reads;
  assert.ok(opts && typeof opts === 'object', 'readRasters was called with an options object');
  assert.ok(Object.hasOwn(opts, 'window'), 'readRasters must be passed { window }');
  assert.equal(Object.hasOwn(opts, 'bbox'), false, 'readRasters must never be passed { bbox }');
  assert.equal(opts.bbox, undefined);
  assert.deepEqual(opts.window, [2137, 4861, 4967, 7179]);

  assert.equal(rec.opens.length, 1);
  assert.equal(calls.token.length, 1, 'one signing for one asset read');
  assert.equal(
    rec.opens[0],
    signHref(ITEM_2023.assets.image.href, TOKEN_A),
    'the COG is opened at the SAS-signed href',
  );
  assert.ok(rec.opens[0].includes('?st=') && rec.opens[0].includes('sig=FIRSTsignature'));
  assert.equal(read.bands.length, 4, 'NAIP is RGB + NIR');
  assert.equal(read.signings, 1);
});

await check('readNaipWindow refuses a COG whose pixel shape disagrees with the STAC item', async () => {
  const { fn } = fakeFetch();
  const { openTiff } = fakeCog({ width: 6900, height: 6900 });
  await assert.rejects(
    () => readNaipWindow(ITEM_2023, KI, { openTiff, fetchFn: fn }),
    /6900.*12500|12500/,
  );
});

await check('one 403 triggers exactly one re-sign, then the read succeeds', async () => {
  // A SAS token lives ~45 minutes; a long bake can outlive one mid-flight.
  const { fn, calls } = fakeFetch();
  const { openTiff, rec } = fakeCog({ forbidFirst: 1 });
  const read = await readNaipWindow(ITEM_2023, KI, { openTiff, fetchFn: fn });

  assert.equal(calls.token.length, 2, 'exactly one re-sign after the 403');
  assert.equal(rec.opens.length, 2);
  assert.equal(rec.opens[0], signHref(ITEM_2023.assets.image.href, TOKEN_A));
  assert.equal(rec.opens[1], signHref(ITEM_2023.assets.image.href, TOKEN_B), 're-opened with a fresh token');
  assert.notEqual(rec.opens[0], rec.opens[1]);
  assert.equal(rec.reads.length, 1, 'the failed open never reached readRasters');
  assert.deepEqual(rec.reads[0].window, [2137, 4861, 4967, 7179]);
  assert.equal(read.signings, 2);
});

await check('a second 403 after the re-sign is surfaced, not retried forever', async () => {
  const { fn, calls } = fakeFetch();
  const { openTiff, rec } = fakeCog({ forbidFirst: 99 });
  await assert.rejects(() => readNaipWindow(ITEM_2023, KI, { openTiff, fetchFn: fn }), /403/);
  assert.equal(calls.token.length, 2, 'signed once, re-signed once, then gave up');
  assert.equal(rec.opens.length, 2);
});

await check('a non-403 failure is not re-signed at all', async () => {
  const { fn, calls } = fakeFetch();
  const openTiff = async () => {
    throw new Error('getaddrinfo ENOTFOUND naipeuwest.blob.core.windows.net');
  };
  await assert.rejects(() => readNaipWindow(ITEM_2023, KI, { openTiff, fetchFn: fn }), /ENOTFOUND/);
  assert.equal(calls.token.length, 1, 'a DNS failure is not a stale signature');
});

await check('signHref appends the token to whatever query the href already has', () => {
  assert.equal(signHref('https://host/x.tif', 'st=A&sig=B'), 'https://host/x.tif?st=A&sig=B');
  // PC's own rendered_preview hrefs already carry a query string.
  assert.equal(signHref('https://host/x.tif?a=1', 'st=A&sig=B'), 'https://host/x.tif?a=1&st=A&sig=B');
});

await check('sha256OfRaster hashes the band bytes in order', () => {
  assert.equal(sha256OfRaster(BANDS), BANDS_SHA256);
  // Same bytes, different band order — a different pin.
  assert.notEqual(sha256OfRaster([BANDS[1], BANDS[0], BANDS[2], BANDS[3]]), BANDS_SHA256);
  // A typed-array view into a larger buffer must hash its own bytes only.
  const backing = new Uint8Array([9, 9, 120, 118, 96, 200, 9]);
  const view = backing.subarray(2, 6);
  assert.equal(sha256OfRaster([view, BANDS[1], BANDS[2], BANDS[3]]), BANDS_SHA256);
});

await check('run() caches full provenance for a venue bbox and never writes the SAS token', async () => {
  const id = '__test-naip__';
  scrub(id);
  const { fn, calls } = fakeFetch();
  const { openTiff, rec } = fakeCog();
  const res = await run({ venueId: id, bounds: KI }, { openTiff, fetchFn: fn });

  assert.equal(res.ok, true, res.error || '');
  assert.equal(res.adapterId, ID);
  assert.equal(res.adapterId, 'naip-planetary');
  assert.equal(rec.reads.length, 1, 'run() reads the window once');
  assert.equal(Object.hasOwn(rec.reads[0], 'bbox'), false);

  assert.ok(existsSync(naipCacheFile(id)), 'cache file must be written');
  const raw = readFileSync(naipCacheFile(id), 'utf8');
  const cached = JSON.parse(raw);
  assert.equal(cached.source, 'planetary-computer:naip');
  assert.equal(cached.tile, 'oh_m_3908427_sw_16_060_20230716');
  assert.equal(cached.captured, '2023-07-16');
  assert.equal(cached.gsd, 0.6);
  assert.equal(cached.license, 'public-domain');
  assert.equal(cached.sha256, BANDS_SHA256);
  assert.equal(cached.bandCount, 4);
  assert.equal(cached.itemCount, 2);
  assert.equal(cached.complete, true);
  assert.deepEqual(cached.window, { left: 2137, top: 4861, width: 2830, height: 2318 });
  assert.deepEqual(cached.bounds, KI);

  assert.equal(calls.token.length, 1);
  assert.equal(raw.includes('sig=FIRSTsignature'), false, 'a SAS token is a credential — never cached');
  assert.equal(raw.includes('st=2026'), false);

  assert.equal(res.claims.length, 1);
  assert.equal(res.claims[0].source, 'aerial');
  assert.equal(res.claims[0].date, '2023-07-16');
  assert.ok(res.claims[0].note.includes('oh_m_3908427_sw_16_060_20230716'));

  // Offline replays the ledger row without touching the network at all.
  const offline = await run({ venueId: id, offline: true }, {
    openTiff: async () => { throw new Error('offline must not open a COG'); },
    fetchFn: async () => { throw new Error('offline must not fetch'); },
  });
  assert.equal(offline.ok, true);
  assert.equal(offline.data.sha256, BANDS_SHA256);
  scrub(id);
});

await check('run() requires a venueId, and gaps rather than throwing without bounds', async () => {
  const res = await run({});
  assert.equal(res.ok, false);
  assert.equal(res.error, 'venueId_required');

  const id = '__test-naip-nobounds__';
  scrub(id);
  const gapped = await run({ venueId: id }, {
    openTiff: async () => { throw new Error('must not open a COG without bounds'); },
    fetchFn: async () => { throw new Error('must not search without bounds'); },
  });
  assert.equal(gapped.ok, false);
  assert.equal(gapped.meta.gap, true);
  assert.ok(gapped.error.includes('bounds'));
  scrub(id);
});

await check('run() gaps when the STAC search finds no NAIP item over the venue', async () => {
  const id = '__test-naip-empty__';
  scrub(id);
  const { fn } = fakeFetch({ stacBody: { type: 'FeatureCollection', features: [] } });
  const res = await run({ venueId: id, bounds: KI }, {
    openTiff: async () => { throw new Error('must not open a COG with no item'); },
    fetchFn: fn,
  });
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.match(res.error, /no NAIP/i);
  scrub(id);
});

/* ------------------------------------------------------------------ wiring --
 * The adapter above is only reachable if the registry carries a row for the id,
 * implementations.mjs maps that id to this run(), and the sync catalogue knows
 * it. These checks go through `runAdapter` — the seam the build pipeline calls
 * — rather than importing the adapter, so a registry row that resolves to
 * defineAdapter's placeholder still fails.
 */

const { getAdapter } = await import('../../packages/venue-builder/lib/adapters/index.mjs');
const { getAdapterImplementation } = await import(
  '../../packages/venue-builder/lib/adapters/implementations.mjs'
);
const { runAdapter } = await import('../../packages/venue-builder/lib/adapters/runner.mjs');
const { adapterCacheFile } = await import('../../packages/venue-builder/lib/adapters/_cache.mjs');
const { WEIGHTS } = await import('../../packages/venue-builder/lib/evidence.mjs');
const { KNOWN_EXTERNAL_ADAPTER_IDS, DEFAULT_EXTERNAL_ADAPTERS, readSources } = await import(
  '../../packages/venue-builder/lib/venue-sources.mjs'
);

await check('the registry files NAIP as Truth-layer aerial under an existing licence class', () => {
  const row = getAdapter('naip-planetary');
  assert.ok(row, 'no registry row — runAdapter answers unknown_adapter without one');
  assert.equal(row.id, ID);
  // `vision`, not `display`: registry.mjs throws on a display row carrying
  // evidence_sources, and this row does carry them.
  assert.equal(row.stage, 'vision');
  assert.deepEqual(row.evidence_sources, ['aerial']);
  // ADR-0020 clause 2 — derivation-licensed public domain, commercial fine.
  assert.equal(row.license, 'public-domain');
  assert.equal(row.license, LICENSE, 'the row and the ledger row the adapter writes must agree');
  assert.equal(row.commercial_ok, true);
  // Not a new licence class: rows carried this exact string before NAIP
  // existed, so no allowed-licence list widened to admit it.
  assert.equal(getAdapter('usgs-3dep').license, 'public-domain');
  // `reject` is refused by runAdapter with error 'license_rejected'.
  assert.equal(row.adopt, 'wrap');
});

await check('the row reuses the existing `aerial` evidence weight and mints none', () => {
  const row = getAdapter('naip-planetary');
  assert.equal(WEIGHTS.aerial, 4, 'aerial already resolved to 4 before this adapter existed');
  for (const source of row.evidence_sources) {
    assert.ok(Object.hasOwn(WEIGHTS, source), `evidence source '${source}' has no weight`);
  }
  // The claim the adapter emits keys the same weight the row advertises.
  const claim = naipClaims(
    { sha256: 'abc', tile: 'oh_m_3908427_sw_16_060_20230716', gsd: 0.6, captured: '2023-07-16', complete: true },
    { lat: 39.34224815, lng: -84.2685 },
  )[0];
  assert.equal(claim.source, 'aerial');
  assert.ok(row.evidence_sources.includes(claim.source));
  assert.equal(Object.hasOwn(WEIGHTS, 'naip'), false, 'no NAIP-specific weight was minted');
  assert.equal(Object.hasOwn(WEIGHTS, 'naip_aerial'), false);
});

await check('runAdapter resolves the id to this adapter, offline, without a network call', async () => {
  const id = '__test-naip-wired__';
  scrub(id);
  // A ledger row written by hand, not replayed out of the adapter: every value
  // here is a literal this suite already pins.
  mkdirSync(path.dirname(naipCacheFile(id)), { recursive: true });
  writeFileSync(
    naipCacheFile(id),
    `${JSON.stringify({
      fetched: '2026-08-21',
      source: 'planetary-computer:naip',
      tile: 'oh_m_3908427_sw_16_060_20230716',
      captured: '2023-07-16',
      gsd: 0.6,
      license: 'public-domain',
      sha256: BANDS_SHA256,
      bandCount: 4,
      complete: true,
      bounds: KI,
    }, null, 2)}\n`,
  );

  const realFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = async (url) => {
    fetches += 1;
    throw new Error(`no network in this suite — something fetched ${url}`);
  };
  let res;
  try {
    res = await runAdapter('naip-planetary', { venueId: id, offline: true });
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.notEqual(res.error, 'unknown_adapter', 'the registry does not know this id');
  assert.notEqual(res.error, 'license_rejected');
  // defineAdapter's placeholder answers `not_implemented`; the real run() does not.
  assert.notEqual(res.error, 'not_implemented', 'the id resolved to the registry stub, not the adapter');
  assert.equal(res.ok, true, res.error || '');
  assert.equal(res.adapterId, 'naip-planetary');
  assert.equal(res.data.sha256, BANDS_SHA256, 'the pinned ledger row, replayed through the runner');
  assert.equal(res.data.tile, 'oh_m_3908427_sw_16_060_20230716');
  assert.equal(res.claims.length, 1);
  assert.equal(res.claims[0].source, 'aerial');
  assert.equal(res.claims[0].date, '2023-07-16');
  // Centre of the pinned bounds, by hand: (39.348 + 39.3364963) / 2 and
  // (-84.2595 + -84.2775) / 2.
  assert.deepEqual(res.claims[0].at, { lat: 39.34224815, lng: -84.2685 });
  assert.ok(res.claims[0].note.includes('oh_m_3908427_sw_16_060_20230716'));
  assert.equal(fetches, 0, 'an offline replay must not touch the network');
  scrub(id);
});

await check('naip-planetary is opt-in: known to sync, absent from every scaffolded default', () => {
  assert.ok(KNOWN_EXTERNAL_ADAPTER_IDS.includes('naip-planetary'), 'sync drops ids it does not know');
  assert.equal(typeof getAdapterImplementation('naip-planetary'), 'function');
  // ADR-0020 clause 5: registering a source must not move a Place. The offline
  // scaffold list is what it was before this row landed, so no venue gains an
  // evidence source by being rebuilt.
  assert.deepEqual(DEFAULT_EXTERNAL_ADAPTERS, [
    'parks-api',
    'queue-times',
    'wikidata',
    'rcdb',
    'open-meteo',
    'openhistoricalmap',
    'project-sidewalk',
    'esa-worldcover',
  ]);
  assert.equal(DEFAULT_EXTERNAL_ADAPTERS.includes('naip-planetary'), false);
  // Nor does any venue already shipping declare it.
  for (const venue of ['kings-island', 'cedar-point', 'six-flags-fiesta-texas', 'big-kahunas']) {
    const declared = readSources(venue).data?.datasets?.external || [];
    assert.equal(declared.includes('naip-planetary'), false, `${venue} declares naip-planetary`);
  }
  // Certification resolves a declared adapter's cache by registry id; the
  // adapter writes its own path. They must be the same file.
  assert.equal(adapterCacheFile('kings-island', 'naip-planetary'), naipCacheFile('kings-island'));
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
