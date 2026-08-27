#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  attractionFor,
  FEATURES,
} from '../../packages/venue-builder/lib/attractions.mjs';
import { graphFromSidecar } from '../../packages/venue-builder/lib/evidence-graph.mjs';
import {
  applyVisionTraceClaims,
  enqueueVisionTraceClaims,
  pendingVisionTraceKeys,
  reviewKeyForVisionTrace,
} from '../../packages/venue-builder/lib/vision-trace-claims.mjs';

const poi = { n: 'Orion', i: 'ki-orion', lat: 39.344, lng: -84.268, c: 'coaster' };
const record = attractionFor(poi, 'fixture-park');
for (const f of FEATURES) {
  record.features[f] ||= { at: null, confidence: 'unknown', score: 0, sources: [], evidence: [] };
}

const traceGeo = {
  type: 'FeatureCollection',
  properties: { traced: { by: 'trace', image: 'unit-test map', error_m: 3 } },
  features: [{
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [-84.2685, 39.3445] },
    properties: {
      kind: 'entrance',
      of: 'Orion',
      n: 'Orion queue',
      src: { by: 'trace', image: 'unit-test map', error_m: 3 },
    },
  }],
};

const scratch = mkdtempSync(join(tmpdir(), 'vision-trace-'));
writeFileSync(join(scratch, 'orion-trace.geojson'), `${JSON.stringify(traceGeo)}\n`);

const claims = [{
  ride: 'Orion',
  type: 'queue_entrance',
  at: { lat: 39.3445, lng: -84.2685 },
  source: 'traced',
  why: 'traced off unit-test map at ±3 m',
}];

const key = reviewKeyForVisionTrace({
  place: 'ki-orion',
  feature: 'queue_entrance',
  dataset: 'traces/orion.geojson',
});
assert.equal(key, 'vision-trace:ki-orion:queue_entrance:traces/orion.geojson');

const first = applyVisionTraceClaims([record], [{ rel: 'traces/orion.geojson', claims }], {
  asOf: '2026-08-27',
});
assert.equal(first.applied, 1);
assert.deepEqual(first.reviewKeys, [key]);
assert.equal(first.graphSummary.withClaims, 1);

const sidecar = { attractions: [record] };
const { nodes } = graphFromSidecar(sidecar);
const entrance = nodes.find((n) => n.id === 'ki-orion:queue_entrance');
assert.ok(entrance?.claims?.length === 1);
assert.equal(entrance.claims[0].source, 'traced');

const ev = record.features.queue_entrance.evidence[0];
assert.equal(ev.reviewKey, key);
assert.equal(ev.pending, true);

const second = applyVisionTraceClaims([record], [{ rel: 'traces/orion.geojson', claims }], {
  asOf: '2026-08-27',
});
assert.equal(second.applied, 1);
assert.equal(record.features.queue_entrance.evidence.length, 1, 'idempotent — no duplicate claims');

assert.deepEqual(
  pendingVisionTraceKeys({ attractions: [record] }),
  [key],
);
assert.deepEqual(
  pendingVisionTraceKeys(
    { attractions: [record] },
    { decisions: [{ key, decision: 'approve' }] },
  ),
  [],
);

const noop = enqueueVisionTraceClaims('no-such-venue-id', { dryRun: true });
assert.equal(noop.applied, 0);
assert.match(noop.skipped, /no trace datasets/);

console.log('vision-trace-claims tests ok');
