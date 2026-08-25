#!/usr/bin/env node
/**
 * Factory module seams — Map / Visual / Delivery logical modules (ticket 14).
 *
 *   node test/builder/factory-modules.mjs
 *   node test/builder/factory-modules.mjs --leg map|visual|delivery
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BUILDER_LIB = path.join(ROOT, 'packages/venue-builder/lib');

const legArg = process.argv.find((a) => a.startsWith('--leg='))?.slice('--leg='.length)
  || (process.argv.includes('--leg') ? process.argv[process.argv.indexOf('--leg') + 1] : null);

const { buildTruth } = await import('../../packages/venue-builder/lib/map-factory/index.mjs');
const { compileDisplay } = await import('../../packages/venue-builder/lib/visual-factory/index.mjs');
const { publishBundle, freshnessDecision } = await import('../../packages/venue-builder/lib/delivery/index.mjs');
const { getRoute, assertCatalogComplete } = await import('../../packages/venue-builder/lib/factory-types.mjs');

assert.equal(typeof buildTruth, 'function', 'buildTruth exported');
assert.equal(typeof compileDisplay, 'function', 'compileDisplay exported');
assert.equal(typeof publishBundle, 'function', 'publishBundle exported');

const catalog = assertCatalogComplete();
assert.ok(catalog.routes >= 10, 'route catalog intact');

const certifyRoute = getRoute('map.certify');
assert.equal(certifyRoute.entry.module, 'map-factory/build-truth.mjs');
assert.equal(certifyRoute.entry.export, 'buildTruth');

const displayRoute = getRoute('visual.display-pack');
assert.equal(displayRoute.entry.module, 'visual-factory/compile-display.mjs');

const bundleRoute = getRoute('delivery.bundle');
assert.equal(bundleRoute.entry.module, 'delivery/publish-bundle.mjs');
assert.equal(bundleRoute.cli, 'export-bundle.mjs');

const fresh = freshnessDecision({
  truth: [{ venue: 'a', generated: '2026-08-10' }],
  packs: [{ venue: 'a', kind: 'visual', basedOn: '2026-08-10' }],
});
assert.equal(fresh.fresh, true);

if (!legArg || legArg === 'map') {
  const ki = buildTruth('kings-island', { certify: true });
  assert.equal(ki.venueId, 'kings-island');
  assert.ok(ki.generated, 'KI truth stamp');
  assert.ok(ki.map?.meta, 'KI map meta');
}

if (!legArg || legArg === 'visual') {
  const { readTruth } = await import('../../packages/venue-builder/lib/map-factory/map-io.mjs');
  const truth = readTruth('kings-island');
  assert.ok(truth.map && truth.pois?.length, 'truth readable through map-io seam');
}

if (!legArg || legArg === 'delivery') {
  const { checkVenueFreshness } = await import('@party-tracker/venue-builder/freshness.js');
  const gate = checkVenueFreshness(ROOT);
  assert.equal(typeof gate.ok, 'boolean');
  const published = await publishBundle('kings-island', { skipReindex: true, filesOnly: true });
  assert.ok(published.bundle?.files?.length, 'seed bundle readable through delivery export seam');
  assert.equal(published.revisionId, null);
}

// dependency-cruiser boundary rules (visual → map-io only)
const cruise = execFileSync(
  'npx',
  ['dependency-cruise', '--config', '.dependency-cruiser.cjs', '--output-type', 'json', 'packages/venue-builder/lib/visual-factory'],
  { cwd: ROOT, encoding: 'utf8' },
);
const graph = JSON.parse(cruise);
const violations = (graph.summary?.violations || [])
  .filter((v) => v.rule?.name === 'venue-builder-visual-factory-truth-read-seam');
assert.equal(violations.length, 0, `visual-factory truth-read seam violations: ${violations.map((v) => v.from).join(', ')}`);

console.log(`factory-modules: ok${legArg ? ` (leg=${legArg})` : ''}`);
