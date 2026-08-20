#!/usr/bin/env node
/**
 * Credits/attribution generator — scripts/lib/credits.mjs
 *
 *   node test/scripts/credits.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCredits, computeVendorLedgers, parseAttributionMode } from '../../scripts/lib/credits.mjs';
import { generate } from '../../scripts/credits-build.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/* --------------------------------------------------- parseAttributionMode -- */

assert.deepEqual(parseAttributionMode('none', 'x'), { mode: 'none', placement: null });
assert.deepEqual(parseAttributionMode('credits-screen', 'x'), { mode: 'credits-screen', placement: null });
assert.deepEqual(parseAttributionMode('on-map', 'x'), { mode: 'on-map', placement: null });
assert.deepEqual(parseAttributionMode('placed-link:map-view', 'x'), {
  mode: 'placed-link',
  placement: 'map-view',
});
assert.throws(() => parseAttributionMode('placed-link:', 'x'), /no placement/);
assert.throws(() => parseAttributionMode('sometimes', 'x'), /unknown attribution mode/);
assert.throws(() => parseAttributionMode(undefined, 'row-a'), /missing an attribution mode/);

/* --------------------------------------------------------- computeVendorLedgers -- */

const vendorLedgers = [
  { sourceId: 'kenney', file: 'assets.json', match: { field: 'assets', kind: 'tilesheet', urlIncludes: 'kenney.nl' } },
  { sourceId: 'ambientcg', file: 'materials.json', match: { field: 'materials', sourceIncludes: 'ambientcg.com' } },
  { sourceId: 'polyhaven', file: 'polyhaven.json', match: { field: 'materials', isArray: true } },
];

const files = {
  'assets.json': {
    assets: {
      a: { kind: 'tilesheet', license: 'CC0-1.0', source: { url: 'https://kenney.nl/assets/x' } },
      b: { kind: 'tilesheet', license: 'CC0-1.0', source: { url: 'https://kenney.nl/assets/y' } },
      c: { kind: 'sprite', license: 'original', source: { url: 'generated://x' } },
    },
  },
  'materials.json': {
    materials: {
      m1: { license: 'CC0-1.0', source: 'https://ambientcg.com/view?id=A' },
      m2: { license: 'CC0-1.0', source: 'https://ambientcg.com/view?id=B' },
      m3: { license: 'CC0-1.0', source: 'https://ambientcg.com/view?id=C' },
      m4: { license: 'original', source: 'material-maker://x' },
    },
  },
  'polyhaven.json': {
    materials: [{ license: 'CC0' }, { license: 'CC0' }],
  },
};

const ledgers = computeVendorLedgers(vendorLedgers, files);
const bySource = Object.fromEntries(ledgers.map((l) => [l.sourceId, l]));
assert.equal(bySource.kenney.count, 2, 'kenney: only tilesheet + CC0 rows count, original excluded');
assert.equal(bySource.ambientcg.count, 3, 'ambientCG: original row excluded from the ledger');
assert.equal(bySource.polyhaven.count, 2, 'poly haven: flat array counted directly');
assert.equal(bySource.kenney.kindLabel, 'tilesheet packs');
assert.equal(bySource.ambientcg.kindLabel, 'material sets');

/* ------------------------------------------------------------------- buildCredits: grouping -- */

const registry = [
  { id: 'openstreetmap', name: 'OpenStreetMap contributors', role: 'map data', license: 'ODbL 1.0', url: 'https://osm.org', attribution: 'on-map' },
  { id: 'esa-worldcover', name: 'ESA WorldCover', role: 'imagery & terrain', license: 'CC BY 4.0', url: 'https://esa-worldcover.org', attribution: 'credits-screen' },
  { id: 'kenney', name: 'Kenney', role: 'art & materials', license: 'CC0-1.0', url: 'https://kenney.nl', attribution: 'credits-screen' },
  { id: 'nextjs', name: 'Next.js', role: 'software', license: 'MIT', url: 'https://nextjs.org', attribution: 'credits-screen' },
];

const built = buildCredits({ registry, ledgers: [{ sourceId: 'kenney', count: 2, kindLabel: 'tilesheet packs' }] });

assert.equal(built.appCredits.groups.length, 4, 'one group per populated role');
assert.deepEqual(
  built.appCredits.groups.map((g) => g.role),
  ['map data', 'imagery & terrain', 'art & materials', 'software'],
  'groups render in ROLE_ORDER regardless of registry order',
);
const artGroup = built.appCredits.groups.find((g) => g.role === 'art & materials');
assert.equal(artGroup.items[0].detail, '2 tilesheet packs (CC0-1.0)', 'ledger count merges onto its registry row');
assert.match(built.notice, /## Map data/);
assert.match(built.notice, /OpenStreetMap contributors/);
assert.match(built.notice, /2 tilesheet packs \(CC0-1.0\)/);

/* ------------------------------------------------------ buildCredits: missing attribution -- */

assert.throws(
  () => buildCredits({ registry: [{ id: 'x', name: 'X', role: 'software', license: 'MIT', url: 'https://x' }] }),
  /missing an attribution mode/,
  'a registry row with no attribution mode fails the build',
);

/* -------------------------------------------------------- buildCredits: placed-link placement -- */

const withPlacedLink = buildCredits({
  registry: [
    {
      id: 'queue-times',
      name: 'Queue-Times.com',
      role: 'software',
      license: 'ToS',
      url: 'https://queue-times.com',
      attribution: 'placed-link:ride-wait-card',
    },
  ],
});
const qtItem = withPlacedLink.appCredits.groups[0].items[0];
assert.equal(qtItem.attribution, 'placed-link');
assert.equal(qtItem.placement, 'ride-wait-card', 'placed-link rows carry their placement through to appCredits');

/* --------------------------------------------------------------- buildCredits: unknown ledger -- */

assert.throws(
  () => buildCredits({ registry, ledgers: [{ sourceId: 'nope', count: 1, kindLabel: 'x' }] }),
  /unknown registry id "nope"/,
);

/* --------------------------------------------------------------- unknown role rejected -- */

assert.throws(
  () =>
    buildCredits({
      registry: [{ id: 'x', name: 'X', role: 'weather', license: 'MIT', url: 'https://x', attribution: 'none' }],
    }),
  /unknown role "weather"/,
);

/* ------------------------------------------------------------- production registry builds -- */

const { notice, appCreditsJson } = generate({ rootDir: root });
assert.match(notice, /# NOTICE/);
assert.match(notice, /© OpenStreetMap contributors/);
const appCredits = JSON.parse(appCreditsJson);
assert.ok(appCredits.groups.length >= 3, 'production registry produces multiple role groups');
assert.match(appCredits.overarchingNote, /third-party sources/);

// The registry itself must be valid JSON with every row minimally shaped —
// catches a hand-edit that drops `attribution` before buildCredits would.
const registryFile = JSON.parse(readFileSync(join(root, 'scripts/lib/credits-registry.json'), 'utf8'));
for (const row of registryFile.sources) {
  assert.ok(row.id && row.name && row.role && row.license && row.url && row.attribution, `row ${row.id} is fully shaped`);
}

console.log('credits.test: ok');
