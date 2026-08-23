#!/usr/bin/env node
/**
 * Operator (godmode) allowlist — Clerk private_metadata + closet + Offer leak.
 *
 *   node test/app/godmode.test.mjs
 */
import assert from 'node:assert/strict';
import {
  clerkUserIsGodmode,
  godmodeLadderTarget,
  godmodeProfileGrant,
} from '../../packages/shared/godmode.js';
import { RANK_LADDER } from '../../packages/shared/questScore.js';
import {
  SKINS,
  KITS,
  SKIN_IDS,
  canOffer,
  createProgress,
  grantGodmodeProgress,
  offerSkin,
  skinRung,
  skinWearAllowed,
  wearMap,
} from '../../apps/party-tracker/lib/world.js';
import { adminPermitted } from '../../apps/party-tracker/lib/adminToken.js';

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

const AUGUST = Date.UTC(2026, 7, 23);
const KI = { id: 'kings-island', kind: 'theme-park' };

console.log('\ngodmode\n');

await check('empty Clerk user is not Operator', () => {
  assert.equal(clerkUserIsGodmode(null), false);
  assert.equal(clerkUserIsGodmode({}), false);
  assert.equal(clerkUserIsGodmode({ privateMetadata: {} }), false);
  assert.equal(clerkUserIsGodmode({ privateMetadata: { admin: false } }), false);
  assert.equal(clerkUserIsGodmode({ privateMetadata: { admin: 'true' } }), false);
});

await check('private_metadata.admin true is Operator (SDK and REST shapes)', () => {
  assert.equal(clerkUserIsGodmode({ privateMetadata: { admin: true } }), true);
  assert.equal(clerkUserIsGodmode({ private_metadata: { admin: true } }), true);
});

await check('godmode ladder target is the top Title rung', () => {
  const top = RANK_LADDER[RANK_LADDER.length - 1];
  assert.deepEqual(godmodeLadderTarget(), { rank: top.rank, xp: top.xp, title: 'Steward' });
});

await check('profile grant writes Steward / 3000 and keeps other fields', () => {
  const granted = godmodeProfileGrant({ userId: 'usr_1', reputation: 4 });
  assert.equal(granted.userId, 'usr_1');
  assert.equal(granted.reputation, 4);
  assert.equal(granted.xp, 3000);
  assert.equal(granted.rank, 'steward');
  assert.equal(granted.title, 'Steward');
});

await check('August Haunt Wear is blocked unless godmode or unrestricted Offer', () => {
  assert.equal(skinWearAllowed({ skinId: 'haunt', venue: KI, now: AUGUST }), false);
  assert.equal(skinWearAllowed({ skinId: 'haunt', venue: KI, now: AUGUST, godmode: true }), true);
  assert.equal(skinWearAllowed({ skinId: 'haunt', venue: KI, now: AUGUST, unrestricted: true }), true);
});

await check('Water slick on a theme-park World is blocked unless godmode', () => {
  assert.equal(skinWearAllowed({ skinId: 'water-slick', venue: KI, now: AUGUST }), false);
  assert.equal(
    skinWearAllowed({ skinId: 'water-slick', venue: KI, now: AUGUST, godmode: true }),
    true,
  );
});

await check('grantGodmodeProgress opens every shipped Skin to the share rung', () => {
  const p = grantGodmodeProgress(createProgress({ userId: 'usr_op' }));
  assert.equal(p.godmode, true);
  for (const id of SKIN_IDS) {
    assert.equal(skinRung(p, id, KI.id), 'share', id);
    assert.equal(canOffer(p, id, KI.id), true, id);
  }
  assert.ok(Object.keys(KITS).length > 0);
});

await check('an Operator Offer stamps unrestricted and a guest can Wear Haunt in August', () => {
  const owner = grantGodmodeProgress(createProgress({ userId: 'usr_op' }));
  const offered = offerSkin({
    world: { offers: [], marks: [], thanks: [] },
    fromMemberId: 'op',
    fromProfileId: 'usr_op',
    skinId: 'haunt',
    progress: owner,
    now: AUGUST,
  });
  assert.equal(offered.offers[0].unrestricted, true);
  const worn = wearMap({
    progress: createProgress({ userId: 'usr_guest' }),
    partyMembers: { op: { id: 'op', userId: 'usr_op' }, guest: { id: 'guest' } },
    selfId: 'guest',
    acceptedOffer: { fromMemberId: 'op', skinId: 'haunt' },
    world: offered,
    now: AUGUST,
    venue: KI,
  });
  assert.equal(worn, 'haunt');
});

await check('a forced seasonal Offer without the flag stays blocked for the guest', () => {
  const offered = offerSkin({
    world: { offers: [], marks: [], thanks: [] },
    fromMemberId: 'op',
    fromProfileId: 'usr_other',
    skinId: 'haunt',
    progress: createProgress({ userId: 'usr_other' }),
    now: AUGUST,
    force: true,
  });
  assert.equal(offered.offers[0].unrestricted, false);
  const worn = wearMap({
    progress: createProgress({ userId: 'usr_guest' }),
    partyMembers: { op: { id: 'op', userId: 'usr_other' }, guest: { id: 'guest' } },
    selfId: 'guest',
    acceptedOffer: { fromMemberId: 'op', skinId: 'haunt' },
    world: offered,
    now: AUGUST,
    venue: KI,
  });
  assert.notEqual(worn, 'haunt');
});

await check('adminPermitted accepts godmode without a token', () => {
  const prev = process.env.NODE_ENV;
  const token = process.env.METRICS_TOKEN;
  process.env.NODE_ENV = 'production';
  delete process.env.METRICS_TOKEN;
  delete process.env.GUEST_TRACES_TOKEN;
  try {
    const req = new Request('https://parkbound.example/api/admin/consolidate/export');
    assert.equal(adminPermitted(req), false);
    assert.equal(adminPermitted(req, { godmode: true }), true);
  } finally {
    process.env.NODE_ENV = prev;
    if (token == null) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = token;
  }
});

if (FAIL.length) {
  console.error(`\ngodmode.test.mjs: ${FAIL.length} failed`);
  for (const row of FAIL) console.error(' ', row);
  process.exit(1);
}
console.log(`\ngodmode.test.mjs: ${PASS.length} ok`);
