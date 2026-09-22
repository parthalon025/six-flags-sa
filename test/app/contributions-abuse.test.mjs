#!/usr/bin/env node
/**
 * E9 abuse controls — proximity + per-(author, place, kind) dedupe.
 *
 *   node test/app/contributions-abuse.test.mjs
 */
import assert from 'node:assert/strict';

const {
  CONTRIBUTION_PROXIMITY_MAX_M,
  CONTRIBUTION_DEDUPE_WINDOW_MS,
  assessContributionProximity,
} = await import('../../apps/party-tracker/lib/contributions/abuse.js');

const BEAST = { lat: 39.344465, lng: -84.264865 }; // adventure-express, kings-island

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log('PASS', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', name, e.message);
  }
};

check('proximity constant mirrors client NEARBY_RADIUS_M (150 m)', () => {
  assert.equal(CONTRIBUTION_PROXIMITY_MAX_M, 150);
});

check('place-targeted contribution without fix is rejected', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    placeId: 'adventure-express',
    kind: 'height_rule',
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'contribution_fix_required');
});

check('fix within radius is accepted', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    placeId: 'adventure-express',
    kind: 'height_rule',
    lat: BEAST.lat,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, true);
});

check('fix just inside drift tolerance is accepted', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    placeId: 'adventure-express',
    kind: 'height_rule',
    lat: BEAST.lat + 0.0009,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, true);
});

check('fix far from target is rejected with distinct code', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    placeId: 'adventure-express',
    kind: 'height_rule',
    lat: BEAST.lat + 0.05,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'contribution_too_far');
});

check('unknown place id is rejected', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    placeId: 'not-a-real-ride-slug',
    kind: 'height_rule',
    lat: BEAST.lat,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'contribution_place_unknown');
});

check('place-targeted kind without placeId is rejected', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    kind: 'height_rule',
    lat: BEAST.lat,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'contribution_place_required');
});

check('height quest kind without placeId is rejected', () => {
  const r = assessContributionProximity({
    venueId: 'kings-island',
    kind: 'height',
    lat: BEAST.lat,
    lng: BEAST.lng,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'contribution_place_required');
});

check('dedupe window is one hour', () => {
  assert.equal(CONTRIBUTION_DEDUPE_WINDOW_MS, 60 * 60 * 1000);
});

{
  const savedDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const { insertContribution, acceptContribution } = await import(
    '../../apps/party-tracker/lib/contributions/store.js'
  );

  const asyncCheck = async (name, fn) => {
    try {
      await fn();
      console.log('PASS', name);
    } catch (e) {
      failed += 1;
      console.error('FAIL', name, e.message);
    }
  };

  await asyncCheck('repeat author+place+kind within window returns same row id', async () => {
    const first = await insertContribution({
      authorId: 'usr_dedupe_a',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'height_rule',
      payload: { min: 48 },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    const second = await insertContribution({
      authorId: 'usr_dedupe_a',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'height_rule',
      payload: { min: 52 },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    assert.equal(second.id, first.id);
    assert.equal(second.payload.min, 52);
  });

  await asyncCheck('different kind mints a second row', async () => {
    const height = await insertContribution({
      authorId: 'usr_dedupe_b',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'height_rule',
      payload: { min: 48 },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    const patch = await insertContribution({
      authorId: 'usr_dedupe_b',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'poi_patch',
      payload: { note: 'rename' },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    assert.notEqual(patch.id, height.id);
  });

  await asyncCheck('resubmit after accept mints a new pending row', async () => {
    const first = await insertContribution({
      authorId: 'usr_dedupe_c',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'height_rule',
      payload: { min: 48 },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    await acceptContribution(first.id);
    const second = await insertContribution({
      authorId: 'usr_dedupe_c',
      venueId: 'kings-island',
      placeId: 'adventure-express',
      kind: 'height_rule',
      payload: { min: 52 },
      lat: BEAST.lat,
      lng: BEAST.lng,
    });
    assert.notEqual(second.id, first.id);
    assert.equal(second.status, 'pending');
  });

  if (savedDb) process.env.DATABASE_URL = savedDb;
  else delete process.env.DATABASE_URL;
}

if (failed) {
  console.error(`contributions-abuse: ${failed} failed`);
  process.exit(1);
}
console.log('contributions-abuse: all passed');
