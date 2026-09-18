#!/usr/bin/env node
/** venue-data adapter bake-off — report shaping and registry decision (#413). */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
import {
  VENUE_DATA_BAKEOFF_SCHEMA,
  LEGACY_ADAPTER_ID,
  SUCCESSOR_ADAPTER_ID,
  inventoryCoveragePct,
  coordinateCoveragePct,
  shapeVenueBakeoffReport,
  shapeBakeoffSummary,
  renderBakeoffMarkdown,
} from '../../packages/venue-builder/lib/venue-data-adapter-bakeoff.mjs';
import {
  BAKEOFF_VENUES,
  collectVenueSample,
} from '../../packages/venue-builder/lib/venue-data-adapter-bakeoff-samples.mjs';
import { getAdapter } from '../../packages/venue-builder/lib/adapters/index.mjs';

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

console.log('\nvenue-data adapter bake-off suite\n');

await check('inventoryCoveragePct divides matched by bundle rides', () => {
  assert.equal(inventoryCoveragePct({ bundleRideCount: 10, matched: 7 }), 70);
  assert.equal(inventoryCoveragePct({ bundleRideCount: 0, matched: 0 }), null);
});

await check('coordinateCoveragePct counts attractions with lat/lng', () => {
  const pct = coordinateCoveragePct([
    { at: { lat: 1, lng: 2 } },
    { at: null },
    { at: { lat: 3, lng: 4 } },
  ]);
  assert.equal(pct, 66.7);
});

await check('shapeVenueBakeoffReport stamps shared schema', () => {
  const report = shapeVenueBakeoffReport({
    venue: 'cedar-point',
    parksApi: {
      parkId: 'x',
      parkName: 'Cedar Point',
      source: 'api.themeparks.wiki',
      attractions: [{ name: 'Millennium Force', at: { lat: 1, lng: 2 } }],
    },
    inventoryCompare: { apiCount: 1, bundleRideCount: 1, matched: 1, onlyOnApi: [], onlyInBundle: [] },
  });
  assert.equal(report.schema, VENUE_DATA_BAKEOFF_SCHEMA);
  assert.equal(report.legacy, LEGACY_ADAPTER_ID);
  assert.equal(report.successor, SUCCESSOR_ADAPTER_ID);
  assert.equal(report.inventory.coveragePct, 100);
  assert.equal(report.parksApi.coordinateCoveragePct, 100);
});

await check('shapeBakeoffSummary aggregates venue reports', () => {
  const summary = shapeBakeoffSummary(
    [
      shapeVenueBakeoffReport({
        venue: 'a',
        parksApi: { attractions: [{ at: { lat: 1, lng: 2 } }] },
        inventoryCompare: { apiCount: 2, bundleRideCount: 2, matched: 1 },
      }),
      shapeVenueBakeoffReport({
        venue: 'b',
        parksApi: { attractions: [{ at: { lat: 1, lng: 2 } }, { at: { lat: 3, lng: 4 } }] },
        inventoryCompare: { apiCount: 2, bundleRideCount: 4, matched: 2 },
      }),
    ],
    { recommendation: 'reject legacy', legacyAdopt: 'reject', rationale: ['test'] },
  );
  assert.equal(summary.summary.venuesTested, 2);
  assert.equal(summary.summary.meanInventoryCoveragePct, 50);
  assert.equal(summary.summary.meanCoordinateCoveragePct, 100);
});

await check('renderBakeoffMarkdown includes decision and venue table', () => {
  const md = renderBakeoffMarkdown(
    shapeBakeoffSummary(
      [shapeVenueBakeoffReport({
        venue: 'kings-island',
        parksApi: { attractions: [{ at: { lat: 1, lng: 2 } }] },
        inventoryCompare: { apiCount: 1, bundleRideCount: 1, matched: 1 },
      })],
      { recommendation: 'reject', legacyAdopt: 'reject', rationale: ['superseded'] },
    ),
  );
  assert.ok(md.includes('Venue-data adapter bake-off'));
  assert.ok(md.includes('kings-island'));
  assert.ok(md.includes('superseded'));
});

await check('committed caches cover named bake-off venues', () => {
  for (const id of BAKEOFF_VENUES) {
    const sample = collectVenueSample(id);
    assert.equal(sample.gap, false, `${id} should have committed parks-api cache`);
    assert.ok(sample.parksApi.attractionCount > 0, `${id} attractions`);
    assert.ok(sample.inventory.bundleRideCount > 0, `${id} bundle rides`);
  }
});

await check('builder has no themeparks npm import after reject decision', () => {
  const hits = execSync(
    "rg -l \"require\\(['\\\"]themeparks|from ['\\\"]themeparks\" packages/venue-builder apps scripts test --glob '!**/venue-data-adapter-bakeoff*' || true",
    { cwd: REPO_ROOT, encoding: 'utf8' },
  ).trim();
  assert.equal(hits, '', `unexpected themeparks imports: ${hits}`);
});

await check('registry rejects themeparks-cubehouse after bake-off', () => {
  const legacy = getAdapter(LEGACY_ADAPTER_ID);
  const successor = getAdapter(SUCCESSOR_ADAPTER_ID);
  assert.equal(legacy.adopt, 'reject');
  assert.equal(successor.adopt, 'wrap');
  assert.ok(legacy.notes.includes('parks-api'));
  assert.ok(legacy.notes.includes('#413'));
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
