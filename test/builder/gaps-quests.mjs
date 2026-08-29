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
  pathScoreCell,
  rankFromXp,
  rankProgress,
  rankReward,
  scoreKey,
  scoreSideQuest,
  titleFromXp,
  XP_AWARDS,
} = await import('../../packages/shared/questScore.js');
const { shippedGapsDocument, shippedTypeForSeed, resolveGapTarget, SHIPPED_GAP_TYPES } = await import(
  '../../packages/venue-builder/lib/ship-gaps.mjs'
);
const { questSeedsFromRequests, questSeedsFromEntrances } = await import(
  '../../packages/venue-builder/lib/quest-seeds.mjs'
);
const { buildSideQuests, isOnWalkway, sortByProximity } = await import('../../apps/party-tracker/lib/sideQuests.js');
const { normalizeGapsDocument, gapsUrlFor, SHIPPED_GAP_TYPES: PHONE_SHIPPED_GAP_TYPES } = await import('../../apps/party-tracker/lib/venue/store.js');
const { DISPUTE_KINDS, assertNoDisputeKinds } = await import('../../packages/venue-builder/lib/imagery-disputes.mjs');

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

await check('XP thresholds grant Titles as Profile sub-names; Visitor has none yet', () => {
  assert.equal(titleFromXp(0), null);
  assert.equal(titleFromXp(49), null);
  assert.equal(rankReward('visitor').title, null);
  assert.equal(titleFromXp(50), 'Scout');
  assert.equal(titleFromXp(249), 'Scout');
  assert.equal(titleFromXp(250), 'Ranger');
  assert.equal(titleFromXp(1000), 'Cartographer');
  assert.equal(titleFromXp(3000), 'Steward');
  assert.equal(rankReward('scout').title, 'Scout');
  return true;
});

await check('rankProgress measures the walk to the next Title', () => {
  const fresh = rankProgress(0);
  assert.equal(fresh.rank, 'visitor');
  assert.equal(fresh.label, 'Visitor');
  assert.equal(fresh.next.title, 'Scout');
  assert.equal(fresh.next.at, 50);
  assert.equal(fresh.next.toGo, 50);
  assert.equal(fresh.fraction, 0);

  const scout = rankProgress(62);
  assert.equal(scout.rank, 'scout');
  assert.equal(scout.title, 'Scout');
  assert.equal(scout.floor, 50);
  assert.equal(scout.next.rank, 'ranger');
  assert.equal(scout.next.toGo, 188);
  assert.equal(scout.fraction, (62 - 50) / (250 - 50));
  return true;
});

await check('rankProgress clamps junk XP and tops out at Steward', () => {
  const junk = rankProgress(Number.NaN);
  assert.equal(junk.xp, 0);
  assert.equal(junk.rank, 'visitor');
  assert.equal(rankProgress(-40).xp, 0);

  const top = rankProgress(4200);
  assert.equal(top.rank, 'steward');
  assert.equal(top.title, 'Steward');
  assert.equal(top.next, null);
  assert.equal(top.fraction, 1);
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
  assert.equal(first.dailyBonus, true);
  const second = scoreSideQuest(first.profile, {
    action: 'first',
    key: 'ki:height:orion',
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(second.deltaXp, XP_AWARDS.first);
  assert.equal(second.dailyBonus, false);
  const again = scoreSideQuest(first.profile, {
    action: 'first',
    key: 'ki:height:beast',
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(again.deltaXp, 0);
  assert.equal(again.reason, 'repeat');
  assert.equal(again.dailyBonus, false);
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
  assert.equal(profile.title, 'Scout');
  assert.equal(last.rankUp, true);
  assert.equal(last.previousRank, 'visitor');
  assert.equal(rankReward(last.previousRank).title, null);
  return true;
});

await check('XP stays on the Profile: no Profile means no XP and no scoredKeys write', () => {
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  const blank = { xp: 0, scoredKeys: [] };
  const none = scoreSideQuest(blank, {
    action: 'first',
    key: 'ki:height:beast',
    hasProfile: false,
    walkedNear: true,
    now,
  });
  assert.equal(none.deltaXp, 0);
  assert.equal(none.reason, 'no_profile');
  assert.equal(none.profile.xp, 0);
  assert.deepEqual(none.profile.scoredKeys, []);
  const alice = scoreSideQuest(
    { xp: 0, scoredKeys: [] },
    { action: 'first', key: 'ki:height:beast', hasProfile: true, walkedNear: true, now },
  );
  const bob = scoreSideQuest(
    { xp: 0, scoredKeys: [] },
    { action: 'first', key: 'ki:height:beast', hasProfile: true, walkedNear: true, now },
  );
  assert.equal(alice.reason, 'first');
  assert.equal(bob.reason, 'first');
  assert.equal(alice.deltaXp, bob.deltaXp);
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
  const pois = [{ n: 'Mini Golf', i: 'mini-golf', c: 'ride', e: { lat: 1, lng: 2 }, h: { min: 0 } }];
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

await check('two Places with the same title and unique i each get a height Gap', () => {
  const pois = [
    { n: 'Poltergeist', i: 'poltergeist', c: 'coaster' },
    { n: 'Poltergeist', i: 'poltergeist-2', c: 'coaster' },
    { n: 'Iron Rattler', i: 'iron-rattler', c: 'coaster', h: { min: 48 } },
  ];
  const doc = shippedGapsDocument({ venueId: 'fiesta-texas', seeds: [], pois });
  assert.deepEqual(
    doc.gaps.filter((g) => g.type === 'height'),
    [
      { type: 'height', target: 'poltergeist' },
      { type: 'height', target: 'poltergeist-2' },
    ],
  );
  return true;
});

await check('resolveGapTarget matches a Place key; an ambiguous title does not fork', () => {
  const pois = [
    { n: 'Poltergeist', i: 'poltergeist', c: 'coaster', h: { min: 48 } },
    { n: 'Poltergeist', i: 'poltergeist-2', c: 'coaster', h: { min: 48 } },
    { n: 'Iron Rattler', i: 'iron-rattler', c: 'coaster', h: { min: 48 } },
  ];
  assert.equal(resolveGapTarget(pois, 'poltergeist'), 'poltergeist');
  assert.equal(resolveGapTarget(pois, 'Iron Rattler'), 'iron-rattler');
  assert.equal(resolveGapTarget(pois, 'Poltergeist'), null);
  const doc = shippedGapsDocument({
    venueId: 'fiesta-texas',
    seeds: [{ type: 'height_rule', sourceGap: 'heights', target: 'Poltergeist' }],
    pois,
  });
  assert.equal(doc.gaps.filter((g) => g.type === 'height').length, 0);
  return true;
});

await check('path Gaps cover stranded rides and a venue-wide missing walkway', () => {
  const pois = [
    { n: 'Near', i: 'near-ride', c: 'ride', lat: 39.0, lng: -84.0, h: { min: 0 } },
    { n: 'Far', i: 'far-ride', c: 'ride', lat: 39.01, lng: -84.0, h: { min: 0 } },
  ];
  const map = { path: [{ r: [[-84.0, 39.0], [-84.001, 39.0]] }], service: [] };
  const doc = shippedGapsDocument({ venueId: 'park', seeds: [], pois, map });
  const paths = doc.gaps.filter((g) => g.type === 'path');
  assert.ok(paths.some((g) => g.target === 'far-ride'));
  assert.ok(!paths.some((g) => g.target === 'near-ride'));
  assert.ok(paths.some((g) => g.target === null));
  return true;
});

await check('a park with a clean walk graph still ships a venue-wide path Gap', () => {
  const pois = [{ n: 'Near', i: 'near-ride', c: 'ride', lat: 39.0, lng: -84.0, h: { min: 0 } }];
  const map = { path: [{ r: [[-84.0, 39.0], [-84.001, 39.0]] }] };
  const doc = shippedGapsDocument({ venueId: 'park', seeds: [], pois, map });
  assert.deepEqual(
    doc.gaps.filter((g) => g.type === 'path'),
    [{ type: 'path', target: null }],
  );
  assert.equal(isOnWalkway(map, { lat: 39.0, lng: -84.0 }), true);
  assert.equal(isOnWalkway(map, { lat: 39.01, lng: -84.0 }), false);
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
      { type: 'path', target: 'the-beast' },
      { type: 'path', target: null },
      { type: 'camping', target: null },
    ],
  });
  assert.equal(durable.length, 3);
  const height = durable.find((q) => q.type === 'height');
  const path = durable.find((q) => q.type === 'path');
  const camping = durable.find((q) => q.type === 'camping');
  assert.equal(height.id, 'gap:height');
  assert.equal(height.progress.done, 1);
  assert.equal(height.progress.total, 2);
  assert.deepEqual(height.targets, ['the-beast', 'diamondback']);
  assert.equal(path.id, 'gap:path');
  assert.equal(path.title, 'Walk a missing path');
  assert.deepEqual(path.targets, ['the-beast']);
  assert.equal(camping.rankLast, true);
  assert.equal(durable[durable.length - 1].type, 'camping');
  const types = durable.map((q) => q.type);
  assert.ok(types.indexOf('path') > types.indexOf('height'));
  assert.ok(types.indexOf('path') < types.indexOf('camping'));
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
  // `path_disputed` is here on purpose: a bundle published while it was a
  // shipped type can still be sitting in a phone's cache, and the phone drops
  // it on load rather than waiting for the cache to turn over.
  assert.deepEqual(
    normalizeGapsDocument({
      version: 1,
      gaps: [
        { type: 'height', target: 'a' },
        { type: 'path', target: null },
        { type: 'path_disputed', target: null },
        { type: 'wizard', target: 'nope' },
        null,
      ],
    }),
    [
      { type: 'height', target: 'a' },
      { type: 'path', target: null },
    ],
  );
  assert.equal(gapsUrlFor({ id: 'kings-island' }), '/venues/kings-island.gaps.json');
  assert.equal(gapsUrlFor({ id: 'kings-island', gaps: '/venues/custom.gaps.json' }), '/venues/custom.gaps.json');
  assert.deepEqual(
    [...PHONE_SHIPPED_GAP_TYPES].sort(),
    [...SHIPPED_GAP_TYPES].sort(),
    'the phone keep-list and the builder allowlist must stay the same set',
  );
  return true;
});

await check('neither allowlist can spell a dispute kind, and no dispute seed can reach one', () => {
  // The phone list gets the same wall the builder list gets at module load —
  // asserted here because store.js cannot import the builder package. There is
  // deliberately no companion call for SHIPPED_GAP_TYPES: ship-gaps.mjs runs
  // the wall over its own list at module load, so a re-added dispute kind
  // fails the `import` at the top of this file and an assertion down here
  // could never be the thing that goes red. That the load-time call exists at
  // all is proven in test/builder/imagery-claims.mjs.
  assertNoDisputeKinds(PHONE_SHIPPED_GAP_TYPES, 'store.js SHIPPED_GAP_TYPES');
  for (const kind of DISPUTE_KINDS) {
    assert.equal(
      shippedTypeForSeed({ sourceGap: kind, target: 'maverick' }),
      null,
      `sourceGap ${kind} must not map onto a shipped Gap type`,
    );
    assert.equal(
      shippedTypeForSeed({ type: kind, target: 'maverick' }),
      null,
      `seed type ${kind} must not map onto a shipped Gap type`,
    );
  }
  // And nothing gets through the document builder either — including the
  // untargeted imagery shape that used to be shipped as-is.
  const doc = shippedGapsDocument({
    venueId: 'demo',
    // No declared height, so this venue ships one real Gap. Without it the
    // "nothing got through" sweep below would pass over an empty list.
    pois: [{ n: 'Maverick', i: 'maverick', c: 'coaster' }],
    seeds: [
      { sourceGap: 'path_disputed', target: null },
      { sourceGap: 'evidence_conflict', target: 'maverick' },
      { type: 'path_disputed', target: 'maverick' },
    ],
  });
  assert.ok(doc.gaps.length > 0, 'guard: the document is not empty for unrelated reasons');
  for (const gap of doc.gaps) {
    assert.ok(!DISPUTE_KINDS.includes(gap.type), `${gap.type} reached the shipped document`);
  }
  return true;
});

await check('null-target path XP keys by a coarse Location cell so one walk does not farm-block the park', () => {
  const here = pathScoreCell(39.345, -84.269);
  const across = pathScoreCell(39.355, -84.28);
  assert.ok(here);
  assert.notEqual(here, across);
  const now = Date.parse('2026-08-13T16:00:00.000Z');
  const first = scoreSideQuest(
    { xp: 0, scoredKeys: [] },
    { action: 'first', key: scoreKey('ki', 'path', here), hasProfile: true, walkedNear: true, now },
  );
  assert.equal(first.reason, 'first');
  const sameCell = scoreSideQuest(first.profile, {
    action: 'first',
    key: scoreKey('ki', 'path', here),
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(sameCell.reason, 'repeat');
  assert.equal(sameCell.deltaXp, 0);
  const otherCell = scoreSideQuest(first.profile, {
    action: 'first',
    key: scoreKey('ki', 'path', across),
    hasProfile: true,
    walkedNear: true,
    now,
  });
  assert.equal(otherCell.reason, 'first');
  assert.ok(otherCell.deltaXp > 0);
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
