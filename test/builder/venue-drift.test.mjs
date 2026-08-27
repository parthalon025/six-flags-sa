#!/usr/bin/env node
/**
 * Drift detection must compare the bytes that ship — after inventory publish.
 *
 *   node test/builder/venue-drift.test.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish } from '../../packages/venue-builder/bin/attractions.mjs';
import { driftFrom } from '../../packages/venue-builder/bin/build-venue.mjs';
import { PUBLISH_AT } from '../../packages/venue-builder/lib/evidence.mjs';
import { OVERRIDE_DIR, gapsDocumentFor, serializeVenue, VENUE_DIR } from '../../packages/venue-builder/lib/venue-io.mjs';
import { attractionFor } from '../../packages/venue-builder/lib/attractions.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURE_ID = 'drift-publish-fixture';

function withFixture(onDiskPois, run) {
  const mapPath = path.join(VENUE_DIR, `${FIXTURE_ID}.map.json`);
  const poisPath = path.join(VENUE_DIR, `${FIXTURE_ID}.pois.json`);
  const gapsPath = path.join(VENUE_DIR, `${FIXTURE_ID}.gaps.json`);
  const attractionsPath = path.join(OVERRIDE_DIR, FIXTURE_ID, 'attractions.json');
  const meta = {
    id: FIXTURE_ID,
    name: 'Drift Fixture',
    generated: '2026-01-01',
    center: { lat: 41.0, lng: -82.0 },
    bounds: { north: 41.01, south: 40.99, east: -81.99, west: -82.01 },
  };
  const map = { path: [], meta };
  const record = attractionFor({ n: 'Millennium Force', c: 'coaster', lat: 41.0, lng: -82.0 }, FIXTURE_ID);
  record.place = 'millennium-force';
  record.id = 'millennium-force';
  record.features.queue_entrance = {
    at: { lat: 41.0001, lng: -82.0001 },
    confidence: 'high',
    score: 0.9,
    sources: ['fused'],
    evidence: [],
  };
  try {
    fs.mkdirSync(path.dirname(attractionsPath), { recursive: true });
    fs.writeFileSync(attractionsPath, JSON.stringify({
      version: 1,
      venue: FIXTURE_ID,
      attractions: [record],
    }));
    const gaps = gapsDocumentFor({ meta, pois: onDiskPois, map });
    const shipped = serializeVenue({ meta, map, pois: onDiskPois, gaps });
    fs.writeFileSync(mapPath, shipped.map);
    fs.writeFileSync(poisPath, shipped.pois);
    fs.writeFileSync(gapsPath, shipped.gaps);
    return run({ meta, map, record });
  } finally {
    for (const file of [mapPath, poisPath, gapsPath, attractionsPath]) {
      fs.rmSync(file, { force: true });
    }
    fs.rmSync(path.join(OVERRIDE_DIR, FIXTURE_ID), { recursive: true, force: true });
  }
}

withFixture(
  [{
    i: 'millennium-force',
    n: 'Millennium Force',
    lat: 41.0,
    lng: -82.0,
    c: 'coaster',
    e: [{
      lat: 41.0001,
      lng: -82.0001,
      n: 'Millennium Force entrance',
      src: { by: 'fused', feature: 'queue_entrance', confidence: 'high', sources: ['fused'] },
    }],
  }],
  ({ meta, map, record }) => {
    const candidate = [{
      i: 'millennium-force',
      n: 'Millennium Force',
      lat: 41.0,
      lng: -82.0,
      c: 'coaster',
    }];
    const beforePublish = driftFrom({ id: FIXTURE_ID, meta, map, pois: candidate, existingMeta: meta });
    assert.equal(beforePublish.poisChanged, true, 'unpublished POIs should look drifted');

    publish(FIXTURE_ID, candidate, [record], PUBLISH_AT);
    const afterPublish = driftFrom({ id: FIXTURE_ID, meta, map, pois: candidate, existingMeta: meta });
    assert.equal(afterPublish.changed, false, 'published POIs should match what is on disk');
  },
);

console.log('ok venue-drift publish-before-compare');
