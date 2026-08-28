#!/usr/bin/env node
/**
 * Factory validation — route catalog + kings-island reference venue.
 *
 *   node test/builder/factory-validate.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

console.log('\nfactory validation\n');

const {
  ROUTES,
  FACTORIES,
  getRoute,
  routesForFactory,
  entryForRoute,
  assertCatalogComplete,
  knownFactoryScripts,
  scriptsForRoute,
  factoryLabel,
} = await import('../../packages/venue-builder/lib/factory-types.mjs');
const {
  validateVenue,
  freshnessPin,
  freshnessPinRevision,
} = await import('../../packages/venue-builder/lib/factory-validate.mjs');
const { MONO_ROOT } = await import('../../packages/venue-builder/src/paths.mjs');

/* -------------------------------------------------------- route catalog -- */

await check('route catalog covers map, visual, and delivery factories', () => {
  assert.ok(FACTORIES.map);
  assert.ok(FACTORIES.visual);
  assert.ok(FACTORIES.delivery);
  for (const factory of ['map', 'visual', 'delivery']) {
    assert.ok(routesForFactory(factory).length >= 1, `${factory} has no routes`);
  }
  return true;
});

await check('every route declares inputs, outputs, and a resolvable entry point', () => {
  for (const route of ROUTES) {
    assert.ok(route.id.includes('.'), route.id);
    assert.ok(route.inputs.length >= 1, route.id);
    assert.ok(['required', 'warn', 'optional'].includes(route.requirement), route.id);
    const entry = entryForRoute(route);
    assert.ok(entry.endsWith('.mjs'), `${route.id} → ${entry}`);
  }
  return true;
});

await check('catalog completeness — no orphan factory scripts, every entry exists on disk', () => {
  const { routes, scripts } = assertCatalogComplete();
  assert.equal(routes, ROUTES.length);
  assert.ok(scripts >= knownFactoryScripts().length);
  for (const script of knownFactoryScripts()) {
    assert.ok(
      ROUTES.some((r) => scriptsForRoute(r).includes(script)),
      `orphan factory script not in catalog: ${script}`,
    );
  }
  return true;
});

await check('factory labels read Map factory and Visual factory', () => {
  assert.equal(factoryLabel('map'), 'Map factory');
  assert.equal(factoryLabel('visual'), 'Visual factory');
  return true;
});

await check('routes are looked up by id without hard-coded script lists', () => {
  const certify = getRoute('map.certify');
  assert.equal(certify.entry.module, 'map-factory/build-truth.mjs');
  assert.equal(certify.entry.export, 'buildTruth');
  const display = getRoute('visual.display-pack');
  assert.equal(display.entry.module, 'visual-factory/compile-display.mjs');
  assert.equal(display.entry.export, 'compileDisplay');
  return true;
});

/* ------------------------------------------------------ freshness pure -- */

await check('freshnessPin flags stale and unstamped packs', () => {
  assert.deepEqual(freshnessPin({ basedOn: '2026-08-09', current: '2026-08-09' }), {
    fresh: true,
    reason: 'pins current truth',
  });
  const stale = freshnessPin({ basedOn: '2026-08-01', current: '2026-08-09' });
  assert.equal(stale.fresh, false);
  assert.match(stale.reason, /stale/);
  const unstamped = freshnessPin({ basedOn: null, current: '2026-08-09' });
  assert.equal(unstamped.fresh, false);
  return true;
});

await check('freshnessPinRevision flags stale revision ids', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const other = '11111111-2222-3333-4444-555555555555';
  assert.deepEqual(
    freshnessPinRevision({ basedOnRevisionId: id, currentRevisionId: id }),
    { fresh: true, reason: 'pins current truth revision' },
  );
  const stale = freshnessPinRevision({ basedOnRevisionId: id, currentRevisionId: other });
  assert.equal(stale.fresh, false);
  assert.match(stale.reason, /stale revision/);
  const unstamped = freshnessPinRevision({ basedOnRevisionId: null, currentRevisionId: other });
  assert.equal(unstamped.fresh, false);
  assert.match(unstamped.reason, /missing basedOn revision/);
  const noHead = freshnessPinRevision({ basedOnRevisionId: id, currentRevisionId: null });
  assert.equal(noHead.fresh, true);
  return true;
});

await check('freshnessPin delegates to revision pin when revision ids are present', () => {
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  assert.deepEqual(
    freshnessPin({ basedOnRevisionId: id, currentRevisionId: id }),
    { fresh: true, reason: 'pins current truth revision' },
  );
  return true;
});

/* ------------------------------------------------ kings-island happy path */

await check('kings-island passes buildable factory stages (cert + publish)', async () => {
  const doc = await validateVenue('kings-island', { root: MONO_ROOT });
  assert.equal(doc.venue, 'kings-island');
  assert.ok(doc.truthStamp, 'KI carries a truth stamp');
  assert.equal(doc.summary.fail, 0, `unexpected failures: ${
    doc.routes.filter((r) => r.status === 'fail').map((r) => r.id).join(', ')}`);
  assert.ok(doc.ok, 'required stages pass; warns do not fail the run');

  const certify = doc.routes.find((r) => r.id === 'map.certify');
  assert.equal(certify.status, 'pass', 'map cert passes with park-map research recorded');

  const displayCert = doc.routes.find((r) => r.id === 'visual.display-certify');
  assert.equal(displayCert.status, 'pass', 'Visual factory is certified on KI');

  const truth = doc.routes.find((r) => r.id === 'map.truth');
  assert.equal(truth.status, 'pass');

  const delivery = doc.routes.find((r) => r.id === 'delivery.bundle');
  assert.equal(delivery.status, 'pass', 'delivery.bundle must pass on KI');
  assert.match(delivery.detail, /pins current truth/);
  return true;
});

/* ---------------------------------------------- stale basedOn failure -- */

await check('stale basedOn on a visual spec is reported as a display-pack failure', async () => {
  const tmp = mkdtempSync(path.join(tmpdir(), 'factory-validate-'));
  const venueId = 'fixture-stale';
  const displayDir = path.join(tmp, 'packages', 'venue-builder', 'data', 'venues', venueId, 'display');
  mkdirSync(displayDir, { recursive: true });

  const manifest = {
    venues: [{ id: venueId, generated: '2026-08-20' }],
  };
  mkdirSync(path.join(tmp, 'apps', 'party-tracker', 'public', 'venues'), { recursive: true });
  writeFileSync(
    path.join(tmp, 'apps', 'party-tracker', 'public', 'venues', 'manifest.json'),
    JSON.stringify(manifest),
  );
  writeFileSync(
    path.join(tmp, 'apps', 'party-tracker', 'public', 'venues', `${venueId}.map.json`),
    JSON.stringify({ meta: { generated: '2026-08-20' }, path: [] }),
  );
  writeFileSync(
    path.join(tmp, 'apps', 'party-tracker', 'public', 'venues', `${venueId}.pois.json`),
    JSON.stringify([]),
  );
  writeFileSync(
    path.join(tmp, 'apps', 'party-tracker', 'public', 'venues', `${venueId}.gaps.json`),
    JSON.stringify({ gaps: [] }),
  );
  writeFileSync(
    path.join(displayDir, 'trail.visual.json'),
    JSON.stringify({ version: 1, venue: venueId, skin: 'trail', basedOn: { map: '2026-01-01' } }),
  );
  writeFileSync(path.join(displayDir, 'trail.style.json'), JSON.stringify({ version: 8, layers: [] }));

  const displayPack = getRoute('visual.display-pack');
  const doc = await validateVenue(venueId, { root: tmp, routes: [displayPack] });
  const pack = doc.routes.find((r) => r.id === 'visual.display-pack');
  assert.equal(pack.status, 'fail', 'stale basedOn must fail the required display-pack route');
  assert.match(pack.detail, /stale basedOn/i);
  assert.equal(doc.ok, false);
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
