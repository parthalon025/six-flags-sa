#!/usr/bin/env node
/**
 * Builder-shipped Gaps, phone grouping, and XP → Rank rewards.
 *
 *   node test/builder/gaps-quests.mjs
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

console.log('\ngaps + quest score\n');

const {
  rankFromXp,
  rankReward,
  scoreKey,
  scoreSideQuest,
  XP_AWARDS,
} = await import('../../packages/shared/questScore.js');
const { shippedGapsDocument, shippedTypeForSeed, resolveGapTargets } = await import(
  '../../packages/venue-builder/lib/ship-gaps.mjs'
);
const { questSeedsFromRequests, questSeedsFromEntrances } = await import(
  '../../packages/venue-builder/lib/quest-seeds.mjs'
);
const { buildSideQuests, sortByProximity } = await import('../../apps/party-tracker/lib/sideQuests.js');
const { normalizeGapsDocument, gapsUrlFor } = await import('../../apps/party-tracker/lib/venue/store.js');

await check('rankFromXp follows the Scout / Ranger / Cartographer / Steward ladder', () => {
  assert.equal(rankFromXp(0), 'visitor');
  assert.equal(rankFromXp(49), 'visitor');
  assert.equal(rankFromXp(50), 'scout');
  assert.equal(rankFromXp(249), 'scout');
  assert.equal(rankFromXp(250), 'ranger');
  assert.equal(rankFromXp(1000), 'cartographer');
  assert.equal(rankFromXp(3000), 'steward');
  assert.equal(rankReward('scout').label, 'Scout');
  return true;
});

await check('first independent Gap awards 12 plus first-helpful-of-day; repeat is 0', () => {
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  const first = scoreSideQuest(
    { xp: 0, rank: 'visitor', scoredKeys: [], lastQuestDay: null },
    { action: 'first', key: 'ki:height:beast', hasProfile: true, walkedNear: true, now },
  );
  assert.equal(first.deltaXp, XP_AWARDS.first + XP_AWARDS.firstHelpfulDay);
  assert.equal(first.profile.xp, 17);
  assert.equal(first.rankUp, false);
  assert.equal(first.reason, 'first');
  const again = scoreSideQuest(first.profile, {
    action: 'first',
    key: 'ki:height:beast',
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(again.deltaXp, 0);
  assert.equal(again.reason, 'repeat');
  assert.equal(again.profile.xp, 17);
  return true;
});

await check('four first Gaps on a Saturday reach Scout', () => {
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  let profile = { xp: 0, rank: 'visitor', scoredKeys: [], lastQuestDay: null };
  let last = null;
  for (const target of ['a', 'b', 'c', 'd']) {
    last = scoreSideQuest(profile, {
      action: 'first',
      key: scoreKey('ki', 'height', target),
      hasProfile: true,
      walkedNear: true,
      now,
    });
    profile = last.profile;
  }
  assert.equal(profile.xp, 12 * 4 + 5);
  assert.equal(profile.rank, 'scout');
  assert.equal(last.rankUp, true);
  assert.equal(last.previousRank, 'visitor');
  return true;
});

await check('no Profile, not near, and live-without-Profile award 0 XP', () => {
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  const blank = { xp: 0, scoredKeys: [] };
  assert.equal(
    scoreSideQuest(blank, { action: 'first', key: 'k', hasProfile: false, walkedNear: true, now }).deltaXp,
    0,
  );
  assert.equal(
    scoreSideQuest(blank, { action: 'first', key: 'k', hasProfile: true, walkedNear: false, now }).deltaXp,
    0,
  );
  assert.equal(
    scoreSideQuest(blank, { action: 'live', key: 'k', hasProfile: false, walkedNear: true, now }).deltaXp,
    0,
  );
  const live = scoreSideQuest(blank, {
    action: 'live',
    key: 'ki:ride_status:beast',
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(live.deltaXp, XP_AWARDS.live + XP_AWARDS.firstHelpfulDay);
  return true;
});

await check('overturned claws back awarded XP and hits reputation', () => {
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  const awarded = scoreSideQuest(
    { xp: 0, scoredKeys: [] },
    { action: 'first', key: 'ki:height:beast', hasProfile: true, walkedNear: true, now },
  );
  const hit = scoreSideQuest(awarded.profile, { action: 'overturned', key: 'ki:height:beast' });
  assert.equal(hit.profile.xp, 0);
  assert.equal(hit.profile.reputation, -10);
  assert.equal(hit.deltaXp, -17);
  return true;
});

await check('shipped Gaps drop credits/aliases and resolve height names to Place keys', () => {
  const pois = [
    { n: 'The Beast', i: 'the-beast', c: 'coaster' },
    { n: 'Diamondback', i: 'diamondback', c: 'coaster', h: { min: 54 } },
  ];
  const seeds = questSeedsFromRequests('kings-island', [
    { key: 'heights', need: 'heights', blocking: true, targets: ['The Beast'] },
    { key: 'credits', need: 'credits', blocking: false, targets: [] },
    { key: 'unmatched', need: 'aliases', blocking: false, targets: ['Old Name'] },
    { key: 'locality', need: 'locality', blocking: false, targets: [] },
    { key: 'missing-poi', need: 'No toilets, no anywhere to eat', blocking: false, targets: [
      'toilets — OSM tags the rules look for: amenity=toilets',
      'anywhere to eat — OSM tags the rules look for: amenity=fast_food',
    ] },
    { key: 'camping', need: 'hookups', blocking: false, targets: [] },
  ]);
  const doc = shippedGapsDocument({ venueId: 'kings-island', seeds, pois });
  assert.equal(doc.version, 1);
  assert.equal(doc.venue, 'kings-island');
  assert.deepEqual(
    doc.gaps.filter((g) => g.type === 'height'),
    [{ type: 'height', target: 'the-beast' }],
  );
  assert.ok(doc.gaps.some((g) => g.type === 'restroom' && g.target === null));
  assert.ok(doc.gaps.some((g) => g.type === 'food' && g.target === null));
  assert.ok(doc.gaps.some((g) => g.type === 'camping' && g.target === null));
  assert.ok(!doc.gaps.some((g) => g.type === 'name_fix'));
  assert.equal(shippedTypeForSeed({ type: 'name_fix', sourceGap: 'unmatched' }), null);
  return true;
});

await check('low-confidence queue entrance ships as a queue Gap even when a pin exists', () => {
  const pois = [{ n: 'Mini Golf', i: 'mini-golf', c: 'ride', e: { lat: 1, lng: 2 } }];
  const seeds = questSeedsFromEntrances('park', {
    attractions: [
      {
        name: 'Mini Golf',
        place: 'mini-golf',
        features: { queue_entrance: { confidence: 'low' } },
      },
    ],
  });
  assert.ok(seeds.some((s) => s.sourceGap === 'entrance_low_confidence'));
  const doc = shippedGapsDocument({ venueId: 'park', seeds, pois });
  assert.deepEqual(doc.gaps, [{ type: 'queue', target: 'mini-golf' }]);
  return true;
});

await check('resolveGapTargets expands a shared title to every Place key', () => {
  const pois = [
    { n: 'Poltergeist', i: 'poltergeist', c: 'coaster' },
    { n: 'Poltergeist', i: 'poltergeist-2', c: 'coaster' },
  ];
  assert.deepEqual(resolveGapTargets(pois, 'Poltergeist').sort(), ['poltergeist', 'poltergeist-2']);
  return true;
});

await check('empty or missing Gaps do not invent durable Side Quests from POIs', () => {
  const pois = [
    { n: 'Wave Pool', c: 'ride' },
    { n: 'Maui Pipeline', c: 'ride', h: { min: 48 }, e: { lat: 1, lng: 2 } },
  ];
  const empty = buildSideQuests({ pois, gaps: [], venueName: "Big Kahuna's" });
  assert.equal(empty.durable.length, 0);
  const missing = buildSideQuests({ pois, venueName: "Big Kahuna's" });
  assert.equal(missing.durable.length, 0);
  assert.ok(empty.counts.ambient >= 3);
  return true;
});

await check('phone groups atomic Gaps into cards with progress and camping last', () => {
  const pois = [
    { n: 'The Beast', i: 'the-beast', c: 'coaster', lat: 39.345, lng: -84.269 },
    { n: 'Diamondback', i: 'diamondback', c: 'coaster', lat: 39.3452, lng: -84.268 },
  ];
  const { durable } = buildSideQuests({
    venueName: 'Kings Island',
    venueId: 'kings-island',
    pois,
    scoredKeys: ['kings-island:height:the-beast'],
    gaps: [
      { type: 'height', target: 'the-beast' },
      { type: 'height', target: 'diamondback' },
      { type: 'camping', target: null },
    ],
  });
  assert.equal(durable.length, 2);
  const height = durable.find((q) => q.type === 'height');
  const camping = durable.find((q) => q.type === 'camping');
  assert.equal(height.id, 'gap:height');
  assert.equal(height.progress.done, 1);
  assert.equal(height.progress.total, 2);
  assert.deepEqual(height.targets, ['the-beast', 'diamondback']);
  assert.equal(camping.rankLast, true);
  assert.equal(durable[durable.length - 1].type, 'camping');
  return true;
});

await check('sortByProximity keeps camping last even when it has no pin', () => {
  const pois = [{ n: 'Near Ride', i: 'near', lat: 39.0, lng: -84.0 }];
  const sorted = sortByProximity(
    [
      { id: 'gap:camping', type: 'camping', targets: [], rankLast: true },
      { id: 'gap:height', type: 'height', targets: ['near'] },
    ],
    pois,
    { lat: 39.0, lng: -84.0 },
  );
  assert.equal(sorted[0].id, 'gap:height');
  assert.equal(sorted[1].id, 'gap:camping');
  return true;
});

await check('normalizeGapsDocument ignores unknown types and a missing file is an empty list', () => {
  assert.deepEqual(normalizeGapsDocument(null), []);
  assert.deepEqual(
    normalizeGapsDocument({
      version: 1,
      gaps: [{ type: 'height', target: 'a' }, { type: 'wizard', target: 'nope' }, null],
    }),
    [{ type: 'height', target: 'a' }],
  );
  assert.equal(gapsUrlFor({ id: 'kings-island' }), '/venues/kings-island.gaps.json');
  assert.equal(gapsUrlFor({ id: 'kings-island', gaps: '/venues/custom.gaps.json' }), '/venues/custom.gaps.json');
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
