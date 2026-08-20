#!/usr/bin/env node
/**
 * Venue bundle manifest — the download contract (ADR-0018).
 *
 * The manifest is what the phone trusts: every shipped file, hash-pinned,
 * enumerated from the display pack's own tier manifest rather than a
 * hardcoded list — so a new tier (worlds, future ones) rides in with no
 * change to the bundle module.
 *
 *   node test/builder/venue-bundle.mjs
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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

console.log('\nvenue bundle manifest\n');

const {
  BUNDLE_VERSION,
  sha256Of,
  bundleEntry,
  tierFileNames,
  buildBundleManifest,
  shippedDisplayFiles,
  collectVenueBundle,
  writeBundleManifest,
} = await import('../../packages/venue-builder/lib/venue-bundle.mjs');

/* -------------------------------------------------------------- hashing -- */

await check('sha256Of matches the reference vector', () => {
  // FIPS 180-4 test vector for "abc".
  assert.equal(
    sha256Of(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  return true;
});

await check('bundleEntry pins path, bytes and sha256', () => {
  const buf = Buffer.from('{"a":1}');
  const entry = bundleEntry('/venues/x.map.json', buf);
  assert.deepEqual(entry, {
    path: '/venues/x.map.json',
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  });
  return true;
});

/* ------------------------------------------------------ tier enumeration -- */

await check('tierFileNames is generic: any tier row naming a file counts, gaps do not', () => {
  const tiers = {
    version: 1,
    tiers: {
      vector: { file: 'base.pmtiles', bytes: 100 },
      raster: { gap: true, reason: 'no tiler' },
      // A tier this module has never heard of (Train E's world tier) must
      // flow through with no code change — that is the composition contract.
      'world:trail': { file: 'trail.world.png', bytes: 5, kit: 'island-brochure' },
      credits: { file: 'x--kit.credits.json', bytes: 9 },
    },
  };
  assert.deepEqual(
    tierFileNames(tiers).sort(),
    ['base.pmtiles', 'trail.world.png', 'x--kit.credits.json'],
  );
  assert.deepEqual(tierFileNames(null), []);
  assert.deepEqual(tierFileNames({}), []);
  return true;
});

/* -------------------------------------------------------- determinism ---- */

await check('buildBundleManifest sorts entries and totals bytes deterministically', () => {
  const files = new Map([
    ['/venues/z.pois.json', Buffer.from('zz')],
    ['/venues/a.map.json', Buffer.from('aaa')],
  ]);
  const manifest = buildBundleManifest({ id: 'a', basedOn: { map: '2026-08-10' }, files });
  assert.equal(manifest.version, BUNDLE_VERSION);
  assert.equal(manifest.venue, 'a');
  assert.deepEqual(manifest.basedOn, { map: '2026-08-10' });
  assert.deepEqual(manifest.files.map((f) => f.path), ['/venues/a.map.json', '/venues/z.pois.json']);
  assert.equal(manifest.bytes, 5);
  const again = buildBundleManifest({ id: 'a', basedOn: { map: '2026-08-10' }, files });
  assert.equal(JSON.stringify(again), JSON.stringify(manifest), 'same inputs, same bytes');
  return true;
});

/* --------------------------------------------- display file enumeration -- */

function displayFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'bundle-display-'));
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    version: 1,
    tiers: {
      vector: { file: 'base.pmtiles', bytes: 4 },
      raster: { gap: true, reason: 'no tiler' },
      'world:trail': { file: 'trail.world.png', bytes: 3, kit: 'kit-a' },
      // Recorded on the machine that baked it; absent here. Must not ship.
      'bake:kit-a': { file: 'park--kit-a.png', bytes: 9, kit: 'kit-a' },
    },
  }));
  writeFileSync(path.join(dir, 'base.pmtiles'), 'PMT!');
  writeFileSync(path.join(dir, 'trail.world.png'), 'png');
  writeFileSync(path.join(dir, 'trail.world.json'), '{"bounds":{}}'); // sidecar rule
  writeFileSync(path.join(dir, 'trail.style.json'), '{"version":8}');
  writeFileSync(
    path.join(dir, 'trail.visual.json'),
    JSON.stringify({ terrain: { hillshade: { file: 'hillshade.png' } } }),
  );
  writeFileSync(path.join(dir, 'hillshade.png'), 'shade'); // referenced by the spec
  writeFileSync(path.join(dir, 'display-certification.json'), '{}'); // builder evidence
  writeFileSync(path.join(dir, 'theme.json'), '{}'); // bake input
  writeFileSync(path.join(dir, 'bundle.json'), '{}'); // never self-referential
  return dir;
}

await check('shippedDisplayFiles: tier rows + stage outputs + sidecars + referenced files', () => {
  const dir = displayFixture();
  assert.deepEqual(shippedDisplayFiles(dir), [
    'base.pmtiles',
    'hillshade.png',
    'manifest.json',
    'trail.style.json',
    'trail.visual.json',
    'trail.world.json',
    'trail.world.png',
  ]);
  return true;
});

await check('shippedDisplayFiles: no display dir means no display files, not a throw', () => {
  assert.deepEqual(shippedDisplayFiles(path.join(tmpdir(), 'does-not-exist-anywhere')), []);
  assert.deepEqual(shippedDisplayFiles(null), []);
  return true;
});

await check('shippedDisplayFiles: published worlds without a manifest still ship, with sidecars', () => {
  // venues:publish-worlds copies only <skin>.world.png + .world.json into the
  // public display dir — no manifest.json. The origin serves those bytes, so
  // the bundle must pin them (the kings-island E+F integration case).
  const dir = mkdtempSync(path.join(tmpdir(), 'published-worlds-'));
  writeFileSync(path.join(dir, 'watercolor-quest.world.png'), 'png-bytes');
  writeFileSync(path.join(dir, 'watercolor-quest.world.json'), '{}');
  writeFileSync(path.join(dir, 'layered-atlas.world.png'), 'png-bytes');
  assert.deepEqual(shippedDisplayFiles(dir), [
    'layered-atlas.world.png',
    'watercolor-quest.world.json',
    'watercolor-quest.world.png',
  ]);
  return true;
});

/* ------------------------------------------------------------ end to end -- */

await check('writeBundleManifest: truth trio + display files, URL paths, verifying hashes', () => {
  const venueDir = mkdtempSync(path.join(tmpdir(), 'bundle-venues-'));
  const displayDir = path.join(venueDir, 'test-park', 'display');
  mkdirSync(displayDir, { recursive: true });
  writeFileSync(
    path.join(venueDir, 'test-park.map.json'),
    JSON.stringify({ meta: { id: 'test-park', generated: '2026-08-15' } }),
  );
  writeFileSync(path.join(venueDir, 'test-park.pois.json'), '[]');
  writeFileSync(path.join(venueDir, 'test-park.gaps.json'), '{"gaps":[]}');
  writeFileSync(path.join(displayDir, 'trail.style.json'), '{"version":8}');

  const outFile = path.join(venueDir, 'test-park.bundle.json');
  const manifest = writeBundleManifest('test-park', { venueDir, displayDir, outFile });
  assert.deepEqual(manifest.basedOn, { map: '2026-08-15' }, 'basedOn read from truth when not injected');
  assert.deepEqual(manifest.files.map((f) => f.path), [
    '/venues/test-park.gaps.json',
    '/venues/test-park.map.json',
    '/venues/test-park.pois.json',
    '/venues/test-park/display/trail.style.json',
  ]);
  for (const entry of manifest.files) {
    const onDisk = readFileSync(path.join(venueDir, entry.path.replace('/venues/', '')));
    assert.equal(sha256Of(onDisk), entry.sha256, `${entry.path} hash matches disk`);
    assert.equal(onDisk.length, entry.bytes);
  }
  const written = JSON.parse(readFileSync(outFile, 'utf8'));
  assert.deepEqual(written, manifest, 'the file written is the manifest returned');
  // Rerun is byte-identical — the contract carries no clock.
  const before = readFileSync(outFile, 'utf8');
  writeBundleManifest('test-park', { venueDir, displayDir, outFile });
  assert.equal(readFileSync(outFile, 'utf8'), before);
  return true;
});

await check('collectVenueBundle never promises a byte the origin cannot serve', () => {
  const venueDir = mkdtempSync(path.join(tmpdir(), 'bundle-sparse-'));
  writeFileSync(path.join(venueDir, 'sparse.map.json'), JSON.stringify({ meta: { id: 'sparse' } }));
  // No pois, no gaps, no display dir: only what exists is listed.
  const files = collectVenueBundle('sparse', { venueDir, displayDir: path.join(venueDir, 'sparse', 'display') });
  assert.deepEqual([...files.keys()], ['/venues/sparse.map.json']);
  return true;
});

/* -------------------------------------------------- shipped repo bundles -- */

await check('every venue the app ships has a bundle manifest whose hashes match disk', () => {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '../..');
  const venueDir = path.join(root, 'apps', 'party-tracker', 'public', 'venues');
  const manifest = JSON.parse(readFileSync(path.join(venueDir, 'manifest.json'), 'utf8'));
  assert.ok(manifest.venues.length >= 1);
  for (const venue of manifest.venues) {
    assert.equal(venue.bundle, `/venues/${venue.id}.bundle.json`, `${venue.id} row names its bundle`);
    const bundle = JSON.parse(readFileSync(path.join(venueDir, `${venue.id}.bundle.json`), 'utf8'));
    assert.equal(bundle.venue, venue.id);
    assert.equal(bundle.basedOn.map, venue.generated, `${venue.id} bundle pins the truth stamp`);
    for (const entry of bundle.files) {
      const onDisk = readFileSync(path.join(venueDir, entry.path.replace('/venues/', '')));
      assert.equal(sha256Of(onDisk), entry.sha256, `${entry.path} shipped hash matches disk`);
    }
  }
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exit(1);
}
