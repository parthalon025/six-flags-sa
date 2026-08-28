#!/usr/bin/env node
/**
 * Imagery tile ledger — ADR-0020 clause 1 (every imagery claim carries source
 * tile, capture date, sha256 and licence class) and clause 2 (derivation-
 * licensed sources only; Google, Bing and Esri basemaps rejected for
 * derivation — "viewable is not derivable").
 *
 * No network. The drift assertions run against real bytes this suite writes
 * into its own mkdtemp directory and hashes with node:crypto, never with a
 * helper borrowed from the module under test; the two literal digests below
 * were computed independently and pasted in.
 *
 *   node test/builder/imagery-ledger.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

console.log('\nimagery-ledger\n');

const {
  IMAGERY_LEDGER_FILE,
  DERIVATION_LICENSES,
  REJECTED_FOR_DERIVATION,
  readImageryLedger,
  rejectedVendor,
  rowProblems,
  verifyImageryLedger,
  verifyImageryBytes,
  tileIdFor,
  claimCoverage,
  IMAGERY_EVIDENCE_CLASSES,
  imagerySignedFeatures,
  venueImageryCoverage,
} = await import('../../packages/venue-builder/lib/imagery-ledger.mjs');
const { WEIGHTS } = await import('../../packages/venue-builder/lib/evidence.mjs');

/**
 * Known-answer fixtures. `TILE_BYTES` is 28 bytes of ASCII; `TILE_SHA` is
 * sha256 over exactly those bytes, computed in a separate node process and
 * pasted here as a literal. `OTHER_SHA` is sha256 over the ten bytes 0x00..0x09
 * — a real digest of different content, so the drift case is a genuine
 * mismatch rather than a malformed string.
 */
const TILE_BYTES = Buffer.from('imagery-ledger-fixture-tile\n', 'utf8');
const TILE_SHA = '4c99ba7abe6c3293c928c8c74aaaa8ab1574e99e3e60e0b89f3a600486e9b7f3';
const OTHER_SHA = '1f825aa2f0020ef7cf91dfa30da4668d791c5d4824fc8e41354b89ec05795ab3';

/** A row that satisfies clauses 1 and 2 — the shape everything else deviates from. */
const goodRow = (over = {}) => ({
  id: 'naip-fixture-2023',
  label: 'NAIP fixture quarter-quad',
  source: 'planetary-computer:naip',
  tile: 'oh_m_3908417_ne_17_060_20230716',
  captured: '2023-07-16',
  sha256: TILE_SHA,
  license: 'public-domain',
  served_via: 'Microsoft Planetary Computer',
  ...over,
});

const joined = (problems) => problems.join(' | ');

// ---------------------------------------------------------------- coverage

await check('a claim whose tile is absent from the ledger is not covered', () => {
  const ledger = { 'naip-fixture-2023': goodRow() };
  const cover = claimCoverage(
    { n: 'Ghost boardwalk', src: { by: 'aerial', source: 'ghost-ortho-2099' } },
    ledger,
  );
  assert.equal(cover.ok, false, 'an unledgered tile must not be covered');
  assert.equal(cover.row, null, 'there is no row to hand back');
  assert.match(
    joined(cover.problems),
    /ghost-ortho-2099/,
    'the problem must name the tile the claim asked for',
  );
  assert.match(joined(cover.problems), /not in the imagery ledger/);
  return true;
});

await check('a claim naming no tile at all is not covered', () => {
  // `naipClaims` builds {source: 'aerial', kind: 'metadata', ...} where
  // `source` is the evidence class, not a tile id. Reading that as a tile id
  // would look up a ledger row called "aerial" and report a confusing miss.
  const cover = claimCoverage({ source: 'aerial', kind: 'metadata' }, { 'naip-fixture-2023': goodRow() });
  assert.equal(tileIdFor({ source: 'aerial', kind: 'metadata' }), null);
  assert.equal(cover.ok, false);
  assert.match(joined(cover.problems), /names no imagery tile/);
  return true;
});

await check('a well-formed row is admissible and covers its claim', () => {
  const ledger = { 'naip-fixture-2023': goodRow() };
  assert.deepEqual(rowProblems(goodRow()), [], 'the reference row must raise nothing');
  const cover = claimCoverage(
    { n: 'Midway edge', src: { by: 'aerial', source: 'naip-fixture-2023' } },
    ledger,
  );
  assert.equal(cover.ok, true, 'the gate must not be always-red');
  assert.equal(cover.tile, 'naip-fixture-2023');
  assert.equal(cover.row.captured, '2023-07-16');
  assert.deepEqual(cover.problems, []);
  return true;
});

// ------------------------------------------------------------ licence class

await check('a licence class outside the derivation-licensed set fails', () => {
  assert.ok(!DERIVATION_LICENSES.includes('all-rights-reserved'));
  const problems = rowProblems(goodRow({ license: 'all-rights-reserved' }));
  assert.match(joined(problems), /all-rights-reserved/);
  assert.match(joined(problems), /not derivation-licensed/);
  // and a row that records no class at all is not silently allowed through
  assert.match(joined(rowProblems(goodRow({ license: null }))), /no licence class/);
  return true;
});

await check('Esri specifically fails, whatever licence class the row claims', () => {
  assert.ok(REJECTED_FOR_DERIVATION.includes('esri'), 'clause 2 names Esri');
  assert.equal(rejectedVendor('Esri World Imagery'), 'esri');
  assert.equal(rejectedVendor('Google Satellite'), 'google');
  assert.equal(rejectedVendor('Bing Aerial'), 'bing');
  assert.equal(rejectedVendor('Microsoft Planetary Computer'), null, 'PC is not a rejected basemap');

  // The load-bearing case: a licence class that IS allowed, served through a
  // channel clause 2 rejects. Gating on licence alone would wave this through.
  const row = goodRow({ license: 'public-domain', served_via: 'Esri World Imagery' });
  const problems = rowProblems(row);
  assert.ok(problems.length > 0, 'an Esri-served row must not be admissible');
  assert.match(joined(problems), /Esri World Imagery/);
  assert.match(joined(problems), /clause 2/);
  assert.equal(
    joined(problems).includes('not derivation-licensed'),
    false,
    'this row fails on the serving channel, not on its licence class',
  );
  return true;
});

// -------------------------------------------------------------- sha256 pin

await check('a tile whose recorded sha256 does not match its bytes fails', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'imagery-ledger-'));
  writeFileSync(path.join(dir, 'tile.bin'), TILE_BYTES);

  // Sanity: the pasted literal really is the digest of the bytes on disk.
  const onDisk = createHash('sha256').update(readFileSync(path.join(dir, 'tile.bin'))).digest('hex');
  assert.equal(onDisk, TILE_SHA, 'known-answer digest must match the bytes this test wrote');

  const pinned = { 'naip-fixture-2023': goodRow({ path: 'tile.bin', sha256: TILE_SHA }) };
  assert.deepEqual(
    verifyImageryBytes(pinned, { root: dir }).problems,
    [],
    'a matching pin must verify clean',
  );

  // Same bytes, a digest of different content pinned against them.
  const wrongPin = { 'naip-fixture-2023': goodRow({ path: 'tile.bin', sha256: OTHER_SHA }) };
  const wrongProblems = verifyImageryBytes(wrongPin, { root: dir }).problems;
  assert.equal(wrongProblems.length, 1, 'exactly the drifting row must be reported');
  assert.match(joined(wrongProblems), /naip-fixture-2023/);
  assert.match(joined(wrongProblems), /sha256 drift/);

  // Same pin, bytes changed underneath it — the drift direction that actually
  // happens when a source re-publishes a tile.
  appendFileSync(path.join(dir, 'tile.bin'), Buffer.from([0xff]));
  const driftProblems = verifyImageryBytes(pinned, { root: dir }).problems;
  assert.equal(driftProblems.length, 1);
  assert.match(joined(driftProblems), /sha256 drift/);

  // And bytes that are simply not there.
  const missing = { 'naip-fixture-2023': goodRow({ path: 'absent.bin', sha256: TILE_SHA }) };
  assert.match(joined(verifyImageryBytes(missing, { root: dir }).problems), /missing bytes at absent\.bin/);
  return true;
});

await check('a row with no sha256 at all is inadmissible under clause 1', () => {
  assert.match(joined(rowProblems(goodRow({ sha256: null }))), /no sha256/);
  assert.match(joined(rowProblems(goodRow({ captured: null }))), /no capture date/);
  assert.match(joined(rowProblems(goodRow({ served_via: null }))), /no serving channel/);
  assert.match(joined(rowProblems(goodRow({ source: null }))), /no source/);
  return true;
});

await check("the NAIP adapter's licence constant clears this gate", async () => {
  // The one imagery adapter that exists ships `LICENSE = 'public-domain'`.
  // If either constant drifts out from under the other, every row that
  // adapter could ever write becomes inadmissible and no NAIP claim can be
  // covered — a break that would otherwise surface only at harvest time.
  const naip = await import('../../packages/venue-builder/lib/adapters/naip-planetary.mjs');
  assert.ok(
    DERIVATION_LICENSES.includes(naip.LICENSE),
    `naip-planetary ships license "${naip.LICENSE}", which this ledger would reject`,
  );
  return true;
});

// -------------------------------------------------- the shipped ledger today

await check('the shipped ledger carries the live Okaloosa row without exempting it', () => {
  const ledger = readImageryLedger(IMAGERY_LEDGER_FILE);
  const row = ledger['okaloosa-ortho-2025'];
  assert.ok(row, 'the tile big-kahunas imagery is stamped with must be in the ledger');
  assert.equal(row.served_via, 'Esri World Imagery', 'recorded exactly as sources.json stamps it');

  const problems = verifyImageryLedger(ledger);
  assert.match(joined(problems), /okaloosa-ortho-2025/, 'the ledger must report its own unadjudicated row');
  assert.match(joined(problems), /Esri World Imagery/);
  assert.match(joined(problems), /clause 2/);
  return true;
});

await check('every shipped big-kahunas imagery feature joins to that same tile', () => {
  const collection = JSON.parse(
    readFileSync(
      new URL('../../packages/venue-builder/data/venues/big-kahunas/imagery.geojson', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(collection.properties.imagery.served_via, 'Microsoft Planetary Computer');
  assert.ok(collection.features.length > 0);

  const ledger = readImageryLedger(IMAGERY_LEDGER_FILE);
  for (const feature of collection.features) {
    const cover = claimCoverage(feature.properties, ledger);
    assert.equal(cover.tile, 'fl_m_3008637_sw_16_060_20220123', `${feature.properties.n} should join to the ledgered NAIP tile`);
    assert.equal(cover.ok, true, `${feature.properties.n} is covered by the admissible NAIP row`);
  }
  return true;
});

// ------------------------------------------ the bundle, and the gate over it

/**
 * A bundle in the shape venue-certify holds one: `<id>.map.json` is layer
 * arrays keyed by layer name, `<id>.pois.json` is a flat array of places.
 */
const bundle = () => ({
  map: {
    meta: { name: 'test' },
    path: [
      { n: 'osm footway', r: [[0, 0], [1, 1]] },
      { n: 'ortho deck', r: [[0, 0], [1, 1]], src: { by: 'aerial', source: 'naip-fixture-2023' } },
      { n: 'ortho bridge', r: [[0, 0], [1, 1]], src: { by: 'aerial', source: 'naip-fixture-2023' } },
      { n: 'guest-map walk', r: [[0, 0], [1, 1]], src: { by: 'traced', source: 'park-map-2026' } },
    ],
    boundary: [[0, 0], [1, 1]],
  },
  pois: [
    { n: 'Slide', c: 'ride', lat: 1, lng: 2, src: { by: 'aerial', source: 'naip-fixture-2023' } },
    { n: 'Cafe', c: 'food', lat: 1, lng: 2 },
  ],
});

await check('only imagery-signed geometry is imagery evidence', () => {
  assert.ok(
    IMAGERY_EVIDENCE_CLASSES.every((c) => c in WEIGHTS),
    'imagery classes must be evidence.mjs WEIGHTS keys, not a parallel vocabulary: '
      + IMAGERY_EVIDENCE_CLASSES.filter((c) => !(c in WEIGHTS)).join(', '),
  );
  const { map, pois } = bundle();
  const found = imagerySignedFeatures(map, pois);
  assert.ok(!found.some((f) => f.n === 'osm footway'), 'unsigned OSM geometry claims nothing');
  assert.ok(
    !found.some((f) => f.src?.by === 'traced'),
    'a guest map traced onto a fit is evidence, but it is not imagery this repo derived from',
  );
  assert.equal(found.length, 3, `two paths and one place, got ${found.map((f) => f.n).join(', ')}`);
  return true;
});

await check('a bundle that derives nothing from imagery reports no features', () => {
  const cover = venueImageryCoverage({
    map: { path: [{ n: 'osm footway', r: [[0, 0]] }], boundary: [[0, 0]] },
    pois: [{ n: 'Cafe', c: 'food', lat: 1, lng: 2 }],
    ledger: {},
  });
  assert.deepEqual(cover, { features: 0, tiles: [], covered: 0, problems: [] });
  return true;
});

await check('shipped geometry resting on an admissible tile is covered', () => {
  const { map, pois } = bundle();
  const cover = venueImageryCoverage({ map, pois, ledger: { 'naip-fixture-2023': goodRow() } });
  assert.equal(cover.features, 3, 'every signed feature is counted, not just the distinct tiles');
  assert.deepEqual(cover.tiles, ['naip-fixture-2023'], 'three features, one tile');
  assert.equal(cover.covered, 1);
  assert.deepEqual(cover.problems, []);
  return true;
});

await check('shipped geometry resting on an inadmissible tile is not covered', () => {
  const { map, pois } = bundle();
  const cover = venueImageryCoverage({
    map,
    pois,
    ledger: { 'naip-fixture-2023': goodRow({ served_via: 'Esri World Imagery' }) },
  });
  assert.equal(cover.covered, 0);
  assert.match(joined(cover.problems), /naip-fixture-2023/);
  assert.match(joined(cover.problems), /Esri World Imagery/);
  assert.equal(
    cover.problems.length,
    1,
    `one bad tile is one finding however many features rest on it, got: ${joined(cover.problems)}`,
  );
  return true;
});

await check('shipped geometry resting on a tile with no row at all is not covered', () => {
  const { map, pois } = bundle();
  const cover = venueImageryCoverage({ map, pois, ledger: {} });
  assert.equal(cover.covered, 0);
  assert.deepEqual(cover.tiles, ['naip-fixture-2023']);
  assert.match(joined(cover.problems), /not in the imagery ledger/);
  return true;
});

await check('imagery-signed geometry that names no tile counts against coverage', () => {
  // A feature can claim `by: aerial` and name nothing to join to. It has no
  // tile id, so it is bucketed under the literal key "(unsigned)" — which is
  // deliberately not a well-formed tile id, and must still reach the reader as
  // an uncovered slot in the denominator rather than being silently dropped.
  const cover = venueImageryCoverage({
    map: { path: [{ n: 'ortho deck', r: [[0, 0], [1, 1]], src: { by: 'aerial' } }] },
    pois: [],
    ledger: { 'naip-fixture-2023': goodRow() },
  });
  assert.equal(cover.features, 1, 'a claim with no tile is still imagery evidence');
  assert.deepEqual(cover.tiles, ['(unsigned)'], 'the untraceable claim gets its own bucket');
  assert.equal(cover.covered, 0, 'nothing with no tile can be covered');
  assert.match(joined(cover.problems), /ortho deck: claim names no imagery tile/);
  return true;
});

// ---------------------------------------------- the gate, inside certification

const { certifyVenue } = await import('../../packages/venue-builder/lib/venue-certify.mjs');

await check("big-kahunas' shipped bundle still carries the aerial signature", () => {
  // The gate reads the built bundle, not sources.json. This asserts the thing
  // it reads actually exists, so a later failure means the gate broke rather
  // than the fixture quietly losing its provenance.
  const map = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/big-kahunas.map.json', import.meta.url), 'utf8'),
  );
  const signed = map.path.filter((p) => p.src?.by === 'aerial');
  assert.equal(signed.length, 3);
  assert.ok(signed.every((p) => p.src.source === 'fl_m_3008637_sw_16_060_20220123'));
  return true;
});

await check('big-kahunas certifies when its imagery rests on an admissible NAIP tile', () => {
  const doc = certifyVenue('big-kahunas', { write: false });
  const gate = doc.checks.find((c) => c.key === 'imagery_ledger');
  assert.ok(gate, `certification carries no imagery gate: ${doc.checks.map((c) => c.key).join(', ')}`);
  assert.equal(gate.pass, true, gate.evidence.detail);
  assert.match(gate.evidence.detail, /fl_m_3008637_sw_16_060_20220123|admissible tile/);
  assert.equal(gate.evidence.denominator, 1, 'one tile the shipped bundle rests on');
  assert.equal(gate.evidence.numerator, 1, 'and it is covered');
  assert.ok(gate.claim && gate.falsifier && gate.soWhat, 'certification rows carry the full contract');
  assert.equal(doc.certified, true, 'imagery with defensible NAIP provenance must not block the birth certificate');
  return true;
});

await check('a venue that derives nothing from imagery gets no imagery gate at all', () => {
  // Deliberately not a snapshot of kings-island's whole check list: this lane
  // owns one key, and pinning the other gates here would fail this test for
  // whatever unrelated lane next touches one of them.
  const doc = certifyVenue('kings-island', { write: false });
  assert.ok(doc.checks.length > 0, 'the venue is still certified against its other gates');
  assert.ok(
    !doc.checks.some((c) => c.key === 'imagery_ledger'),
    'kings-island traces nothing off imagery — an empty gate would be paperwork',
  );
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
