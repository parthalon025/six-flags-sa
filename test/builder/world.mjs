#!/usr/bin/env node
/**
 * Collaborative world — Skins, Kits, Marks, Thanks.
 * Tests the public seam in apps/party-tracker/lib/world.js against the spec
 * (docs/superpowers/specs/2026-08-13-collaborative-world-cosmetics-design.md).
 *
 *   node test/builder/world.mjs
 */
import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const world = await import('../../apps/party-tracker/lib/world.js');

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(name + ' :: ' + e.message.split('\n')[0]);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const KI = 'kings-island';
const NOW = Date.UTC(2026, 5, 15, 18, 0, 0); // June afternoon — not Haunt/Frost

function progress(userId = 'usr_mia') {
  return world.createProgress({ userId });
}

await check('Trail and Park Midnight are palettes, not Skins', () => {
  assert.equal(world.isSkin('day'), false);
  assert.equal(world.isSkin('night'), false);
  assert.equal(world.isSkin('postcard'), true);
  assert.equal(world.isSkin('pixel-tycoon'), true);
  return true;
});

await check('a height Side Quest unlocks Postcard privately, not Offer', () => {
  let p = progress();
  const { progress: next, marks } = world.recordSideQuest(p, {
    questId: 'height_rule',
    kind: 'height',
    venueId: KI,
    placeId: 'diamondback',
    lat: 39.345,
    lng: -84.269,
    partyId: 'p1',
    now: NOW,
  });
  assert.equal(world.skinRung(next, 'postcard'), 'unlock');
  assert.equal(world.canOffer(next, 'postcard'), false);
  assert.equal(world.wearMap({ progress: next, partyMembers: {}, selfId: 'mia', now: NOW }), 'postcard');
  assert.ok(marks.some((m) => m.type === 'plaque' && m.placeId === 'diamondback'));
  return true;
});

await check('share is a later rung on the same Skin', () => {
  let p = progress();
  for (let i = 0; i < 3; i += 1) {
    p = world.recordSideQuest(p, {
      questId: 'height_rule',
      kind: 'height',
      venueId: `v${i}`,
      placeId: 'ride',
      partyId: 'p1',
      now: NOW + i,
    }).progress;
  }
  assert.equal(world.skinRung(p, 'postcard'), 'share');
  assert.equal(world.canOffer(p, 'postcard'), true);
  assert.equal(world.canOffer(p, 'pixel-tycoon'), false);
  return true;
});

await check('Offer is opt-in; own Skin wins until accept', () => {
  let mia = progress('usr_mia');
  for (let i = 0; i < 3; i += 1) {
    mia = world.recordSideQuest(mia, {
      questId: 'height_rule',
      kind: 'height',
      venueId: `v${i}`,
      placeId: 'r',
      partyId: 'p1',
      now: NOW + i,
    }).progress;
  }
  const sam = world.recordSideQuest(progress('usr_sam'), {
    questId: 'fog',
    kind: 'geometry',
    venueId: KI,
    placeId: 'midway-1',
    fogPlaces: 40,
    venuePlaceCount: 100,
    partyId: 'p1',
    now: NOW,
  }).progress;
  sam.wearSkin = 'pixel-tycoon';
  assert.equal(world.skinRung(sam, 'pixel-tycoon'), 'unlock');

  const offered = world.offerSkin({
    world: world.emptyWorld(),
    fromMemberId: 'mia',
    fromProfileId: 'usr_mia',
    skinId: 'postcard',
    progress: mia,
    now: NOW,
  });
  assert.equal(offered.offers.length, 1);
  assert.equal(
    world.wearMap({
      progress: sam,
      partyMembers: { mia: { id: 'mia', userId: 'usr_mia' }, sam: { id: 'sam' } },
      selfId: 'sam',
      acceptedOffer: null,
      world: offered,
      now: NOW,
    }),
    'pixel-tycoon',
  );
  assert.equal(
    world.wearMap({
      progress: sam,
      partyMembers: { mia: { id: 'mia', userId: 'usr_mia' }, sam: { id: 'sam' } },
      selfId: 'sam',
      acceptedOffer: { fromMemberId: 'mia', skinId: 'postcard', partyId: 'p1' },
      world: offered,
      now: NOW,
    }),
    'postcard',
  );
  return true;
});

await check('Wear of an offered Skin ends when the owner leaves the Party', () => {
  const mia = (() => {
    let p = progress('usr_mia');
    for (let i = 0; i < 3; i += 1) {
      p = world.recordSideQuest(p, {
        questId: 'height_rule',
        kind: 'height',
        venueId: `v${i}`,
        placeId: 'r',
        partyId: 'p1',
        now: NOW + i,
      }).progress;
    }
    return p;
  })();
  const offered = world.offerSkin({
    world: world.emptyWorld(),
    fromMemberId: 'mia',
    fromProfileId: 'usr_mia',
    skinId: 'postcard',
    progress: mia,
    now: NOW,
  });
  const worn = world.wearMap({
    progress: progress('usr_sam'),
    partyMembers: { sam: { id: 'sam' } },
    selfId: 'sam',
    acceptedOffer: { fromMemberId: 'mia', skinId: 'postcard', partyId: 'p1' },
    world: offered,
    now: NOW,
  });
  assert.equal(worn, 'night');
  return true;
});

await check('strangers see a Mark only after evidence; Party sees it now', () => {
  const dropped = world.dropMark(world.emptyWorld(), {
    type: 'plaque',
    placeId: 'diamondback',
    lat: 39.345,
    lng: -84.269,
    authorId: 'usr_mia',
    authorPartyId: 'p1',
    venueId: KI,
    now: NOW,
  });
  const forParty = world.visibleMarks({
    world: dropped,
    viewerPartyId: 'p1',
    now: NOW,
  });
  const forStranger = world.visibleMarks({
    world: dropped,
    viewerPartyId: 'p2',
    now: NOW,
  });
  assert.equal(forParty.length, 1);
  assert.equal(forStranger.length, 0);
  const evidenced = world.thankMark(dropped, {
    profileId: 'usr_jordan',
    partyId: 'p2',
    targetId: dropped.marks[0].id,
    now: NOW + 1000,
  });
  const later = world.visibleMarks({ world: evidenced, viewerPartyId: 'p2', now: NOW + 1000 });
  assert.equal(later.length, 1);
  return true;
});

await check('unused Marks fade; Contributions stay (fade is visual only)', () => {
  const dropped = world.dropMark(world.emptyWorld(), {
    type: 'lantern',
    placeId: 'diamondback',
    authorId: 'usr_mia',
    authorPartyId: 'p1',
    venueId: KI,
    now: NOW,
  });
  const markId = dropped.marks[0].id;
  const week = world.visibleMarks({
    world: dropped,
    viewerPartyId: 'p1',
    now: NOW + 8 * DAY,
  });
  assert.equal(week[0].opacity < 1, true);
  const month = world.visibleMarks({
    world: dropped,
    viewerPartyId: 'p2',
    now: NOW + 29 * DAY,
  });
  assert.equal(month.length, 0);
  assert.ok(dropped.marks.some((m) => m.id === markId));
  return true;
});

await check('Thanks is once per Profile per target per day', () => {
  const dropped = world.dropMark(world.emptyWorld(), {
    type: 'plaque',
    placeId: 'x',
    authorId: 'usr_mia',
    authorPartyId: 'p1',
    venueId: KI,
    now: NOW,
  });
  const once = world.thankMark(dropped, {
    profileId: 'usr_sam',
    partyId: 'p2',
    targetId: dropped.marks[0].id,
    now: NOW,
  });
  const twice = world.thankMark(once, {
    profileId: 'usr_sam',
    partyId: 'p2',
    targetId: dropped.marks[0].id,
    now: NOW + 60_000,
  });
  assert.equal(once.thanks.length, 1);
  assert.equal(twice.thanks.length, 1);
  return true;
});

await check('Kits are Party-visible; strangers do not see them', () => {
  assert.equal(world.kitForViewer({ kit: 'porter-cuff', viewerInParty: true }), 'porter-cuff');
  assert.equal(world.kitForViewer({ kit: 'porter-cuff', viewerInParty: false }), null);
  return true;
});

await check('Haunt Skin only Wears in season', () => {
  let p = progress();
  for (let i = 0; i < 5; i += 1) {
    p = world.recordSideQuest(p, {
      questId: 'haunt',
      kind: 'experience',
      venueId: KI,
      placeId: `h${i}`,
      month: 9,
      hour: 21,
      partyId: 'p1',
      now: Date.UTC(2026, 9, 12, 21, 0, 0) + i,
    }).progress;
  }
  assert.equal(world.skinRung(p, 'haunt'), 'unlock');
  assert.equal(
    world.wearMap({
      progress: { ...p, wearSkin: 'haunt' },
      partyMembers: {},
      selfId: 'mia',
      now: Date.UTC(2026, 9, 12, 21, 0, 0),
    }),
    'haunt',
  );
  assert.equal(
    world.wearMap({
      progress: { ...p, wearSkin: 'haunt' },
      partyMembers: {},
      selfId: 'mia',
      now: NOW,
    }),
    'postcard',
  );
  return true;
});

await check('preset Signs cannot be ride-down copy', () => {
  assert.ok(world.SIGN_PHRASES.includes('Queue this way'));
  assert.equal(world.SIGN_PHRASES.includes('Ride down'), false);
  assert.equal(world.isAllowedSign('Ride down'), false);
  assert.equal(world.isAllowedSign('Height checked'), true);
  return true;
});

await check('Pixel tycoon paint is RCT grass and grey stone paths', () => {
  const pack = world.mapPaint('pixel-tycoon');
  assert.equal(pack.traits.pixel, true);
  assert.equal(pack.ground, '#4FA83A');
  assert.equal(pack.midway, '#C8C8C0');
  assert.equal(pack.structureEdge, '#C45C38');
  return true;
});

await check('every Skin catalog id has a map paint pack', () => {
  for (const id of world.SKIN_IDS) {
    const pack = world.mapPaint(id);
    assert.ok(pack.path?.stroke, id);
    assert.ok(pack.ground, id);
    assert.ok(pack.contrastFloor >= 4.5, id);
  }
  return true;
});

await check('full Skin and Kit catalogs ship', () => {
  const skins = [
    'postcard', 'handbill', 'ticket-stub', 'drafting', 'operator', 'down-line',
    'marquee', 'haunt', 'frost', 'rain-day', 'junior', 'sticker-book', 'star-chart',
    'water-slick', 'camp-lantern', 'chalk-lot', 'sunrise', 'woodblock',
    'pixel-tycoon', 'block-park', 'redline',
  ];
  for (const id of skins) assert.ok(world.SKINS[id], id);
  const kits = ['porter-cuff', 'buddy', 'street-arrow', 'meet-flag', 'cairn-trail', 'quest-sensor'];
  for (const id of kits) assert.ok(world.KITS[id], id);
  return true;
});

await check('dropMark keeps a caller id so Party mesh and park store match', () => {
  const dropped = world.dropMark(world.emptyWorld(), {
    id: 'mk_shared',
    type: 'plaque',
    placeId: 'diamondback',
    authorId: 'usr_mia',
    authorPartyId: 'p1',
    venueId: KI,
    now: NOW,
  });
  assert.equal(dropped.marks[0].id, 'mk_shared');
  return true;
});

await check('mergeWorlds unions evidence from Party mesh and park store', () => {
  const partySnap = world.dropMark(world.emptyWorld(), {
    id: 'mk_a',
    type: 'lantern',
    placeId: 'beast',
    authorId: 'usr_mia',
    authorPartyId: 'p1',
    venueId: KI,
    now: NOW,
  });
  const parkSnap = world.thankMark(
    world.dropMark(world.emptyWorld(), {
      id: 'mk_a',
      type: 'lantern',
      placeId: 'beast',
      authorId: 'usr_mia',
      authorPartyId: 'p1',
      venueId: KI,
      now: NOW,
    }),
    { profileId: 'usr_sam', partyId: 'p2', targetId: 'mk_a', now: NOW + 1000 },
  );
  const merged = world.mergeWorlds(partySnap, parkSnap);
  const seen = world.visibleMarks({ world: merged, viewerPartyId: 'p3', now: NOW + 1000 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'mk_a');
  return true;
});

const { createParty, reduce } = await import('../../apps/party-tracker/lib/core/state.js');
const { requiresSignedIn } = await import('../../packages/shared/schemas.js');
const store = await import('../../apps/party-tracker/lib/worldStore.js');

await check('Offer and Mark need a Profile; party join does not', () => {
  assert.equal(requiresSignedIn(null, 'party'), false);
  assert.equal(requiresSignedIn(null, 'world'), true);
  assert.equal(requiresSignedIn('usr_mia', 'world'), false);
  return true;
});

await check('host reduce: name-only Member cannot Offer; Profile can', () => {
  const now = NOW;
  let state = createParty({ id: 'p1', leader: 'mia', now });
  state = reduce(state, { kind: 'join', from: 'mia', body: { name: 'Mia' } }, now).state;
  const blocked = reduce(state, { kind: 'world-offer', from: 'mia', body: { skinId: 'postcard' } }, now);
  assert.equal(blocked.ops.length, 0);
  state = reduce(state, { kind: 'patch-member', from: 'mia', body: { patch: { userId: 'usr_mia' } } }, now).state;
  const offered = reduce(state, { kind: 'world-offer', from: 'mia', body: { skinId: 'postcard' } }, now);
  assert.equal(offered.state.settings.world.offers[0].skinId, 'postcard');
  return true;
});

await check('leave withdraws that Member\'s Offers', () => {
  const now = NOW;
  let state = createParty({ id: 'p1', leader: 'mia', now });
  state = reduce(state, { kind: 'join', from: 'mia', body: { name: 'Mia', userId: 'usr_mia' } }, now).state;
  state = reduce(state, { kind: 'join', from: 'sam', body: { name: 'Sam' } }, now).state;
  state = reduce(state, { kind: 'world-offer', from: 'mia', body: { skinId: 'postcard' } }, now).state;
  assert.equal(state.settings.world.offers.length, 1);
  state = reduce(state, { kind: 'leave', from: 'mia', body: {} }, now).state;
  assert.equal(state.settings.world.offers.length, 0);
  return true;
});

await check('patch-member replicates Kit for the Party', () => {
  const now = NOW;
  let state = createParty({ id: 'p1', leader: 'mia', now });
  state = reduce(state, { kind: 'join', from: 'mia', body: { name: 'Mia' } }, now).state;
  state = reduce(state, { kind: 'patch-member', from: 'mia', body: { patch: { kit: 'meet-flag' } } }, now).state;
  assert.equal(state.members.mia.kit, 'meet-flag');
  return true;
});

await check('local world save round-trips progress and accepted Offer', () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
  };
  const saved = {
    progress: world.createProgress({ userId: 'usr_mia' }),
    acceptedOffer: { fromMemberId: 'mia', skinId: 'postcard' },
  };
  saved.progress.wearSkin = 'postcard';
  store.writeSavedWorld(saved, storage);
  const loaded = store.readSavedWorld(storage, { userId: 'usr_mia' });
  assert.equal(loaded.progress.userId, 'usr_mia');
  assert.equal(loaded.progress.wearSkin, 'postcard');
  assert.equal(loaded.acceptedOffer.skinId, 'postcard');
  return true;
});

await check('Rank Scout prize grants Porter cuff Kit', () => {
  let p = progress();
  p = world.grantRankExPrizes(p, 'scout');
  assert.equal(p.kit, 'porter-cuff');
  assert.ok(p.rankPrizesGranted.includes('scout'));
  return true;
});

await check('syncRankExPrizes unlocks Skins through Ranger', () => {
  let p = progress();
  p = world.syncRankExPrizes(p, 'ranger');
  assert.deepEqual(p.rankPrizesGranted, ['scout', 'ranger']);
  assert.equal(world.skinRung(p, 'postcard'), 'unlock');
  return true;
});

console.log('');
console.log(PASS.length + ' passed,', FAIL.length + ' failed');
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
