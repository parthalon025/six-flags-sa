#!/usr/bin/env node
/**
 * Steward review packet — disputed / low-confidence evidence claims (#432).
 *
 *   node test/builder/steward-review.mjs
 */
import assert from 'node:assert/strict';

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

console.log('\nsteward review packet\n');

const near = { lat: 39.3438, lng: -84.2658 };
const farOff = { lat: 39.3450, lng: -84.2680 };

const {
  buildStewardReviewPacket,
  renderStewardReviewMarkdown,
} = await import('../../packages/venue-builder/lib/steward-review.mjs');
const { buildVenuePrBody } = await import('../../packages/venue-builder/lib/venue-pr.mjs');

const disputedSidecar = {
  attractions: [
    {
      id: 'maverick',
      name: 'Maverick',
      features: {
        queue_entrance: {
          confidence: 'low',
          at: near,
          evidence: [
            { source: 'official_map', at: near, date: '2026-01-01' },
            { source: 'official_site', at: farOff, date: '2026-01-02' },
          ],
        },
      },
    },
  ],
};

const settledSidecar = {
  attractions: [
    {
      id: 'gemini',
      name: 'Gemini',
      features: {
        queue_entrance: {
          confidence: 'high',
          at: near,
          evidence: [
            { source: 'osm_named_queue', at: near, date: '2026-01-01' },
            { source: 'traced', at: near, date: '2026-01-01' },
          ],
        },
      },
    },
  ],
};

await check('a disputed claim appears in the steward review packet', () => {
  const packet = buildStewardReviewPacket(disputedSidecar, { venueId: 'cedar-point' });
  assert.equal(packet.venueId, 'cedar-point');
  assert.equal(packet.claims.length, 1);
  assert.equal(packet.claims[0].ride, 'Maverick');
  assert.equal(packet.claims[0].conflict, true);
  assert.ok(packet.claims[0].sources.length >= 2);
  assert.ok(packet.summary.disputed >= 1);
  return true;
});

await check('packet generation is deterministic for unchanged input', () => {
  const a = buildStewardReviewPacket(disputedSidecar, { venueId: 'cedar-point' });
  const b = buildStewardReviewPacket(disputedSidecar, { venueId: 'cedar-point' });
  assert.deepEqual(a, b);
  assert.doesNotMatch(JSON.stringify(a), /20\d{2}-\d{2}-\d{2}T/);
  return true;
});

await check('markdown names disputes when the packet has any', () => {
  const md = renderStewardReviewMarkdown(buildStewardReviewPacket(disputedSidecar, { venueId: 'x' }));
  assert.match(md, /Steward review/i);
  assert.match(md, /Maverick/);
  assert.match(md, /disput/i);
  return true;
});

await check('markdown states explicitly when nothing needs steward review', () => {
  const md = renderStewardReviewMarkdown(buildStewardReviewPacket(settledSidecar, { venueId: 'x' }));
  assert.match(md, /no disputed|nothing queued|no steward review/i);
  return true;
});

const minimalCert = (certified) => ({
  certified,
  venue: { name: 'Fixture Venue' },
  checks: [{ key: 'smoke', pass: certified, evidence: { detail: 'fixture' }, confidence: 'moderate' }],
});

await check('venue PR body embeds the steward review section when disputes exist', () => {
  const body = buildVenuePrBody('fixture-venue', minimalCert(false), {
    stewardReview: buildStewardReviewPacket(disputedSidecar, { venueId: 'fixture-venue' }),
  });
  assert.match(body, /Steward review/i);
  assert.match(body, /Maverick/);
  return true;
});

await check('venue PR body says so when no steward disputes exist', () => {
  const body = buildVenuePrBody('fixture-venue', minimalCert(true), {
    stewardReview: buildStewardReviewPacket(settledSidecar, { venueId: 'fixture-venue' }),
  });
  assert.match(body, /no disputed|nothing queued|no steward review/i);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====\n`);
if (FAIL.length) {
  for (const f of FAIL) console.error('  ', f);
  process.exit(1);
}
