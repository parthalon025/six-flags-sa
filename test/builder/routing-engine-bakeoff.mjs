#!/usr/bin/env node
/** routing-engine bake-off — report shaping and GraphHopper adapter graceful gaps. */
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import {
  ROUTING_BAKEOFF_SCHEMA,
  compareRoutePair,
  shapeBakeoffReport,
  renderBakeoffMarkdown,
} from '../../packages/venue-builder/lib/routing-engine-bakeoff.mjs';
import {
  graphhopperAvailable,
  run,
} from '../../packages/venue-builder/lib/adapters/graphhopper.mjs';

const TEST_VENUE = '__test-graphhopper-bakeoff__';
const TEST_VENUE_2 = '__test-graphhopper-bakeoff-2__';

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

console.log('\nrouting-engine bake-off suite\n');

await check('compareRoutePair agrees when length delta is within tolerance', () => {
  const cmp = compareRoutePair(
    { ok: true, metres: 400, ms: 1.8 },
    { ok: true, metres: 420, ms: 45 },
  );
  assert.equal(cmp.agrees, true);
  assert.equal(cmp.lengthDeltaM, 20);
});

await check('compareRoutePair disagrees when engine route is far longer', () => {
  const cmp = compareRoutePair(
    { ok: true, metres: 400, ms: 1.5 },
    { ok: true, metres: 700, ms: 50 },
  );
  assert.equal(cmp.agrees, false);
});

await check('compareRoutePair marks missing engine route as not agreeing', () => {
  const cmp = compareRoutePair({ ok: true, metres: 400, ms: 2 }, { ok: false, error: 'no_path' });
  assert.equal(cmp.agrees, false);
});

await check('shapeBakeoffReport stamps shared schema for Valhalla pairing', () => {
  const report = shapeBakeoffReport({
    venue: 'cedar-point',
    engine: 'graphhopper',
    pairs: [{ label: 'Gate A', from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }],
    baselineRoutes: [{ label: 'Gate A', ok: true, metres: 500, seconds: 430, ms: 1.6 }],
    engineRoutes: [{ label: 'Gate A', ok: true, metres: 510, seconds: 440, ms: 42 }],
  });
  assert.equal(report.schema, ROUTING_BAKEOFF_SCHEMA);
  assert.equal(report.engine, 'graphhopper');
  assert.equal(report.baseline, 'client-astar');
  assert.equal(report.summary.pairs, 1);
  assert.equal(report.summary.agreementPct, 100);
  assert.ok(report.summary.baselineMeanMs > 0);
  assert.ok(report.summary.engineMeanMs > 0);
});

await check('renderBakeoffMarkdown includes agreement and timing summary', () => {
  const md = renderBakeoffMarkdown(
    shapeBakeoffReport({
      venue: 'kings-island',
      engine: 'graphhopper',
      pairs: [{ label: 'Beast', from: { lat: 1, lng: 2 }, to: { lat: 3, lng: 4 } }],
      baselineRoutes: [{ label: 'Beast', ok: true, metres: 300, seconds: 260, ms: 2 }],
      engineRoutes: [{ label: 'Beast', ok: true, metres: 305, seconds: 265, ms: 38 }],
    }),
  );
  assert.ok(md.includes('Routing engine bake-off'));
  assert.ok(md.includes('agreement'));
  assert.ok(md.includes('kings-island'));
});

await check('run() gaps when GraphHopper is unreachable', async () => {
  const failingFetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(await graphhopperAvailable({ baseUrl: 'http://127.0.0.1:1', fetchImpl: failingFetch }), false);

  const res = await run(
    {
      venueId: TEST_VENUE,
      pairs: [{ label: 'A', from: { lat: 41.48, lng: -82.68 }, to: { lat: 41.49, lng: -82.69 } }],
      fetch: true,
    },
    { fetchImpl: failingFetch },
  );
  assert.equal(res.ok, false);
  assert.equal(res.meta.gap, true);
  assert.ok(res.error.includes('GraphHopper'));
});

await check('run() returns shaped report when fetch succeeds', async () => {
  const mockFetch = async (url) => {
    if (String(url).includes('/info')) return { ok: true, json: async () => ({ version: '9.0' }) };
    return {
      ok: true,
      json: async () => ({
        paths: [{ distance: 510, time: 440000 }],
      }),
    };
  };

  const res = await run(
    {
      venueId: TEST_VENUE_2,
      pairs: [{ label: 'Gate', from: { lat: 41.48, lng: -82.68 }, to: { lat: 41.49, lng: -82.69 } }],
      baselineRoutes: [{ label: 'Gate', ok: true, metres: 500, seconds: 430, ms: 1.5 }],
      fetch: true,
    },
    { fetchImpl: mockFetch },
  );
  assert.equal(res.ok, true);
  assert.equal(res.data.schema, ROUTING_BAKEOFF_SCHEMA);
  assert.equal(res.data.summary.pairs, 1);
});

try {
  rmSync(`packages/venue-builder/data/venues/${TEST_VENUE}`, { recursive: true, force: true });
  rmSync(`packages/venue-builder/data/venues/${TEST_VENUE_2}`, { recursive: true, force: true });
} catch {
  /* ignore */
}

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
