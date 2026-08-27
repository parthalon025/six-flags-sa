#!/usr/bin/env node
/**
 * Attractions evidence sidecar — producer/consumer contract (#433).
 *
 * Pins the on-disk shape written by the attractions stage and consumed by
 * evidence-graph. A field rename in the writer would pass fusion unit tests
 * but break inspect/certify on real venues; this fails loudly at the seam.
 *
 *   node test/builder/attractions-sidecar.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

console.log('\nattractions evidence sidecar contract\n');

const FIXTURE = fileURLToPath(
  new URL('./fixtures/attractions-sidecar/minimal.json', import.meta.url),
);

const { FEATURES, SCHEMA_VERSION, attractionFor, addEvidence, trim } = await import(
  '../../packages/venue-builder/lib/attractions.mjs'
);
const { graphFromSidecar } = await import(
  '../../packages/venue-builder/lib/evidence-graph.mjs'
);
const { BANDS, PUBLISH_AT } = await import(
  '../../packages/venue-builder/lib/evidence.mjs'
);

const CONFIDENCE_BANDS = new Set(BANDS.map((b) => b.band));

function loadFixture() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

function assertLatLng(at, label) {
  assert.ok(at && typeof at === 'object', `${label}: at must be an object`);
  assert.equal(typeof at.lat, 'number', `${label}: at.lat must be a number`);
  assert.equal(typeof at.lng, 'number', `${label}: at.lng must be a number`);
}

/**
 * Structural contract for data/venues/<id>/attractions.json.
 * Throws on drift; returns the parsed sidecar when valid.
 */
function assertAttractionsSidecarContract(sidecar, { label = 'sidecar' } = {}) {
  assert.equal(typeof sidecar, 'object', `${label}: must be an object`);
  assert.equal(sidecar.version, SCHEMA_VERSION, `${label}: version must be ${SCHEMA_VERSION}`);
  assert.equal(typeof sidecar.venue, 'string', `${label}: venue must be a string`);
  assert.match(String(sidecar.generated), /^\d{4}-\d{2}-\d{2}$/, `${label}: generated ISO date`);
  assert.equal(typeof sidecar.publish_at, 'string', `${label}: publish_at must be a string`);
  assert.ok(CONFIDENCE_BANDS.has(sidecar.publish_at), `${label}: publish_at must be a known band`);
  assert.ok(Array.isArray(sidecar.attractions), `${label}: attractions must be an array`);

  for (const row of sidecar.attractions) {
    assert.equal(typeof row.id, 'string', `${label}: attraction id must be a string`);
    assert.equal(typeof row.name, 'string', `${label}: attraction name must be a string`);
    assert.equal(typeof row.venue, 'string', `${label}: attraction venue must be a string`);
    assert.equal(typeof row.type, 'string', `${label}: attraction type must be a string`);
    assertLatLng(row.at, `${label}: attraction ${row.id}.at`);
    assert.ok(row.features && typeof row.features === 'object', `${label}: features must be an object`);

    for (const [featureKey, slot] of Object.entries(row.features)) {
      assert.ok(
        FEATURES.includes(featureKey),
        `${label}: unknown feature kind "${featureKey}" — one of: ${FEATURES.join(', ')}`,
      );
      assert.ok(slot && typeof slot === 'object', `${label}: ${row.id}.${featureKey} slot must be an object`);
      if (slot.at != null) assertLatLng(slot.at, `${label}: ${row.id}.${featureKey}.at`);
      assert.equal(typeof slot.confidence, 'string', `${label}: ${row.id}.${featureKey}.confidence`);
      assert.ok(CONFIDENCE_BANDS.has(slot.confidence), `${label}: confidence band must be known`);
      assert.equal(typeof slot.score, 'number', `${label}: ${row.id}.${featureKey}.score`);
      assert.ok(Array.isArray(slot.sources), `${label}: ${row.id}.${featureKey}.sources`);
      assert.ok(Array.isArray(slot.evidence), `${label}: ${row.id}.${featureKey}.evidence`);
      assert.equal(typeof slot.conflict, 'boolean', `${label}: ${row.id}.${featureKey}.conflict`);

      for (const claim of slot.evidence) {
        assert.equal(typeof claim.source, 'string', `${label}: evidence.source must be a string`);
        if (claim.at != null) assertLatLng(claim.at, `${label}: evidence.at`);
        if (claim.date != null) assert.match(String(claim.date), /^\d{4}-\d{2}-\d{2}$/, `${label}: evidence.date ISO`);
        if (claim.note != null) assert.equal(typeof claim.note, 'string', `${label}: evidence.note`);
      }
    }
  }

  return sidecar;
}

await check('fixture sidecar satisfies the structural contract', () => {
  assertAttractionsSidecarContract(loadFixture(), { label: 'fixture' });
  return true;
});

await check('JSON round-trip preserves contract fields', () => {
  const parsed = assertAttractionsSidecarContract(loadFixture());
  const roundTripped = JSON.parse(JSON.stringify(parsed));
  assertAttractionsSidecarContract(roundTripped, { label: 'round-trip' });
  return true;
});

await check('attractions producer (attractionFor/addEvidence/trim) passes contract', () => {
  const poi = { n: 'Producer Ride', c: 'ride', lat: 41.48, lng: -82.68, i: 'producer-ride' };
  let record = attractionFor(poi, 'fixture-park');
  addEvidence(
    record,
    'queue_entrance',
    {
      source: 'osm_named_queue',
      at: { lat: 41.48066, lng: -82.68099 },
      date: '2026-01-01',
      why: 'named queue tagged one-way towards the ride',
    },
    { asOf: '2026-01-01' },
  );
  const sidecar = {
    version: SCHEMA_VERSION,
    venue: 'fixture-park',
    generated: '2026-01-01',
    publish_at: PUBLISH_AT,
    attractions: [trim(record)],
  };
  assertAttractionsSidecarContract(sidecar, { label: 'producer' });
  return true;
});

await check('graphFromSidecar consumes the fixture without structural loss', () => {
  const sidecar = loadFixture();
  const { nodes, summary } = graphFromSidecar(sidecar);
  assert.ok(nodes.some((n) => n.kind === 'ride' && n.rideName === 'Sample Ride'));
  assert.ok(nodes.some((n) => n.kind === 'queue entrance' && n.rideName === 'Sample Ride'));
  assert.ok(nodes.some((n) => n.kind === 'ride exit' && n.rideName === 'Sample Ride'));
  assert.ok(summary.withClaims >= 2, 'both feature slots carry claims');
  return true;
});

await check('contract rejects drift: renamed evidence.source field', () => {
  const mutated = loadFixture();
  mutated.attractions[0].features.queue_entrance.evidence[0].sourceKind = 'osm_named_queue';
  delete mutated.attractions[0].features.queue_entrance.evidence[0].source;
  assert.throws(
    () => assertAttractionsSidecarContract(mutated, { label: 'mutated' }),
    /evidence\.source must be a string/,
  );
  return true;
});

await check('contract rejects drift: unknown feature kind', () => {
  const mutated = loadFixture();
  mutated.attractions[0].features.mystery_door = mutated.attractions[0].features.queue_entrance;
  delete mutated.attractions[0].features.queue_entrance;
  assert.throws(
    () => assertAttractionsSidecarContract(mutated, { label: 'mutated' }),
    /unknown feature kind/,
  );
  return true;
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
