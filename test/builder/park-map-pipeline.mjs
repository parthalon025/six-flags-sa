/**
 * Park-map research wiring in the unified pipeline (#399).
 *
 * Seams: resolveOpenResearchOpts (agent → open-research opts) and
 * venueWantsParkMapResearch (catalog gate).
 */

import assert from 'node:assert/strict';
import {
  resolveOpenResearchOpts,
  venueWantsParkMapResearch,
  runResearchAgent,
} from '../../packages/venue-builder/lib/agents/research.mjs';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('park-map-pipeline');

await check('kings-island catalog requests park-map research', () => {
  assert.equal(venueWantsParkMapResearch('kings-island'), true);
});

await check('cedar-point catalog requests park-map research', () => {
  assert.equal(venueWantsParkMapResearch('cedar-point'), true);
});

await check('venue without official_map skips park-map acquisition', () => {
  assert.equal(venueWantsParkMapResearch('magic-kingdom'), false);
});

await check('pipeline fetch enables fetchMaps when venue wants park maps', () => {
  const opts = resolveOpenResearchOpts({ fetch: true, wantsParkMap: true });
  assert.equal(opts.fetchMaps, true);
  assert.equal(opts.applyMaps, true);
  assert.equal(opts.offline, false);
});

await check('fetch without official_map does not enable fetchMaps', () => {
  const opts = resolveOpenResearchOpts({ fetch: true, wantsParkMap: false });
  assert.equal(opts.fetchMaps, false);
  assert.equal(opts.applyMaps, false);
});

await check('offline research skips network park-map lanes', () => {
  const opts = resolveOpenResearchOpts({ fetch: false, wantsParkMap: true });
  assert.equal(opts.fetchMaps, false);
  assert.equal(opts.offline, true);
});

await check('runResearchAgent skips open research when disabled', async () => {
  const result = await runResearchAgent('kings-island', {
    openResearch: false,
    offline: true,
    fetch: false,
    browser: false,
    parksApi: false,
  });
  assert.equal(result.openResearch, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
