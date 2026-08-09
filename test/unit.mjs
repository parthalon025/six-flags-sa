#!/usr/bin/env node
/**
 * Browser-free suite over the pure logic: state, protocol, crypto, session,
 * election and the adaptive GPS policy.
 *
 * Everything under test here is deliberately free of DOM, storage and network,
 * so this runs in plain Node in a couple of seconds and is the suite to reach
 * for first — a failure in it is a domain bug, never a timing artefact.
 *
 *   node test/unit.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// lib/**.js is ESM in a package with no "type" field, so Node warns once about
// reparsing it. Not actionable from a test and it buries the tally, so the
// filter goes in before the modules load — which is why these are dynamic
// imports rather than static ones.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const {
  FAVORITES_MAX,
  MEMBER_TTL_MS,
  OP,
  RIDE_CONFIRM_MS,
  RIDE_DOWN,
  RIDE_OPEN,
  RIDE_REPORT_TTL_MS,
  RIDE_STALE_AFTER_MS,
  ROLE_HOST,
  ROLE_MEMBER,
  applyOps,
  createMember,
  createParty,
  evict,
  evictRides,
  isReportStale,
  isValidLocation,
  publicSnapshot,
  reduce,
} = await import('../lib/core/state.js');
const {
  BYE,
  CLAIM,
  EVERYONE,
  HELLO,
  LOCATION,
  PATCH,
  PING,
  SET_FAVORITE,
  VICTORY,
  addressedTo,
  createDedupe,
  frame,
  isValidFrame,
} = await import('../lib/core/protocol.js');
const { generateKey, importKey, exportKey, open, seal } = await import('../lib/core/crypto.js');
const { createSession, decodeInvite, encodeInvite } = await import('../lib/core/session.js');
const { CODE_ALPHABET, newPartyCode, normalizeCode } = await import('../lib/core/ids.js');
const { createElection, scoreCandidate } = await import('../lib/party/election.js');
const { CADENCE, MOTION, cadenceFor, classifyMotion, createBroadcastGate } = await import(
  '../lib/gps/adaptive.js'
);
const {
  MAX_SNAP_M,
  OFF_ROUTE_M,
  buildRouteGraph,
  findRoute,
  findRoutes,
  navKeyOf,
  routeProgress,
  snapToGraph,
  splitRouteAt,
} = await import('../lib/routing.js');
const { bearing, distance } = await import('../lib/geo.js');
const {
  CONDITIONS,
  COLD_WATER_F,
  OUTLOOK,
  WIND_HARD_MPH,
  WIND_HOLD_MPH,
  classifyWeather,
  exposureFor,
  outlookFor,
  parkOutlook,
} = await import('../lib/weather.js');
const { STATUS, statusFor, statusSummary } = await import('../lib/rideStatus.js');
const { indexById, keyOf, slug, titleOf, withIds } = await import('../lib/venue/ids.js');
const {
  Declutter,
  boxAround,
  clampInto,
  intersect,
  labelArc,
  principalAxis,
  scaleBar,
  textWidth,
} = await import('../lib/mapLabels.js');
const {
  inkOn,
  labelZoomFor,
  normaliseRideName,
  partyMarkerState,
  sizeAtZoom,
  symbolFor,
  STALE_AFTER_MS,
  GLYPHS,
  SYMBOLS,
} = await import('../lib/mapSymbols.js');
const { venueChoiceFor, venueForPosition, venuesByDistance, withinBounds } = await import(
  '../lib/venue/store.js'
);
const { CATEGORY_LABELS, landTint } = await import('../lib/theme.js');
const {
  SHEET_CHROME_PX,
  SHEET_DIGEST_PX,
  SHEET_LIST_AT_PX,
  SHEET_MAGNET_PX,
  SHEET_PEEK_PX,
  nextSheetStop,
  sheetCrowdsMap,
  settleSheet,
  sheetForm,
  sheetPlan,
  sheetStops,
} = await import('../lib/sheet.js');
const { areaOf, centroidOf, clipToBounds, pointInRing, round, simplify } = await import(
  '../scripts/lib/geometry.mjs'
);
const {
  LAYER_RULES,
  POI_RULES,
  ROUTED_LAYERS,
  classify,
  isCivicBoundary,
  isLand,
  isVenueOutline,
  wayAttributes,
} = await import('../scripts/lib/osm-tags.mjs');
const { WAY_FLAGS, hasWayFlag, wayFlagsOf, wayLayerOf } = await import('../lib/wayFlags.js');
// The layer builder, for the round trip from raw tags to the bytes that ship.
const { buildLayers } = await import('../scripts/build-venue.mjs');

/* ------------------------------------------------------------- harness --- */

const PASS = [];
const FAIL = [];
let group = '';

const section = (name) => {
  group = name;
  console.log(`\n--- ${name} ---`);
};

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${group}: ${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

/* --------------------------------------------------------------- state --- */

const HOST = 'host-1';
const PEER = 'peer-2';

/** A party with the host and one member already in it, at a known version. */
function seeded(now = 1_000_000) {
  let state = createParty({ id: 'p1', leader: HOST, now });
  state = reduce(state, { kind: 'join', from: HOST, body: { name: 'Justin' } }, now).state;
  state = reduce(state, { kind: 'join', from: PEER, body: { name: 'Ava' } }, now).state;
  return state;
}

section('core/state');

await check('createParty starts empty at version 0', () => {
  const p = createParty({ id: 'p1', leader: HOST, now: 1 });
  assert.equal(p.version, 0);
  assert.deepEqual(p.members, {});
  assert.equal(p.meet, null);
  return true;
});

await check('every accepted command bumps version by exactly one', () => {
  const now = 1_000_000;
  let state = createParty({ id: 'p1', leader: HOST, now });
  const commands = [
    { kind: 'join', from: HOST, body: { name: 'Justin' } },
    { kind: 'join', from: PEER, body: { name: 'Ava' } },
    { kind: 'location', from: PEER, body: { location: { lat: 39.3, lng: -84.2, ts: now } } },
    { kind: 'patch-member', from: PEER, body: { patch: { name: 'Ava B' } } },
    { kind: 'set-favorite', from: PEER, body: { rideId: 'beast', favorite: true } },
    { kind: 'set-target', from: PEER, body: { rideId: 'racer' } },
    { kind: 'set-meet', from: HOST, body: { meet: { lat: 39.3, lng: -84.2, label: 'Fountain' } } },
    { kind: 'heartbeat', from: PEER, body: { status: 'In line' } },
    { kind: 'leave', from: PEER, body: {} },
  ];
  commands.forEach((command, i) => {
    const before = state.version;
    const result = reduce(state, command, now + i);
    assert.equal(result.state.version, before + 1, `${command.kind} moved ${before} -> ${result.state.version}`);
    assert.ok(result.ops.length > 0, `${command.kind} produced no ops`);
    state = result.state;
  });
  return true;
});

await check('a command that changes nothing leaves version alone', () => {
  const state = seeded();
  const cases = [
    { kind: 'location', from: 'ghost', body: { location: { lat: 1, lng: 1, ts: 2 } } },
    { kind: 'set-target', from: PEER, body: { rideId: null } },
    { kind: 'set-favorite', from: PEER, body: { rideId: 'beast', favorite: false } },
    { kind: 'patch-member', from: PEER, body: { patch: {} } },
    { kind: 'leave', from: 'ghost', body: {} },
    { kind: 'nonsense', from: PEER, body: {} },
  ];
  for (const command of cases) {
    const r = reduce(state, command, 1_000_100);
    assert.equal(r.state.version, state.version, command.kind);
    assert.equal(r.ops.length, 0, command.kind);
  }
  return true;
});

await check('a stale-timestamped location is dropped', () => {
  const now = 1_000_000;
  let state = seeded(now);
  const fresh = { lat: 39.3, lng: -84.26, acc: 8, ts: now + 5000 };
  state = reduce(state, { kind: 'location', from: PEER, body: { location: fresh } }, now).state;
  const at = state.version;

  const stale = reduce(
    state,
    { kind: 'location', from: PEER, body: { location: { lat: 1, lng: 1, ts: now + 1000 } } },
    now,
  );
  assert.equal(stale.ops.length, 0, 'older ts produced ops');
  assert.equal(stale.state.version, at);
  assert.equal(stale.state.members[PEER].location.lat, fresh.lat);

  // Equal timestamps are a duplicate, not an update.
  const same = reduce(state, { kind: 'location', from: PEER, body: { location: { ...fresh } } }, now);
  assert.equal(same.ops.length, 0, 'identical ts produced ops');
  return true;
});

await check('a nonsense location never reaches the roster', () => {
  const state = seeded();
  for (const location of [null, {}, { lat: 91, lng: 0, ts: 1 }, { lat: 0, lng: 181, ts: 1 }, { lat: 1, lng: 1 }]) {
    const r = reduce(state, { kind: 'location', from: PEER, body: { location } }, 1);
    assert.equal(r.ops.length, 0, JSON.stringify(location));
  }
  assert.equal(isValidLocation({ lat: 39, lng: -84, ts: 1 }), true);
  return true;
});

await check('a bare heartbeat is silent but still moves lastSeen', () => {
  const now = 1_000_000;
  const state = seeded(now);
  const r = reduce(state, { kind: 'heartbeat', from: PEER, body: {} }, now + 60_000);
  assert.equal(r.silent, true);
  assert.deepEqual(r.ops, []);
  assert.equal(r.state.version, state.version, 'silent heartbeat bumped version');
  assert.equal(r.state.members[PEER].lastSeen, now + 60_000);
  return true;
});

await check('a heartbeat carrying battery or status is broadcast', () => {
  const now = 1_000_000;
  const state = seeded(now);
  const withBattery = reduce(
    state,
    { kind: 'heartbeat', from: PEER, body: { battery: { level: 0.4, charging: false } } },
    now + 1000,
  );
  assert.notEqual(withBattery.silent, true);
  assert.equal(withBattery.state.version, state.version + 1);
  assert.equal(withBattery.ops.length, 1);
  assert.equal(withBattery.state.members[PEER].battery.level, 0.4);
  return true;
});

await check('nobody can edit anybody else’s record', () => {
  const now = 1_000_000;
  const state = seeded(now);
  const r = reduce(state, { kind: 'patch-member', from: PEER, body: { patch: { name: 'Mallory' } } }, now);
  assert.equal(r.state.members[PEER].name, 'Mallory');
  assert.equal(r.state.members[HOST].name, 'Justin', 'host record was touched');
  // Ops only ever name their own sender.
  assert.ok(r.ops.every((op) => op.id === PEER));
  return true;
});

await check('rejoining after a refresh keeps join order and location', () => {
  const now = 1_000_000;
  let state = seeded(now);
  const order = state.members[PEER].joinOrder;
  state = reduce(
    state,
    { kind: 'location', from: PEER, body: { location: { lat: 39.3, lng: -84.26, ts: now } } },
    now,
  ).state;
  const again = reduce(state, { kind: 'join', from: PEER, body: { name: 'Ava' } }, now + 5000).state;
  assert.equal(again.members[PEER].joinOrder, order);
  assert.equal(again.members[PEER].location.lat, 39.3);
  return true;
});

await check('set-leader moves the host role across the roster', () => {
  const state = seeded();
  const r = reduce(state, { kind: 'set-leader', from: PEER, body: { leader: PEER } }, 1);
  assert.equal(r.state.leader, PEER);
  assert.equal(r.state.members[PEER].role, ROLE_HOST);
  assert.equal(r.state.members[HOST].role, ROLE_MEMBER);
  assert.equal(r.state.version, state.version + 1);
  return true;
});

await check('applyOps reproduces host state on a replica', () => {
  const now = 1_000_000;
  let host = createParty({ id: 'p1', leader: HOST, now });
  // The replica starts from the same base and only ever sees ops.
  let replica = createParty({ id: 'p1', leader: HOST, now });

  const script = [
    { kind: 'join', from: HOST, body: { name: 'Justin' } },
    { kind: 'join', from: PEER, body: { name: 'Ava' } },
    { kind: 'join', from: 'peer-3', body: { name: 'Sam' } },
    { kind: 'location', from: PEER, body: { location: { lat: 39.341, lng: -84.265, acc: 6, ts: now + 1 } } },
    { kind: 'location', from: 'peer-3', body: { location: { lat: 39.346, lng: -84.266, acc: 9, ts: now + 2 } } },
    { kind: 'set-favorite', from: PEER, body: { rideId: 'beast', favorite: true } },
    { kind: 'set-target', from: 'peer-3', body: { rideId: 'racer' } },
    { kind: 'heartbeat', from: PEER, body: { status: 'NEED HELP' } },
    { kind: 'set-meet', from: HOST, body: { meet: { lat: 39.343, lng: -84.267, label: 'Fountain' } } },
    { kind: 'set-leader', from: PEER, body: { leader: PEER } },
    { kind: 'leave', from: 'peer-3', body: {} },
  ];

  for (const command of script) {
    const result = reduce(host, command, now + 10);
    host = result.state;
    if (!result.ops.length) continue;
    replica = { ...applyOps(replica, result.ops), version: result.state.version };
  }

  assert.equal(replica.version, host.version);
  assert.deepEqual(publicSnapshot(replica), publicSnapshot(host));
  return true;
});

await check('an op a replica does not understand is skipped, not fatal', () => {
  const state = seeded();
  const next = applyOps(state, [{ type: 'ride.rename-from-the-future', id: 'x' }, { type: OP.MEET_SET, meet: null }]);
  assert.equal(next.meet, null);
  assert.equal(Object.keys(next.members).length, 2);
  return true;
});

await check('a merge for a member already gone is a no-op', () => {
  const state = seeded();
  const next = applyOps(state, [{ type: OP.MEMBER_MERGE, id: 'ghost', patch: { name: 'x' } }]);
  assert.equal(next.members.ghost, undefined);
  return true;
});

await check('evict drops members past the TTL and leaves the rest', () => {
  const now = 5_000_000;
  let state = createParty({ id: 'p1', leader: HOST, now: 0 });
  state = reduce(state, { kind: 'join', from: HOST, body: { name: 'Justin' } }, now).state;
  state = reduce(state, { kind: 'join', from: PEER, body: { name: 'Ava' } }, now - MEMBER_TTL_MS - 1000).state;

  const nothing = evict(state, now - MEMBER_TTL_MS - 2000);
  assert.deepEqual(nothing.ops, [], 'evicted somebody inside the TTL');

  const r = evict(state, now);
  assert.equal(r.ops.length, 1);
  assert.deepEqual(r.ops[0], { type: OP.MEMBER_DEL, id: PEER });
  assert.equal(r.state.members[PEER], undefined);
  assert.ok(r.state.members[HOST]);
  assert.equal(r.state.version, state.version + 1);
  return true;
});

await check('publicSnapshot carries no code or token', () => {
  const state = { ...seeded(), code: 'ABC234', token: 'secret-token' };
  const snap = publicSnapshot(state);
  assert.equal(snap.code, undefined);
  assert.equal(snap.token, undefined);
  assert.ok(snap.members[HOST]);
  return true;
});

await check('createMember shapes a record the UI can read straight away', () => {
  const m = createMember({ id: 'x', name: 'Ava', now: 7 });
  assert.equal(m.location, null);
  assert.deepEqual(m.favorites, []);
  assert.equal(m.lastSeen, 7);
  assert.equal(m.role, ROLE_MEMBER);
  // The UI draws a member as a colour and two initials, both derived from the
  // id and the name, so there is nothing for an avatar to be.
  assert.equal('avatar' in m, false);
  // A caller that still passes one gets a record without it: the field is gone
  // from the shape, not merely defaulted to null.
  assert.equal('avatar' in createMember({ id: 'x', avatar: 'data:image/png;base64,AAAA' }), false);
  return true;
});

await check('a snapshot carries no avatar', () => {
  const now = 1_000_000;
  let state = createParty({ id: 'p1', leader: HOST, now });
  // An older build puts its whole member record on the wire, avatar and all.
  // Nothing rejects the join — the field simply never reaches the roster, and
  // so never reaches WELCOME, a resync SNAPSHOT or a VICTORY frame.
  state = reduce(
    state,
    { kind: 'join', from: PEER, body: { name: 'Ava', avatar: 'data:image/png;base64,AAAA' } },
    now,
  ).state;
  assert.ok(state.members[PEER], 'the join was rejected outright');

  const snap = publicSnapshot(state);
  assert.equal(snap.members[PEER].avatar, undefined);
  assert.equal(JSON.stringify(snap).includes('data:image'), false);

  // And patch-member cannot smuggle one back in past the allowlist.
  const r = reduce(
    state,
    { kind: 'patch-member', from: PEER, body: { patch: { avatar: 'data:image/png;base64,BBBB' } } },
    now + 1,
  );
  assert.equal(r.ops.length, 0, 'an avatar patch was accepted');
  assert.equal(publicSnapshot(r.state).members[PEER].avatar, undefined);
  return true;
});

await check('a settings merge for a setting nobody defined is ignored rather than fatal', () => {
  const state = seeded();
  // `settings` is deliberately empty: no command emits SETTINGS_MERGE yet, and
  // the op is kept because it is the mechanism the first party-wide setting
  // will use. Until then an unknown key must cost nothing.
  assert.deepEqual(state.settings, {});
  assert.equal(state.settings.shareLocationHistory, undefined);

  const next = applyOps(state, [
    { type: OP.SETTINGS_MERGE, patch: { somethingFromTheFuture: true } },
  ]);
  // It lands where nothing reads it, and nothing else moves — no throw, the
  // roster and the version are untouched, and the base state is not mutated.
  assert.equal(next.settings.somethingFromTheFuture, true);
  assert.deepEqual(Object.keys(next.members).sort(), [HOST, PEER].sort());
  assert.equal(next.version, state.version);
  assert.deepEqual(state.settings, {}, 'the merge mutated the state it was given');
  return true;
});

await check('a favourites list cannot grow past its cap', () => {
  const now = 1_000_000;
  let state = seeded(now);
  for (let i = 0; i < FAVORITES_MAX + 5; i += 1) {
    state = reduce(state, { kind: 'set-favorite', from: PEER, body: { rideId: `ride-${i}`, favorite: true } }, now).state;
  }
  assert.equal(state.members[PEER].favorites.length, FAVORITES_MAX);

  // Past the cap the command is a no-op, not an error: no version bump, no ops,
  // and the list it already had is left exactly as it was.
  const before = state.version;
  const r = reduce(state, { kind: 'set-favorite', from: PEER, body: { rideId: 'one-too-many', favorite: true } }, now);
  assert.equal(r.state.version, before);
  assert.equal(r.ops.length, 0);
  assert.equal(r.state.members[PEER].favorites.includes('one-too-many'), false);

  // A full list still un-stars, so a member can always make room.
  state = reduce(state, { kind: 'set-favorite', from: PEER, body: { rideId: 'ride-0', favorite: false } }, now).state;
  assert.equal(state.members[PEER].favorites.length, FAVORITES_MAX - 1);
  state = reduce(state, { kind: 'set-favorite', from: PEER, body: { rideId: 'one-too-many', favorite: true } }, now).state;
  assert.equal(state.members[PEER].favorites.includes('one-too-many'), true);
  return true;
});

await check('a set-favorite from an older build is still accepted', () => {
  const now = 1_000_000;
  const state = seeded(now);
  // The op, the protocol kind and the REST route all stay: capping the list is
  // not the same as withdrawing the command, and a phone on the previous build
  // knows nothing about a cap.
  assert.equal(SET_FAVORITE, 'set-favorite');
  const r = reduce(state, { kind: SET_FAVORITE, from: PEER, body: { rideId: 'beast', favorite: true } }, now);
  assert.equal(r.state.version, state.version + 1);
  assert.deepEqual(r.ops, [{ type: OP.MEMBER_MERGE, id: PEER, patch: { favorites: ['beast'] } }]);
  assert.deepEqual(r.state.members[PEER].favorites, ['beast']);
  return true;
});

/* ------------------------------------------------------------ protocol --- */

section('core/protocol');

await check('createDedupe drops replays', () => {
  const d = createDedupe();
  assert.equal(d.accept('a', 1), true);
  assert.equal(d.accept('a', 1), false, 'same seq accepted twice');
  assert.equal(d.accept('a', 2), true);
  assert.equal(d.accept('a', 2), false);
  // A frame from behind the high-water mark is a duplicate route, not news.
  assert.equal(d.accept('a', 1), false);
  // Senders are tracked independently.
  assert.equal(d.accept('b', 1), true);
  return true;
});

await check('createDedupe tolerates a sender resetting its seq', () => {
  const d = createDedupe({ resetGap: 64 });
  assert.equal(d.accept('a', 200), true);
  assert.equal(d.accept('a', 190), false, 'a small step back should read as a replay');
  assert.equal(d.accept('a', 1), true, 'a reconnected sender was locked out');
  assert.equal(d.accept('a', 2), true);
  assert.equal(d.accept('a', 1), false);
  return true;
});

await check('forget and reset clear the high-water marks', () => {
  const d = createDedupe();
  d.accept('a', 9);
  d.accept('b', 9);
  d.forget('a');
  assert.equal(d.accept('a', 9), true);
  assert.equal(d.accept('b', 9), false);
  d.reset();
  assert.equal(d.accept('b', 9), true);
  return true;
});

await check('isValidFrame accepts a well-formed frame', () => {
  const f = frame({ seq: 1, kind: LOCATION, from: PEER, body: { location: null } });
  assert.equal(isValidFrame(f), true);
  assert.equal(f.to, EVERYONE);
  assert.ok(Number.isFinite(f.ts));
  return true;
});

await check('isValidFrame rejects malformed input', () => {
  const base = { seq: 1, ts: 1, kind: PING, from: 'a', to: EVERYONE, body: {} };
  const bad = [
    null,
    undefined,
    'a string',
    42,
    [],
    { ...base, seq: undefined },
    { ...base, seq: 'one' },
    { ...base, seq: NaN },
    { ...base, ts: undefined },
    { ...base, from: '' },
    { ...base, from: 7 },
    { ...base, to: null },
    { ...base, kind: 'not-a-kind' },
    { ...base, kind: undefined },
    { ...base, body: null },
    { ...base, body: 'text' },
  ];
  bad.forEach((f, i) => assert.equal(isValidFrame(f), false, `case ${i}: ${JSON.stringify(f)}`));
  assert.equal(isValidFrame(base), true);
  return true;
});

await check('frame refuses to build an unknown kind', () => {
  assert.throws(() => frame({ seq: 1, kind: 'invent', from: 'a' }), /unknown message kind/);
  return true;
});

await check('addressedTo routes broadcasts and unicasts', () => {
  const b = frame({ seq: 1, kind: PATCH, from: HOST, to: EVERYONE, body: {} });
  const u = frame({ seq: 2, kind: PATCH, from: HOST, to: PEER, body: {} });
  assert.equal(addressedTo(b, PEER), true);
  assert.equal(addressedTo(u, PEER), true);
  assert.equal(addressedTo(u, 'someone-else'), false);
  return true;
});

/* -------------------------------------------------------------- crypto --- */

section('core/crypto');

const key = await generateKey();
const other = await generateKey();
const PARTY_ID = 'a1b2c3d4e5f60718';

await check('seal/open round-trips a frame', async () => {
  const f = frame({ seq: 3, kind: HELLO, from: PEER, body: { member: { id: PEER, name: 'Ava' } } });
  const sealed = await seal(key, PARTY_ID, f);
  assert.equal(sealed.pid, PARTY_ID);
  assert.equal(typeof sealed.ct, 'string');
  const opened = await open(key, sealed);
  assert.deepEqual(opened, f);
  return true;
});

await check('the sealed envelope leaks nothing but the party id', async () => {
  const f = frame({ seq: 4, kind: LOCATION, from: PEER, body: { location: { lat: 39.341, lng: -84.265, ts: 1 } } });
  const sealed = await seal(key, PARTY_ID, f);
  const wire = JSON.stringify(sealed);
  assert.deepEqual(Object.keys(sealed).sort(), ['ct', 'iv', 'pid', 'v']);
  assert.equal(/location|39\.341|-84\.265|peer-2/.test(wire), false, wire);
  return true;
});

await check('a fresh IV is used for every seal', async () => {
  const f = frame({ seq: 5, kind: PING, from: HOST, body: {} });
  const a = await seal(key, PARTY_ID, f);
  const b = await seal(key, PARTY_ID, f);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  return true;
});

await check('the wrong key returns null rather than throwing', async () => {
  const sealed = await seal(key, PARTY_ID, frame({ seq: 6, kind: PING, from: HOST, body: {} }));
  assert.equal(await open(other, sealed), null);
  return true;
});

await check('tampered ciphertext returns null', async () => {
  const sealed = await seal(key, PARTY_ID, frame({ seq: 7, kind: BYE, from: PEER, body: {} }));
  const flip = (s) => {
    const chars = [...s];
    chars[4] = chars[4] === 'A' ? 'B' : 'A';
    return chars.join('');
  };
  assert.equal(await open(key, { ...sealed, ct: flip(sealed.ct) }), null, 'ct');
  assert.equal(await open(key, { ...sealed, iv: flip(sealed.iv) }), null, 'iv');
  assert.equal(await open(key, { ...sealed, ct: `${sealed.ct}AAAA` }), null, 'appended');
  return true;
});

await check('a relabelled pid returns null', async () => {
  const sealed = await seal(key, PARTY_ID, frame({ seq: 8, kind: PING, from: HOST, body: {} }));
  // The party id is authenticated, so replaying this envelope into another
  // party fails the tag even though the key is right.
  assert.equal(await open(key, { ...sealed, pid: 'ffffffffffffffff' }), null);
  return true;
});

await check('structurally broken envelopes return null', async () => {
  const sealed = await seal(key, PARTY_ID, frame({ seq: 9, kind: PING, from: HOST, body: {} }));
  const cases = [
    null,
    undefined,
    'string',
    7,
    {},
    { ...sealed, v: 99 },
    { ...sealed, iv: 'AAAA' }, // wrong IV length
    { ...sealed, iv: 42 },
    { ...sealed, ct: undefined },
    { ...sealed, pid: 12 },
  ];
  for (const c of cases) assert.equal(await open(key, c), null, JSON.stringify(c));
  return true;
});

await check('exported keys re-import to the same key', async () => {
  const raw = await exportKey(key);
  const back = await importKey(raw);
  const sealed = await seal(back, PARTY_ID, frame({ seq: 10, kind: PING, from: HOST, body: {} }));
  assert.ok(await open(key, sealed));
  return true;
});

/* ------------------------------------------------------------- session --- */

section('core/session');

const session = createSession({
  partyId: PARTY_ID,
  code: 'abc-234',
  keyString: await exportKey(key),
  token: 'tok123',
  endpoints: ['http://192.168.1.20:8787'],
  selfId: 'me',
  role: 'host',
  hostId: 'me',
});

await check('an invite round-trips through encode and decode', () => {
  const url = encodeInvite(session, { origin: 'https://example.test/' });
  const back = decodeInvite(url);
  assert.equal(back.partyId, PARTY_ID);
  assert.equal(back.code, 'ABC234');
  assert.equal(back.keyString, session.keyString);
  assert.equal(back.token, 'tok123');
  assert.deepEqual(back.endpoints, ['http://192.168.1.20:8787']);
  return true;
});

await check('the key rides in the fragment and nowhere else', () => {
  const url = encodeInvite(session, { origin: 'https://example.test' });
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/join');
  assert.equal(parsed.search, '', 'invite put something in the query string');
  const beforeHash = url.slice(0, url.indexOf('#'));
  assert.equal(beforeHash.includes(session.keyString), false, 'key appeared outside the fragment');
  assert.equal(beforeHash.includes(PARTY_ID), false, 'party id appeared outside the fragment');
  assert.ok(parsed.hash.length > 1);
  // Everything needed to join is inside the fragment on its own.
  assert.equal(decodeInvite(parsed.hash).keyString, session.keyString);
  return true;
});

await check('decodeInvite accepts a bare fragment, a raw payload and a percent-encoded one', () => {
  const url = encodeInvite(session, { origin: 'https://example.test' });
  const raw = url.slice(url.indexOf('#') + 1);
  assert.equal(decodeInvite(`#${raw}`).partyId, PARTY_ID);
  assert.equal(decodeInvite(raw).partyId, PARTY_ID);
  assert.equal(decodeInvite(encodeURIComponent(raw)).partyId, PARTY_ID);
  return true;
});

await check('malformed invites return null rather than throwing', () => {
  const url = encodeInvite(session, { origin: 'https://example.test' });
  const raw = url.slice(url.indexOf('#') + 1);
  const b64 = (obj) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(obj))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const cases = [
    '',
    null,
    undefined,
    7,
    'https://example.test/join', // no fragment at all
    'https://example.test/join#', // empty fragment
    'https://example.test/join#not-base64-json',
    `#${b64({ v: 99, p: 'x', c: 'ABC234', k: 'k' })}`, // wrong invite version
    `#${b64({ v: 1, c: 'ABC234', k: 'k' })}`, // no party id
    `#${b64({ v: 1, p: 'x', k: 'k' })}`, // no code
    `#${b64({ v: 1, p: 'x', c: 'ABC234' })}`, // no key
    `#${b64({ v: 1, p: 'x', c: 'ABC234', k: 'k', t: 9 })}`, // token of the wrong type
    `#${b64([1, 2, 3])}`,
  ];
  cases.forEach((c, i) => assert.equal(decodeInvite(c), null, `case ${i}: ${String(c).slice(0, 40)}`));
  // The good one still decodes, so the loop above is not passing vacuously.
  assert.ok(decodeInvite(raw));
  return true;
});

await check('an invite with no endpoints still decodes', () => {
  const bare = createSession({ partyId: PARTY_ID, code: 'ABC234', keyString: 'k', token: '' });
  const back = decodeInvite(encodeInvite(bare, { origin: 'https://example.test' }));
  assert.deepEqual(back.endpoints, []);
  assert.equal(back.token, '');
  return true;
});

await check('codes are six characters from the safe alphabet', () => {
  for (let i = 0; i < 200; i += 1) {
    const code = newPartyCode();
    assert.equal(code.length, 6, code);
    assert.equal(/^[A-HJ-NP-Z2-9]{6}$/.test(code), true, code);
    for (const ch of code) assert.ok(CODE_ALPHABET.includes(ch), code);
  }
  return true;
});

await check('normalizeCode is forgiving about how a code was typed', () => {
  assert.equal(normalizeCode(' abc-234 '), 'ABC234');
  assert.equal(normalizeCode('abc 234'), 'ABC234');
  assert.equal(normalizeCode('ABC234EXTRA'), 'ABC234');
  // I, O, 0 and 1 are not in the alphabet and are stripped, not mapped.
  assert.equal(normalizeCode('AIOB01C2'), 'ABC2');
  assert.equal(normalizeCode(null), '');
  return true;
});

/* ------------------------------------------------------------ election --- */

section('party/election');

const CANDIDATE = { battery: 0.5, signal: 0.5, network: 0.5, performance: 0.5, joinOrder: 5 };
const with_ = (patch) => scoreCandidate({ ...CANDIDATE, ...patch });

await check('battery outranks everything below it', () => {
  const flat = with_({ battery: 0.9, signal: 0, network: 0, performance: 0, joinOrder: 1e6 });
  const loaded = with_({ battery: 0.89, signal: 1, network: 1, performance: 1, joinOrder: 0 });
  assert.ok(flat > loaded, `${flat} !> ${loaded}`);
  return true;
});

await check('signal breaks a battery tie and outranks network below it', () => {
  const a = with_({ signal: 0.6, network: 0, performance: 0, joinOrder: 1e6 });
  const b = with_({ signal: 0.59, network: 1, performance: 1, joinOrder: 0 });
  assert.ok(a > b, `${a} !> ${b}`);
  return true;
});

await check('network breaks a signal tie and outranks performance', () => {
  const a = with_({ network: 0.6, performance: 0, joinOrder: 1e6 });
  const b = with_({ network: 0.59, performance: 1, joinOrder: 0 });
  assert.ok(a > b, `${a} !> ${b}`);
  return true;
});

await check('performance breaks a network tie and outranks join order', () => {
  const a = with_({ performance: 0.6, joinOrder: 1e6 });
  const b = with_({ performance: 0.59, joinOrder: 0 });
  assert.ok(a > b, `${a} !> ${b}`);
  return true;
});

await check('join order is the final tiebreak, earlier wins', () => {
  const first = with_({ joinOrder: 0 });
  const second = with_({ joinOrder: 1 });
  const late = with_({ joinOrder: 40 });
  assert.ok(first > second && second > late);
  return true;
});

await check('a charging phone scores as a full battery', () => {
  const charging = with_({ battery: { level: 0.05, charging: true } });
  const full = with_({ battery: 1 });
  assert.equal(charging, full);
  assert.ok(charging > with_({ battery: { level: 0.99, charging: false } }));
  return true;
});

await check('hostile or missing inputs score finite and low', () => {
  for (const c of [undefined, {}, { battery: NaN }, { battery: 'full', signal: 'great' }, { joinOrder: -3 }]) {
    const s = scoreCandidate(c);
    assert.ok(Number.isFinite(s), JSON.stringify(c));
  }
  assert.ok(scoreCandidate({}) < with_({}));
  // Out-of-range numbers are clamped, not trusted.
  assert.equal(with_({ battery: 99 }), with_({ battery: 1 }));
  assert.equal(with_({ battery: -5 }), with_({ battery: 0 }));
  return true;
});

await check('a three-peer election converges on exactly one winner', () => {
  const HOST_TIMEOUT = 12000;
  const CLAIM_WINDOW = 2500;
  let clock = 0;
  const nodes = new Map();

  const spec = [
    { id: 'phone-a', candidate: { battery: 0.4, signal: 1, network: 1, performance: 1, joinOrder: 0 } },
    { id: 'phone-b', candidate: { battery: 0.9, signal: 0.2, network: 1, performance: 0.3, joinOrder: 2 } },
    { id: 'phone-c', candidate: { battery: 0.7, signal: 1, network: 1, performance: 1, joinOrder: 1 } },
  ];

  for (const { id, candidate } of spec) {
    const election = createElection({
      selfId: id,
      getCandidate: () => candidate,
      getSnapshot: () => ({ version: 3 }),
      now: () => clock,
      hostTimeoutMs: HOST_TIMEOUT,
      claimWindowMs: CLAIM_WINDOW,
      // Driven by tick() against a fake clock, so real timers are stubbed out.
      setTimeoutFn: () => 0,
      clearTimeoutFn: () => {},
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
      send: (kind, body) => {
        for (const [peerId, peer] of nodes) {
          if (peerId === id) continue;
          const f = { kind, from: id, to: EVERYONE, body, seq: 1, ts: clock };
          if (kind === CLAIM) peer.handleClaim(f);
          else if (kind === VICTORY) peer.handleVictory(f);
        }
      },
    });
    nodes.set(id, election);
  }

  for (const n of nodes.values()) n.start();

  // Nobody has heard from the host in longer than the timeout.
  clock = HOST_TIMEOUT + 1;
  for (const n of nodes.values()) n.tick();
  assert.ok([...nodes.values()].some((n) => n.isElecting()), 'no election started');

  // The claim window closes.
  clock += CLAIM_WINDOW + 1;
  for (const n of nodes.values()) n.tick();

  const promoted = [...nodes.entries()].filter(([, n]) => n.isPromoted());
  assert.equal(promoted.length, 1, `promoted: ${promoted.map(([id]) => id).join(',') || 'nobody'}`);
  // Best battery wins outright, whatever its radio and however late it joined.
  assert.equal(promoted[0][0], 'phone-b');
  for (const [id, n] of nodes) assert.equal(n.leader(), 'phone-b', `${id} disagrees`);
  assert.ok([...nodes.values()].every((n) => !n.isElecting()), 'an election is still running');

  // Settling: further ticks must not produce a second host.
  clock += HOST_TIMEOUT * 3;
  for (const n of nodes.values()) n.tick();
  assert.equal([...nodes.values()].filter((n) => n.isPromoted()).length, 1, 'a second host appeared');
  for (const n of nodes.values()) n.stop();
  return true;
});

await check('host traffic during an election stands the election down', () => {
  let clock = 0;
  const election = createElection({
    selfId: 'phone-a',
    getCandidate: () => ({ battery: 1, joinOrder: 0 }),
    send: () => {},
    now: () => clock,
    hostTimeoutMs: 12000,
    claimWindowMs: 2500,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  election.start();
  clock = 12001;
  election.tick();
  assert.equal(election.isElecting(), true);
  election.noteHostSeen('the-host');
  assert.equal(election.isElecting(), false, 'kept campaigning against a live host');
  clock += 3000;
  election.tick();
  assert.equal(election.isPromoted(), false, 'promoted itself over a live host');
  assert.equal(election.leader(), 'the-host');
  election.stop();
  return true;
});

/* --------------------------------------------------------- gps/adaptive -- */

section('gps/adaptive');

await check('classifyMotion reads the GPS speed field first', () => {
  assert.equal(classifyMotion({ speed: 1.4 }), MOTION.WALKING);
  assert.equal(classifyMotion({ speed: 0.34 }), MOTION.STANDING);
  assert.equal(classifyMotion({ speed: 0.35 }), MOTION.WALKING);
  assert.equal(classifyMotion({ speed: 0 }), MOTION.STANDING);
  return true;
});

await check('a backgrounded tab outranks any speed reading', () => {
  assert.equal(classifyMotion({ speed: 9, isBackground: true }), MOTION.BACKGROUND);
  assert.equal(classifyMotion({ isBackground: true }), MOTION.BACKGROUND);
  return true;
});

await check('unknown speed reports standing', () => {
  assert.equal(classifyMotion(), MOTION.STANDING);
  assert.equal(classifyMotion({}), MOTION.STANDING);
  assert.equal(classifyMotion({ speed: -1 }), MOTION.STANDING);
  assert.equal(classifyMotion({ recent: [] }), MOTION.STANDING);
  return true;
});

await check('speed falls back to the last two samples over a real gap', () => {
  // ~22 m in 4 s is a walk; the same move in 500 ms is jitter and is ignored.
  const a = { lat: 39.34395, lng: -84.2673, ts: 0 };
  const walked = { lat: 39.34415, lng: -84.2673, ts: 4000 };
  assert.equal(classifyMotion({ recent: [a, walked] }), MOTION.WALKING);
  assert.equal(classifyMotion({ recent: [a, { ...walked, ts: 500 }] }), MOTION.STANDING);
  // Standing still over a long gap is standing.
  assert.equal(classifyMotion({ recent: [a, { ...a, ts: 10000 }] }), MOTION.STANDING);
  // A malformed sample is not trusted as evidence of motion.
  assert.equal(classifyMotion({ recent: [{ lat: 'x', lng: 0, ts: 0 }, walked] }), MOTION.STANDING);
  return true;
});

await check('cadence bands differ per motion state', () => {
  assert.deepEqual(CADENCE[MOTION.WALKING], { min: 3000, max: 5000 });
  const healthy = { battery: { level: 0.8, charging: false } };
  assert.equal(cadenceFor(MOTION.WALKING, healthy), 3000);
  assert.equal(cadenceFor(MOTION.STANDING, healthy), 15000);
  assert.equal(cadenceFor(MOTION.BACKGROUND, healthy), 60000);
  assert.ok(cadenceFor(MOTION.STANDING, healthy) > cadenceFor(MOTION.WALKING, healthy));
  assert.ok(cadenceFor(MOTION.BACKGROUND, healthy) > cadenceFor(MOTION.STANDING, healthy));
  return true;
});

await check('a draining battery slides the cadence to the slow end', () => {
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { level: 0.5, charging: false } }), 3000);
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { level: 0.35, charging: false } }), 4000);
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { level: 0.2, charging: false } }), 5000);
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { level: 0.05, charging: false } }), 5000);
  assert.equal(cadenceFor(MOTION.BACKGROUND, { battery: { level: 0.2, charging: false } }), 120000);
  return true;
});

await check('charging and unknown batteries sample at the fast end', () => {
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { level: 0.05, charging: true } }), 3000);
  assert.equal(cadenceFor(MOTION.WALKING, {}), 3000);
  assert.equal(cadenceFor(MOTION.WALKING), 3000);
  assert.equal(cadenceFor(MOTION.WALKING, { battery: { charging: false } }), 3000);
  // An unknown motion state falls back to the standing band, not to nothing.
  assert.equal(cadenceFor('teleporting', {}), CADENCE[MOTION.STANDING].min);
  return true;
});

await check('the gate always sends the first fix, then rate-limits', () => {
  const gate = createBroadcastGate();
  const at = (ts, patch = {}) => ({ lat: 39.34395, lng: -84.2673, ts, ...patch });
  assert.deepEqual(gate.shouldSend(at(0), { now: 0 }), { send: true, reason: 'first' });
  assert.deepEqual(gate.shouldSend(at(500), { now: 500 }), { send: false, reason: 'rate-limited' });
  assert.deepEqual(gate.shouldSend(at(4000), { now: 4000 }), { send: false, reason: 'unchanged' });
  return true;
});

await check('the gate refuses an invalid fix', () => {
  const gate = createBroadcastGate();
  assert.deepEqual(gate.shouldSend(null, { now: 0 }), { send: false, reason: 'invalid' });
  assert.deepEqual(gate.shouldSend({ lat: 200, lng: 0 }, { now: 0 }), { send: false, reason: 'invalid' });
  assert.deepEqual(gate.shouldSend({ lat: 39, lng: 'west' }, { now: 0 }), { send: false, reason: 'invalid' });
  return true;
});

await check('the gate sends on distance, heading, target and heartbeat', () => {
  const gate = createBroadcastGate({ minIntervalMs: 3000, distanceM: 12, headingDeg: 25, heartbeatMs: 20000 });
  const base = { lat: 39.34395, lng: -84.2673 };

  assert.equal(gate.shouldSend({ ...base, heading: 10, ts: 0 }, { now: 0 }).reason, 'first');
  // ~22 m north.
  assert.deepEqual(gate.shouldSend({ ...base, lat: 39.34415, heading: 10, ts: 4000 }, { now: 4000 }), {
    send: true,
    reason: 'moved',
  });
  // Standing still but turning to face a ride.
  assert.deepEqual(gate.shouldSend({ lat: 39.34415, lng: -84.2673, heading: 60, ts: 8000 }, { now: 8000 }), {
    send: true,
    reason: 'heading',
  });
  // Tapping a ride is worth a send, but the rate limit caps it: a friend
  // thumbing down the ride list must not become a packet storm.
  const still = { lat: 39.34415, lng: -84.2673, heading: 70 };
  assert.deepEqual(gate.shouldSend({ ...still, ts: 9000 }, { now: 9000, target: 'beast' }), {
    send: false,
    reason: 'rate-limited',
  });
  assert.deepEqual(gate.shouldSend({ ...still, ts: 11500 }, { now: 11500, target: 'beast' }), {
    send: true,
    reason: 'target',
  });
  // Under the heading threshold, stationary, same target: not worth a wakeup.
  assert.deepEqual(gate.shouldSend({ ...still, ts: 15000 }, { now: 15000, target: 'beast' }), {
    send: false,
    reason: 'unchanged',
  });
  // Nothing at all happens for the heartbeat interval.
  assert.deepEqual(gate.shouldSend({ ...still, ts: 31501 }, { now: 31501, target: 'beast' }), {
    send: true,
    reason: 'heartbeat',
  });
  return true;
});

await check('the compass supplies a heading when the GPS has none', () => {
  const gate = createBroadcastGate();
  const base = { lat: 39.34395, lng: -84.2673 };
  gate.shouldSend({ ...base, ts: 0 }, { now: 0, heading: 0 });
  assert.deepEqual(gate.shouldSend({ ...base, ts: 4000 }, { now: 4000, heading: 90 }), {
    send: true,
    reason: 'heading',
  });
  return true;
});

await check('reset makes the gate treat the next fix as the first', () => {
  const gate = createBroadcastGate();
  const base = { lat: 39.34395, lng: -84.2673 };
  gate.shouldSend({ ...base, ts: 0 }, { now: 0 });
  assert.equal(gate.shouldSend({ ...base, ts: 100 }, { now: 100 }).send, false);
  gate.reset();
  assert.deepEqual(gate.shouldSend({ ...base, ts: 200 }, { now: 200 }), { send: true, reason: 'first' });
  return true;
});

/* -------------------------------------------------------------- routing -- */

/* The router is only as good as the geometry under it, so these run against
   the real park file rather than a hand-made toy graph: a fixture that routes
   perfectly and a park that does not is the failure mode worth catching. */

const PARK = JSON.parse(
  fs.readFileSync(new URL('../public/venues/kings-island.map.json', import.meta.url), 'utf8'),
);
const RIDES = JSON.parse(
  fs.readFileSync(new URL('../public/venues/kings-island.pois.json', import.meta.url), 'utf8'),
);
const poi = (name) => {
  const hit = RIDES.find((p) => p.n === name);
  if (!hit) throw new Error(`no POI named ${name}`);
  return hit;
};

section('routing/graph');

const graph = buildRouteGraph(PARK);

await check('the park file builds a graph with paths in it', () => {
  assert.ok(graph.nodes.length > 1000, `${graph.nodes.length} nodes`);
  assert.ok(graph.segments.length > 1000, `${graph.segments.length} segments`);
  return true;
});

await check('a file with no paths builds nothing rather than throwing', () => {
  assert.equal(buildRouteGraph({ path: [], service: [] }), null);
  assert.equal(buildRouteGraph(null), null);
  return true;
});

await check('the repair passes leave one dominant piece of network', () => {
  const label = new Map();
  let biggest = 0;
  graph.nodes.forEach((_, i) => {
    if (label.has(i)) return;
    const id = label.size;
    let size = 0;
    const stack = [i];
    label.set(i, id);
    while (stack.length) {
      const v = stack.pop();
      size += 1;
      graph.nodes[v].edges.forEach((e) => {
        if (!label.has(e.to)) {
          label.set(e.to, id);
          stack.push(e.to);
        }
      });
    }
    biggest = Math.max(biggest, size);
  });
  // Before the crossing, stitching and mending passes this was 60%.
  assert.ok(biggest / graph.nodes.length > 0.85, `largest piece ${biggest}/${graph.nodes.length}`);
  return true;
});

await check('every ride snaps onto the network, close by', () => {
  const rides = RIDES.filter((p) => p.c === 'coaster' || p.c === 'ride');
  const misses = rides.filter((p) => !snapToGraph(graph, p.lat, p.lng));
  assert.deepEqual(misses.map((p) => p.n), []);
  const worst = Math.max(...rides.map((p) => snapToGraph(graph, p.lat, p.lng).offset));
  assert.ok(worst < MAX_SNAP_M, `worst snap ${worst.toFixed(0)} m`);
  return true;
});

await check('snapping lands on the path, not on the query point', () => {
  const beast = poi('The Beast');
  const snap = snapToGraph(graph, beast.lat, beast.lng);
  const drift = distance(beast.lat, beast.lng, snap.lat, snap.lng);
  assert.ok(Math.abs(drift - snap.offset) < 2, `${drift} vs ${snap.offset}`);
  return true;
});

section('routing/attributes');

/* What OpenStreetMap says about a way, beyond its shape and its name.
 *
 * Until these arrived, every feature in `map.path` had two keys and the router
 * costed a flight of stairs at exactly the price of flat midway. These tests
 * hold two things at once: that the facts reach the graph, and — the one that
 * matters more — that carrying them moves nothing. Costs are a separate change
 * on purpose, so that when the costs do change the route diff means something.
 */

/** Two ways crossing in plan view, one of them a bridge over the other. */
const CROSSING = {
  path: [
    { r: [[-84.2680, 39.3420], [-84.2660, 39.3420]], n: 'The overpass', f: WAY_FLAGS.BRIDGE, l: 1 },
    { r: [[-84.2670, 39.3410], [-84.2670, 39.3430]], n: 'The midway' },
    { r: [[-84.2660, 39.3420], [-84.2650, 39.3426]], n: 'Steps to the midway', f: WAY_FLAGS.STEPS },
  ],
  service: [
    { r: [[-84.2650, 39.3426], [-84.2640, 39.3426]], n: 'Back road', f: WAY_FLAGS.ONEWAY | WAY_FLAGS.RESTRICTED },
  ],
};

await check('a flight of steps arrives in the graph marked as steps', () => {
  const g = buildRouteGraph(CROSSING);
  const steps = g.segments.filter((s) => hasWayFlag(s.flags, WAY_FLAGS.STEPS));
  assert.ok(steps.length > 0, 'no segment came through marked as steps');
  assert.deepEqual([...new Set(steps.map((s) => s.name))], ['Steps to the midway']);
  // Still walkable, and still costed as ordinary path. Marking them is this
  // change; charging for them is the next one.
  assert.deepEqual([...new Set(steps.map((s) => s.kind))], ['path']);
  assert.deepEqual([...new Set(steps.map((s) => s.factor))], [1]);
  return true;
});

await check('a bridge keeps its layer, and the way underneath keeps the ground', () => {
  const g = buildRouteGraph(CROSSING);
  const over = g.segments.filter((s) => s.name === 'The overpass');
  const under = g.segments.filter((s) => s.name === 'The midway');
  assert.ok(over.length && under.length);
  assert.ok(over.every((s) => hasWayFlag(s.flags, WAY_FLAGS.BRIDGE)), 'the bridge lost its flag');
  assert.deepEqual([...new Set(over.map((s) => s.layer))], [1]);
  assert.deepEqual([...new Set(under.map((s) => s.layer))], [0]);
  /* The two still weld into a junction, because that is what the router does
     today and this change is not allowed to alter it. What it now has is the
     evidence that the junction is invented — which is the whole point of
     carrying `layer` before anything spends it. */
  assert.ok(over.length > 1 && under.length > 1, 'the crossing was not cut');
  return true;
});

await check('a one-way service road says which way, and who is allowed down it', () => {
  const g = buildRouteGraph(CROSSING);
  const road = g.segments.filter((s) => s.name === 'Back road');
  assert.ok(road.length > 0);
  assert.ok(road.every((s) => hasWayFlag(s.flags, WAY_FLAGS.ONEWAY)));
  assert.ok(road.every((s) => hasWayFlag(s.flags, WAY_FLAGS.RESTRICTED)));
  assert.ok(road.every((s) => !hasWayFlag(s.flags, WAY_FLAGS.ONEWAY_BACK)));
  // Read, not obeyed: index() still pushes both directions, unchanged.
  const [seg] = road;
  assert.ok(g.nodes[seg.a].edges.some((e) => e.to === seg.b));
  assert.ok(g.nodes[seg.b].edges.some((e) => e.to === seg.a));
  return true;
});

await check('the attributes survive the round trip from tags to bundle to graph', () => {
  const way = (id, tags, coords) => ({
    type: 'way',
    id,
    tags,
    geometry: coords.map(([lng, lat]) => ({ lat, lon: lng })),
  });
  const { layers } = buildLayers(
    [
      way(1, { highway: 'steps', name: 'Sky Ride Stairs' }, [[-84.2680, 39.3420], [-84.2676, 39.3420]]),
      way(2, { highway: 'footway', bridge: 'yes', layer: '2', name: 'The overpass' }, [
        [-84.2676, 39.3420], [-84.2670, 39.3420],
      ]),
      way(3, { highway: 'service', oneway: '-1', access: 'private', name: 'Back road' }, [
        [-84.2670, 39.3420], [-84.2664, 39.3420],
      ]),
      way(4, { highway: 'footway', name: 'Plain midway' }, [[-84.2664, 39.3420], [-84.2658, 39.3420]]),
    ],
    {
      tolerance: 1.2,
      minArea: 12,
      venueArea: 1e6,
      venueName: 'Nowhere',
      annexed: new Set(),
      clip: { south: 39.34, west: -84.28, north: 39.35, east: -84.26 },
    },
  );

  // Through the exact bytes that ship, because that is what the phone parses.
  const bundle = JSON.parse(JSON.stringify({ path: layers.path, service: layers.service }));
  const byName = Object.fromEntries(
    [...bundle.path, ...bundle.service].map((feat) => [feat.n, feat]),
  );
  assert.equal(wayFlagsOf(byName['Sky Ride Stairs']), WAY_FLAGS.STEPS);
  assert.equal(wayFlagsOf(byName['The overpass']), WAY_FLAGS.BRIDGE);
  assert.equal(wayLayerOf(byName['The overpass']), 2);
  assert.equal(
    wayFlagsOf(byName['Back road']),
    WAY_FLAGS.ONEWAY_BACK | WAY_FLAGS.RESTRICTED,
  );
  // A way with nothing to add is written exactly as it always was.
  assert.deepEqual(Object.keys(byName['Plain midway']), ['r', 'n']);

  const g = buildRouteGraph(bundle);
  const flagsOf = (name) => g.segments.filter((s) => s.name === name).map((s) => s.flags);
  assert.deepEqual(flagsOf('Sky Ride Stairs'), [WAY_FLAGS.STEPS]);
  assert.deepEqual(flagsOf('Plain midway'), [0]);
  assert.deepEqual(g.segments.filter((s) => s.name === 'The overpass').map((s) => s.layer), [2]);
  return true;
});

await check('a venue built before the attributes existed still loads and routes', () => {
  /* The four bundles on disk were built before any of this and carry no `f`
     and no `l` anywhere. They have to keep working untouched — a data change
     that needs every venue rebuilt before the app runs is not shippable. */
  const shipped = JSON.stringify(PARK);
  assert.ok(!/"f":/.test(shipped) && !/"l":/.test(shipped), 'the fixture already carries attributes');
  const g = buildRouteGraph(PARK);
  assert.ok(g.segments.every((s) => s.flags === 0 && s.layer === 0));
  const r = findRoute(graph, poi('The Beast'), poi('Orion'), { landmarks: RIDES, destination: 'Orion' });
  assert.ok(r && r.metres > 0);
  return true;
});

await check('carrying the attributes moves no route at all', () => {
  /* The important one. This change puts data in the bundle and reads it into
     the graph, and is not allowed to move a single route by a single metre —
     so the same park is routed twice, once plain and once with an attribute on
     every way, and the two answers are compared as bytes. */
  const attributed = JSON.parse(JSON.stringify(PARK));
  let marked = 0;
  ['path', 'service'].forEach((key) => {
    (attributed[key] || []).forEach((feat, i) => {
      if (Array.isArray(feat)) return;
      // Deliberately heavy-handed: every third way is steps, every fifth a
      // bridge two levels up, every seventh one-way and back of house.
      let f = 0;
      if (i % 3 === 0) f |= WAY_FLAGS.STEPS;
      if (i % 5 === 0) f |= WAY_FLAGS.BRIDGE;
      if (i % 7 === 0) f |= WAY_FLAGS.ONEWAY | WAY_FLAGS.RESTRICTED;
      if (i % 11 === 0) f |= WAY_FLAGS.TUNNEL;
      if (f) {
        feat.f = f;
        marked += 1;
      }
      if (i % 5 === 0) feat.l = 2;
    });
  });
  assert.ok(marked > 300, `${marked} ways marked`);

  const plain = buildRouteGraph(PARK);
  const loaded = buildRouteGraph(attributed);
  assert.equal(loaded.segments.length, plain.segments.length);
  assert.ok(loaded.segments.some((s) => hasWayFlag(s.flags, WAY_FLAGS.STEPS)), 'nothing was marked');

  // Every edge costs the same, so every search over them answers the same.
  const costOf = (g) => g.segments.map((s) => `${s.a}-${s.b}:${s.kind}:${s.len.toFixed(6)}:${s.factor}`);
  assert.deepEqual(costOf(loaded), costOf(plain));

  const places = RIDES.filter((p) => p.c === 'coaster' || p.c === 'ride')
    .sort((a, b) => a.n.localeCompare(b.n));
  const pairs = [];
  for (let i = 0; i < places.length; i += 5) {
    for (let j = 2; j < places.length; j += 7) {
      if (i !== j) pairs.push([places[i], places[j]]);
    }
  }
  assert.ok(pairs.length > 100, `${pairs.length} pairs`);
  const routesOf = (g) =>
    JSON.stringify(pairs.map(([a, b]) => findRoute(g, a, b, { landmarks: RIDES, destination: b.n })));
  assert.equal(routesOf(loaded), routesOf(plain));
  return true;
});

section('routing/routes');

await check('a route follows the paths and is longer than the crow flies', () => {
  const from = poi('The Beast');
  const to = poi('Orion');
  const r = findRoute(graph, from, to, { landmarks: RIDES, destination: to.n });
  const crow = distance(from.lat, from.lng, to.lat, to.lng);
  assert.equal(r.mode, 'path');
  assert.ok(r.metres > crow, 'a walk is never shorter than the straight line');
  assert.ok(r.points.length > 10, `${r.points.length} points`);
  assert.ok(r.seconds > 0);
  return true;
});

await check('neighbouring rides do not route the long way round', () => {
  // Both of these used to come back as 1.3 km walks between points 250 m
  // apart, because the paths beside them were drawn without being joined.
  [['The Beast', 'Diamondback'], ['Mystic Timbers', 'The Beast']].forEach(([a, b]) => {
    const r = findRoute(graph, poi(a), poi(b), { landmarks: RIDES, destination: b });
    const crow = distance(poi(a).lat, poi(a).lng, poi(b).lat, poi(b).lng);
    assert.equal(r.mode, 'path', `${a} -> ${b} fell back to a straight line`);
    assert.ok(r.metres < crow * 2.5, `${a} -> ${b} is ${Math.round(r.metres)} m for ${Math.round(crow)} m`);
  });
  return true;
});

await check('every pair of rides routes, and none absurdly', () => {
  const rides = RIDES.filter((p) => p.c === 'coaster');
  let worst = 0;
  rides.forEach((a) =>
    rides.forEach((b) => {
      if (a === b) return;
      const r = findRoute(graph, a, b, { landmarks: RIDES, destination: b.n });
      assert.ok(r, `${a.n} -> ${b.n} returned nothing`);
      const crow = distance(a.lat, a.lng, b.lat, b.lng);
      if (crow > 100) worst = Math.max(worst, r.metres / crow);
    }),
  );
  assert.ok(worst < 3.5, `worst detour ${worst.toFixed(2)}x`);
  return true;
});

await check('with no graph the route is the straight line, not a crash', () => {
  const r = findRoute(null, poi('The Beast'), poi('Orion'), { destination: 'Orion' });
  assert.equal(r.mode, 'direct');
  assert.equal(r.points.length, 2);
  assert.ok(r.metres > 0);
  return true;
});

await check('a destination outside the park falls back to the straight line', () => {
  const r = findRoute(graph, poi('The Beast'), { lat: 39.29, lng: -84.31 }, { destination: 'home' });
  assert.equal(r.mode, 'direct');
  return true;
});

await check('missing or half-given ends route to nothing', () => {
  assert.equal(findRoute(graph, null, poi('Orion')), null);
  assert.equal(findRoute(graph, poi('Orion'), { lat: null, lng: null }), null);
  return true;
});

section('routing/directions');

await check('directions start with a heading and end at the destination', () => {
  const to = poi('Orion');
  const r = findRoute(graph, poi('The Beast'), to, { landmarks: RIDES, destination: to.n });
  assert.equal(r.steps[0].turn, 'depart');
  assert.match(r.steps[0].text, /^Head /);
  assert.equal(r.steps[r.steps.length - 1].turn, 'arrive');
  assert.equal(r.steps[r.steps.length - 1].text, 'Arrive at Orion');
  return true;
});

await check('a mile of park does not become forty instructions', () => {
  const r = findRoute(graph, poi('The Beast'), poi('Orion'), { landmarks: RIDES, destination: 'Orion' });
  // Reading turns off raw survey geometry gave one per bend. They are read off
  // a smoothed copy instead, and short hops fold into the step before them.
  assert.ok(r.steps.length < 16, `${r.steps.length} steps for ${Math.round(r.metres)} m`);
  r.steps.slice(1, -1).forEach((s, i) => {
    assert.ok(
      s.fromStart - r.steps[i].fromStart > 20,
      `steps ${i} and ${i + 1} are ${Math.round(s.fromStart - r.steps[i].fromStart)} m apart`,
    );
  });
  return true;
});

await check('turns are named after what you can see from them', () => {
  const r = findRoute(graph, poi('The Racer'), poi('Diamondback'), {
    landmarks: RIDES,
    destination: 'Diamondback',
  });
  const marked = r.steps.filter((s) => s.landmark);
  assert.ok(marked.length > 0, 'no step picked up a landmark');
  marked.forEach((s) => assert.ok(s.text.includes(s.landmark)));
  return true;
});

section('routing/progress');

const legRoute = findRoute(graph, poi('The Beast'), poi('Orion'), {
  landmarks: RIDES,
  destination: 'Orion',
});

await check('standing at the start leaves the whole walk to go', () => {
  const p = routeProgress(legRoute, legRoute.points[0][0], legRoute.points[0][1]);
  assert.ok(Math.abs(p.remaining - legRoute.metres) < 5, `${p.remaining} vs ${legRoute.metres}`);
  assert.equal(p.arrived, false);
  assert.ok(p.offset < 1);
  return true;
});

await check('walking the line eats the distance and never goes backwards', () => {
  let last = Infinity;
  legRoute.points.forEach(([lat, lng]) => {
    const p = routeProgress(legRoute, lat, lng);
    assert.ok(p.remaining <= last + 1, `remaining rose from ${last} to ${p.remaining}`);
    assert.ok(p.offset < 1.5, `offset ${p.offset} standing on the route`);
    last = p.remaining;
  });
  assert.ok(last < 5, `${last} m left at the far end`);
  return true;
});

await check('reaching the end reads as arrived', () => {
  const end = legRoute.points[legRoute.points.length - 1];
  assert.equal(routeProgress(legRoute, end[0], end[1]).arrived, true);
  return true;
});

await check('wandering off the line is measured, not ignored', () => {
  const mid = legRoute.points[Math.floor(legRoute.points.length / 2)];
  const p = routeProgress(legRoute, mid[0] + 0.0009, mid[1]);
  assert.ok(p.offset > OFF_ROUTE_M, `${p.offset} m off, threshold ${OFF_ROUTE_M}`);
  return true;
});

await check('the next instruction is the one still ahead of you', () => {
  const start = routeProgress(legRoute, legRoute.points[0][0], legRoute.points[0][1]);
  assert.notEqual(start.step.turn, 'depart', 'the depart step is behind you the moment you set off');
  const end = legRoute.points[legRoute.points.length - 1];
  assert.equal(routeProgress(legRoute, end[0], end[1]).step.turn, 'arrive');
  assert.ok(start.toStep <= start.remaining + 1);
  return true;
});

await check('progress on nothing is nothing', () => {
  assert.equal(routeProgress(null, 39.34, -84.26), null);
  assert.equal(routeProgress(legRoute, null, null), null);
  return true;
});

section('routing/targets');

await check('a destination is identified by what it is, not where it was', () => {
  assert.equal(navKeyOf({ kind: 'member', id: 'abc', label: 'Ava' }), 'member:abc');
  assert.equal(navKeyOf({ kind: 'meet', label: 'Fountain' }), 'meet');
  assert.equal(navKeyOf({ kind: 'poi', label: 'Orion' }), 'poi:Orion');
  assert.equal(navKeyOf(null), null);
  // A member who has walked on is still the same destination.
  assert.equal(
    navKeyOf({ kind: 'member', id: 'abc', lat: 1, lng: 2 }),
    navKeyOf({ kind: 'member', id: 'abc', lat: 9, lng: 9 }),
  );
  return true;
});

section('routing/alternatives');

await check('a long walk comes with other ways to make it', () => {
  const rs = findRoutes(graph, poi('The Beast'), poi('Orion'), {
    landmarks: RIDES,
    destination: 'Orion',
    areas: PARK.landAnchors,
  });
  assert.ok(rs.length > 1, 'only one route offered');
  assert.equal(rs[0].mode, 'path');
  // Offered in order, and none of them a silly detour.
  rs.slice(1).forEach((r) => {
    assert.ok(r.metres >= rs[0].metres, 'the fastest route is not first');
    assert.ok(r.metres < rs[0].metres * 1.5, `${Math.round(r.metres)} m against ${Math.round(rs[0].metres)} m`);
  });
  return true;
});

await check('the alternatives are actually different roads', () => {
  const rs = findRoutes(graph, poi('The Beast'), poi('Orion'), {
    landmarks: RIDES,
    destination: 'Orion',
    areas: PARK.landAnchors,
  });
  const shared = (a, b) => {
    let n = 0;
    a.segments.forEach((s) => {
      if (b.segments.has(s)) n += 1;
    });
    return n / Math.min(a.segments.size, b.segments.size);
  };
  for (let i = 0; i < rs.length; i += 1) {
    for (let j = i + 1; j < rs.length; j += 1) {
      assert.ok(shared(rs[i], rs[j]) <= 0.7, `routes ${i} and ${j} are the same walk`);
    }
  }
  return true;
});

await check('each route is named after somewhere, and no two the same', () => {
  const rs = findRoutes(graph, poi('Banshee'), poi('Mystic Timbers'), {
    landmarks: RIDES,
    destination: 'Mystic Timbers',
    areas: PARK.landAnchors,
  });
  const vias = rs.map((r) => r.via);
  vias.forEach((v) => assert.ok(v, 'a route with no name to pick it out by'));
  assert.equal(new Set(vias).size, vias.length, `duplicate names: ${vias.join(', ')}`);
  return true;
});

await check('an alternative remembers what made it different', () => {
  const rs = findRoutes(graph, poi('The Beast'), poi('Orion'), {
    landmarks: RIDES,
    destination: 'Orion',
    areas: PARK.landAnchors,
  });
  assert.equal(rs[0].avoid, null, 'the fastest route avoids nothing');
  if (rs.length < 2) return true;
  assert.ok(rs[1].avoid?.size > 0, 'no weights kept for the alternative');
  // Rerouting with them replays the choice rather than reverting to the best.
  const again = findRoute(graph, poi('The Beast'), poi('Orion'), {
    landmarks: RIDES,
    destination: 'Orion',
    penalty: rs[1].avoid,
  });
  assert.ok(again.metres > rs[0].metres, 'the reroute snapped back to the fastest line');
  return true;
});

await check('one route is offered when only one is asked for', () => {
  const rs = findRoutes(graph, poi('The Beast'), poi('Orion'), { limit: 1 });
  assert.equal(rs.length, 1);
  return true;
});

section('routing/camera');

const camRoute = findRoute(graph, poi('The Beast'), poi('Orion'), {
  landmarks: RIDES,
  destination: 'Orion',
});

await check('the course looks up the route, not at the leg underfoot', () => {
  // Standing on the ride marker, the first leg is the little connector onto
  // the path — which points wherever the marker happens to sit. The camera
  // must not take its bearing from that.
  const from = poi('The Beast');
  const p = routeProgress(camRoute, from.lat, from.lng);
  const ahead = camRoute.points[6];
  const wanted = bearing(p.snapped[0], p.snapped[1], ahead[0], ahead[1]);
  const gap = Math.abs(((p.course - wanted + 540) % 360) - 180);
  assert.ok(gap < 70, `course ${Math.round(p.course)}° against ${Math.round(wanted)}° up the route`);
  return true;
});

await check('the course holds steady along a straight stretch', () => {
  const seen = [];
  camRoute.points.slice(1, 8).forEach(([lat, lng]) => {
    seen.push(routeProgress(camRoute, lat, lng).course);
  });
  const swings = seen.slice(1).map((c, i) => Math.abs(((c - seen[i] + 540) % 360) - 180));
  assert.ok(Math.max(...swings) < 120, `camera swung ${Math.round(Math.max(...swings))}° in one step`);
  return true;
});

await check('the line splits into walked and still to walk', () => {
  const mid = camRoute.points[Math.floor(camRoute.points.length / 2)];
  const p = routeProgress(camRoute, mid[0], mid[1]);
  const { done, ahead } = splitRouteAt(camRoute, p);
  assert.ok(done.length > 1 && ahead.length > 1);
  // The two halves meet exactly where the walker is, and between them they
  // are the whole route.
  assert.deepEqual(done[done.length - 1], ahead[0]);
  assert.equal(done.length + ahead.length, camRoute.points.length + 2);
  return true;
});

await check('with nowhere to be, none of the line is behind you', () => {
  assert.deepEqual(splitRouteAt(camRoute, null).done, []);
  assert.equal(splitRouteAt(camRoute, null).ahead.length, camRoute.points.length);
  assert.deepEqual(splitRouteAt(null, null), { done: [], ahead: [] });
  return true;
});

section('routing/instructions');

await check('two turns in a row do not name the same building', () => {
  const pairs = [
    ['The Beast', 'Orion'],
    ['Banshee', 'Mystic Timbers'],
    ['The Racer', 'Diamondback'],
  ];
  pairs.forEach(([a, b]) => {
    const r = findRoute(graph, poi(a), poi(b), { landmarks: RIDES, destination: b });
    r.steps.forEach((s, i) => {
      if (i === 0 || !s.landmark) return;
      assert.notEqual(s.landmark, r.steps[i - 1].landmark, `${a} -> ${b} says ${s.landmark} twice running`);
    });
  });
  return true;
});


section('map/symbols');

await check('every category has a symbol, a glyph and a name', () => {
  Object.keys(CATEGORY_LABELS).forEach((key) => {
    assert.ok(SYMBOLS[key], `${key} has no symbol`);
    assert.ok(GLYPHS[key]?.length, `${key} has no glyph art`);
    assert.ok(SYMBOLS[key].hint, `${key} has nothing to say in the key`);
  });
  return true;
});

/* Walks a path and returns every point the pen lands on. Only on-curve points
   are collected — control points may legitimately sit outside the artwork —
   which is enough to catch a glyph that has drifted out of its box. */
const PARAMS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
function penPoints(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const out = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let i = 0;
  let cmd = 'M';
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const key = cmd.toLowerCase();
    const rel = cmd === key && key !== 'z';
    const n = PARAMS[key];
    if (n == null) throw new Error(`unhandled path command ${cmd}`);
    const args = tokens.slice(i, i + n).map(Number);
    i += n;
    if (key === 'z') {
      x = startX;
      y = startY;
    } else if (key === 'h') {
      x = rel ? x + args[0] : args[0];
    } else if (key === 'v') {
      y = rel ? y + args[0] : args[0];
    } else {
      const [ex, ey] = args.slice(-2);
      x = rel ? x + ex : ex;
      y = rel ? y + ey : ey;
      if (key === 'm') {
        startX = x;
        startY = y;
      }
    }
    out.push([x, y]);
  }
  return out;
}

await check('glyph art stays inside its 24-unit box', () => {
  // A glyph that strays outside 0..24 collides with the disc or chip drawn
  // round it, which is how the coaster hill used to bleed into its own rim.
  Object.entries(GLYPHS).forEach(([name, parts]) => {
    parts.forEach((part) => {
      assert.ok(part.d, `${name} has an empty path`);
      assert.ok(part.mode === 'fill' || part.w > 0, `${name} strokes with no width`);
      penPoints(part.d).forEach(([x, y]) => {
        assert.ok(x >= 0 && x <= 24, `${name} strays to x=${x}`);
        assert.ok(y >= 0 && y <= 24, `${name} strays to y=${y}`);
      });
    });
  });
  return true;
});

await check('shape and rank separate what you came for from what you need', () => {
  assert.equal(symbolFor('coaster').shape, 'disc');
  assert.equal(symbolFor('food').shape, 'chip');
  assert.equal(symbolFor('gate').shape, 'pin');
  assert.equal(symbolFor('landmark').shape, 'diamond');
  // A coaster outranks a shop, so it wins the pixels and gets named first.
  assert.ok(symbolFor('coaster').rank < symbolFor('shop').rank);
  assert.ok(labelZoomFor(symbolFor('coaster').rank) < labelZoomFor(symbolFor('shop').rank));
  // An unknown category still gets drawn rather than throwing.
  assert.ok(symbolFor('nonsense').r > 0);
  return true;
});

await check('glyph ink is chosen against the fill, not assumed', () => {
  // A pale marker needs dark ink and a saturated one needs white. The dark ink
  // is plain black now that the palette is Apple's rather than the old void.
  assert.equal(inkOn('#FFFFFF'), '#000000');
  assert.equal(inkOn('#FFD60A'), '#000000');
  assert.equal(inkOn('#FF453A'), '#ffffff');
  assert.equal(inkOn('#2C2C2E'), '#ffffff');
  assert.equal(inkOn(null), '#ffffff');
  return true;
});

await check('markers grow with the map but nothing like as fast', () => {
  const wide = sizeAtZoom(9, 0.18);
  const close = sizeAtZoom(9, 6);
  assert.ok(wide > 6, 'still visible at the park-wide view');
  assert.ok(close < 12, 'not covering a midway at walking zoom');
  assert.ok(close > wide);
  return true;
});

await check('track names and catalogue names meet in the middle', () => {
  assert.equal(normaliseRideName('Racer (Red)'), normaliseRideName('The Racer'));
  assert.equal(normaliseRideName('Racer (Blue)'), normaliseRideName('The Racer'));
  assert.equal(normaliseRideName('Backlot Stunt Coaster'), 'backlot stunt coaster');
  assert.notEqual(normaliseRideName('The Beast'), normaliseRideName('Banshee'));
  assert.equal(normaliseRideName(null), '');
  return true;
});

/* Track that names a ride nobody has heard of can never be lit up. These are
   the ones OpenStreetMap still carries but the park no longer runs — a gap in
   the data, not in the matcher, and small enough to name. */
const RETIRED_TRACK = new Set(['goliath']);

await check('every named piece of track belongs to a ride we know', () => {
  const venues = JSON.parse(
    fs.readFileSync(new URL('../public/venues/manifest.json', import.meta.url)),
  ).venues;
  assert.ok(venues.length, 'no venues to check');
  venues.forEach((v) => {
    const read = (rel) =>
      JSON.parse(fs.readFileSync(new URL(`../public${rel}`, import.meta.url)));
    const catalogue = new Set();
    read(v.pois).forEach((p) => {
      catalogue.add(normaliseRideName(p.n));
      if (p.alias) catalogue.add(normaliseRideName(p.alias));
    });
    const orphans = [
      ...new Set(
        (read(v.map).coaster || [])
          .map((f) => normaliseRideName(f.n))
          .filter((n) => n && !catalogue.has(n) && !RETIRED_TRACK.has(n)),
      ),
    ];
    assert.deepEqual(orphans, [], `${v.id}: track with no ride to light up: ${orphans.join(', ')}`);
  });
  return true;
});

/* ------------------------------------------------------- height rules ---- */

/* Height rules are the one part of a venue OpenStreetMap will never carry, so
   they arrive from a hand-written overrides file or they do not arrive at all.
   A venue that has rides and no rules does not degrade gracefully — `hasHeights`
   comes back false and the app removes the Rides tab, the slider, the running
   tally, the badge over the map and the struck-through markers, silently and
   all at once. Two of the three parks shipped that way, so the rule that every
   park with rides publishes heights is worth holding a test to. */

const readVenues = () =>
  JSON.parse(fs.readFileSync(new URL('../public/venues/manifest.json', import.meta.url))).venues;
const readPois = (rel) => JSON.parse(fs.readFileSync(new URL(`../public${rel}`, import.meta.url)));

/* ---------------------------------------------------- the venue checklist -- */

const { checklist, failures } = await import('../scripts/lib/venue-checklist.mjs');
const {
  addressBook, assignKeys, keyAudit, osmRef, resolveOverride, seedLedger, serializeLedger,
} = await import('../scripts/lib/venue-ids.mjs');

await check('no venue ships half-built', () => {
  /* The list of what a location has to carry, held to. A park that is *almost*
     built does not crash: it draws, it lists, and one whole feature of the app
     silently is not there. This is the check that stops the next one shipping
     the way the first three did. */
  const venues = readVenues();
  assert.ok(venues.length, 'no venues to check');
  const shortfalls = [];
  venues.forEach((v) => {
    const map = JSON.parse(fs.readFileSync(new URL(`../public${v.map}`, import.meta.url)));
    const items = checklist(v, map, readPois(v.pois));
    failures(items).forEach((i) => shortfalls.push(`${v.id}: ${i.label} — ${i.detail}`));
  });
  assert.deepEqual(shortfalls, [], `\n  ${shortfalls.join('\n  ')}\n  Run: npm run venues:report`);
  return true;
});

await check('the checklist knows the difference between absent and not applicable', () => {
  const bare = { id: 'somewhere', locality: 'Town, State' };
  const map = { lands: [{ n: 'The Green' }], boundary: [[0, 0]], path: [[0, 0]] };
  // A town centre with no rides and no campground fails neither: an item that
  // does not apply is never a failure, or every venue that is not a theme park
  // would be permanently red.
  const items = checklist(bare, map, [
    { n: 'Gate', c: 'gate', lat: 0, lng: 0 },
    { n: 'Toilets', c: 'restroom', lat: 0, lng: 0 },
    { n: 'Cafe', c: 'food', lat: 0, lng: 0 },
  ]);
  assert.deepEqual(failures(items), []);
  assert.equal(items.find((i) => i.key === 'heights').status, 'n/a');
  assert.equal(items.find((i) => i.key === 'camping').status, 'n/a');

  // But a venue with rides and no rules is a failure, and says what to type.
  const park = checklist(bare, map, [{ n: 'Big One', c: 'coaster', lat: 0, lng: 0 }]);
  const heights = park.find((i) => i.key === 'heights');
  assert.equal(heights.status, 'missing');
  assert.equal(heights.required, true);
  assert.match(heights.fix, /overrides\.json/);

  // A venue built before keys existed is not half-built either: it loads on the
  // fallback, and rebuilding it is what issues them.
  assert.equal(items.find((i) => i.key === 'keys').status, 'n/a');
  return true;
});

await check('two places under one key fail the checklist rather than warning', () => {
  /* This is the item the whole scheme exists for. Everything else on this list
     is a feature that will be missing; a duplicate key is an edit filed against
     the wrong place, so it is required and the build refuses. */
  const bare = { id: 'somewhere', locality: 'Town, State' };
  const map = { lands: [{ n: 'The Green' }], boundary: [[0, 0]], path: [[0, 0]] };
  const clash = checklist(bare, map, [
    { i: 'toilets', n: 'Toilets', c: 'restroom', lat: 0, lng: 0 },
    { i: 'toilets', n: 'Toilets', c: 'restroom', lat: 1, lng: 1 },
    { i: 'gate', n: 'Gate', c: 'gate', lat: 0, lng: 0 },
    { i: 'cafe', n: 'Cafe', c: 'food', lat: 0, lng: 0 },
  ]);
  const keys = clash.find((i) => i.key === 'keys');
  assert.equal(keys.status, 'missing');
  assert.equal(keys.required, true);
  assert.match(keys.detail, /"toilets"/);
  assert.ok(failures(clash).some((i) => i.key === 'keys'));

  // Half-keyed is a failure too: something wrote a place into the bundle
  // without going through the ledger.
  const half = checklist(bare, map, [
    { i: 'gate', n: 'Gate', c: 'gate', lat: 0, lng: 0 },
    { n: 'Toilets', c: 'restroom', lat: 0, lng: 0 },
    { i: 'cafe', n: 'Cafe', c: 'food', lat: 0, lng: 0 },
  ]);
  assert.equal(half.find((i) => i.key === 'keys').status, 'missing');

  // And a fully keyed venue passes, which is the state a rebuild leaves.
  const good = checklist(bare, map, [
    { i: 'gate', n: 'Gate', c: 'gate', lat: 0, lng: 0 },
    { i: 'toilets', n: 'Toilets', c: 'restroom', lat: 0, lng: 0 },
    { i: 'cafe', n: 'Cafe', c: 'food', lat: 0, lng: 0 },
  ]);
  assert.equal(good.find((i) => i.key === 'keys').status, 'ok');
  assert.deepEqual(failures(good), []);
  return true;
});

await check('every park with rides publishes height rules', () => {
  const venues = readVenues();
  assert.ok(venues.length, 'no venues to check');
  venues.forEach((v) => {
    const pois = readPois(v.pois);
    const rides = pois.filter((p) => p.c === 'coaster' || p.c === 'ride');
    if (!rides.length) return;
    const withHeights = rides.filter((p) => p.h);
    assert.ok(
      withHeights.length,
      `${v.id}: ${rides.length} rides and not one height rule — the Rides tab would not exist`,
    );
    // The manifest is what the venue list reads, so it has to agree with the
    // file rather than being a number written down once.
    assert.equal(v.counts.heights, pois.filter((p) => p.h).length, `${v.id}: manifest miscounts heights`);
  });
  return true;
});

await check('a height rule reads low to high, in inches a person could be', () => {
  readVenues().forEach((v) => {
    readPois(v.pois).forEach((p) => {
      if (!p.h) return;
      const { min, alone, max } = p.h;
      const where = `${v.id}/${p.n}`;
      [['min', min], ['alone', alone], ['max', max]].forEach(([key, n]) => {
        if (n == null) return;
        assert.equal(typeof n, 'number', `${where}: ${key} is not a number`);
        // A min of 0 is how "posts a rule, but no floor" is written — heightLabel
        // reads it back as "No minimum". Anything else has to be a height a
        // person could stand up and be measured at.
        if (key === 'min' && n === 0) return;
        assert.ok(n >= 24 && n <= 96, `${where}: ${key}=${n}" is not a height a visitor has`);
      });
      // A floor above the height you may ride alone at, or above the ceiling,
      // makes eligibility() answer 'no' for everybody — a rule nobody meets is
      // indistinguishable from a ride that is shut.
      if (min != null && alone != null) assert.ok(min <= alone, `${where}: min above alone`);
      if (min != null && max != null) assert.ok(min < max, `${where}: min at or above max`);
      assert.ok(min != null || alone != null || max != null, `${where}: an empty height rule`);
    });
  });
  return true;
});

await check('every override is filed under a name the venue actually has', () => {
  const dir = new URL('../data/venues/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.overrides.json'));
  assert.ok(files.length, 'no overrides files to check');
  files.forEach((file) => {
    const id = file.slice(0, -'.overrides.json'.length);
    const overrides = JSON.parse(fs.readFileSync(new URL(file, dir)));
    /* Through the resolver the build itself uses, rather than a second copy of
       its rules living here: a name, then the name the park renamed it from,
       then — for the entries a name cannot address on its own — a key. A test
       that reimplemented that would go on passing after the build stopped
       agreeing with it. */
    const book = addressBook(readPois(`/venues/${id}.pois.json`));
    const orphans = Object.entries(overrides.pois || {})
      .filter(([name, patch]) => !resolveOverride(book, name, patch))
      .map(([name]) => name);
    // An override that matches nothing is a correction that silently did not
    // happen — usually the park renamed the ride and the alias was not moved.
    assert.deepEqual(orphans, [], `${id}: overrides with no POI to land on: ${orphans.join(', ')}`);
  });
  return true;
});

await check('a key written into an overrides file addresses one place, not every twin', () => {
  /* The reason keys are allowed in these files at all. `drop: ["Entrance"]` at
     a park with five gates called Entrance removes all five; a key removes the
     one that is wrong. Held here because the four venues on disk predate keys,
     so nothing on the shelf exercises it yet. */
  const pois = assignKeys(
    [
      { n: 'Entrance', lat: 41.4801, lng: -82.6811, c: 'gate' },
      { n: 'Entrance', lat: 41.4835, lng: -82.6902, c: 'gate' },
    ],
    null,
    { venue: 'v' },
  ).pois;
  const book = addressBook(pois);
  assert.equal(resolveOverride(book, 'Entrance').length, 2);
  assert.deepEqual(resolveOverride(book, 'entrance-2').map((p) => p.lat), [41.4835]);
  return true;
});

/* ----------------------------------------------------------- the recipe -- */

/* A venue is repeatable or it is not, and for a long time it was not: the
   bounding box, the pad, the tolerance and the merges lived in whatever
   somebody typed that afternoon, and the best record was a pull request body in
   prose. That is a correctness problem rather than a filing one — a tag rule
   that gains a park eighteen water rides is worth nothing until every park
   already on disk can be put through it. */

const { argsFromRecipe, recipeFrom, SHAPING_FLAGS } = await import('../scripts/lib/venue-recipe.mjs');

await check('a recipe records what shapes the venue and nothing about the run', () => {
  const recipe = recipeFrom({
    args: {
      bbox: '1,2,3,4',
      name: 'Somewhere',
      locality: 'Town, State',
      pad: 0,
      tolerance: 2,
      merge: ['data/pitches.csv'],
      'keep-offsite': true,
      // None of these change what comes out, so none of them belong in a file
      // that says what came out.
      'dry-run': true,
      dump: '/tmp/osm.json',
      endpoint: 'https://example.invalid/api',
      rebuild: 'somewhere',
    },
    id: 'somewhere',
    name: 'Somewhere',
    box: { south: 1, west: 2, north: 3, east: 4 },
  });

  assert.equal(recipe.id, 'somewhere');
  assert.deepEqual(recipe.box, { south: 1, west: 2, north: 3, east: 4 });
  assert.deepEqual(Object.keys(recipe.options).sort(), [
    'keep-offsite', 'locality', 'merge', 'name', 'pad', 'tolerance',
  ]);
  for (const flag of ['dry-run', 'dump', 'endpoint', 'rebuild', 'bbox']) {
    assert.ok(!(flag in recipe.options), `${flag} has no business in a recipe`);
  }
  // The id is the venue's identity and lives at the top level. Carried in both
  // places is how the two get to disagree.
  assert.ok(!('id' in recipe.options));
  return true;
});

await check('a recipe replays as the flags that made it', () => {
  const args = {
    name: "Big Kahuna's",
    locality: 'Destin, Florida',
    kind: 'theme-park',
    pad: 120,
    tolerance: 1.2,
  };
  const box = { south: 30.3872902, west: -86.4741956, north: 30.391115, east: -86.4706131 };
  const back = argsFromRecipe(recipeFrom({ args, id: 'big-kahunas', name: args.name, box }));

  // Round-tripped as flags rather than as an argv, because a park called "Big
  // Kahuna's" is exactly the sort of name that does not survive a shell.
  assert.equal(back.id, 'big-kahunas');
  assert.equal(back.name, "Big Kahuna's");
  assert.equal(back.pad, 120);
  // Six decimal places is a tenth of a metre, which is finer than anything here
  // is surveyed to. Held as numbers, so a trailing zero is simply not there.
  assert.equal(back.bbox, '30.38729,-86.474196,30.391115,-86.470613');
  return true;
});

await check('a place-built venue replays its box, not the place name', () => {
  /* A geocoder is free to change its mind about where "Cedar Point" is — it is
     also a village of 264 people in Illinois — and a rebuild that was asked to
     reproduce a venue must not be the thing that moves it. The name is kept as
     provenance and as what --refresh-place asks again with. */
  const recipe = recipeFrom({
    args: { place: 'Cedar Point, Sandusky, Ohio', name: 'Cedar Point' },
    id: 'cedar-point',
    name: 'Cedar Point',
    box: { south: 41.47, west: -82.69, north: 41.49, east: -82.67 },
    place: { display: 'Cedar Point, Erie County, Ohio, United States' },
  });
  assert.equal(recipe.place.query, 'Cedar Point, Sandusky, Ohio');
  const back = argsFromRecipe(recipe);
  assert.ok(back.bbox, 'replays the box it resolved to');
  assert.ok(!back.place, 'and not the question it asked');
  return true;
});

await check('a recipe with nothing to build from says so', () => {
  assert.throws(() => argsFromRecipe({ id: 'nowhere', options: {} }), /neither a box nor a place/);
  return true;
});

await check('every venue on disk knows how it was built', () => {
  /* The point of the file. A venue that cannot be rebuilt is a venue that is
     stuck at whichever tag rules were in force the day somebody typed a command
     line, and the only way back is to reconstruct it out of a merged pull
     request. */
  const missing = readVenues()
    .filter((v) => !fs.existsSync(new URL(`../data/venues/${v.id}.recipe.json`, import.meta.url)));
  assert.deepEqual(
    missing.map((v) => v.id),
    [],
    'no recipe on disk — build it once more and it writes its own',
  );
  return true;
});

await check('a recipe on disk is one this builder still understands', () => {
  readVenues().forEach((v) => {
    const recipe = JSON.parse(
      fs.readFileSync(new URL(`../data/venues/${v.id}.recipe.json`, import.meta.url)),
    );
    assert.equal(recipe.id, v.id, `${v.id}: recipe is filed under the wrong id`);
    const back = argsFromRecipe(recipe);
    assert.ok(back.bbox || back.place, `${v.id}: nothing to build from`);
    // A flag in a recipe that the builder no longer records is a flag that will
    // be dropped the next time this venue is built, silently.
    const strays = Object.keys(recipe.options || {}).filter((k) => !SHAPING_FLAGS.includes(k));
    assert.deepEqual(strays, [], `${v.id}: options the builder does not write`);
  });
  return true;
});

/* ------------------------------------------- what a build cannot produce -- */

const { renderBrief, requests } = await import('../scripts/lib/venue-requests.mjs');

const rideVenue = (extra = {}) => ({
  venue: { id: 'somewhere', name: 'Somewhere', locality: 'Town, State', credits: 'From the park.' },
  map: { lands: [{ n: 'The Green' }] },
  pois: [
    { n: 'Gate', c: 'gate' },
    { n: 'Loos', c: 'restroom' },
    { n: 'Chips', c: 'food' },
    { n: 'The Big One', c: 'coaster', h: { min: 48 } },
  ],
  ...extra,
});

await check('a finished venue is asked for nothing', () => {
  assert.deepEqual(requests(rideVenue()), []);
  return true;
});

await check('a venue with rides and no rules is asked first and blocks', () => {
  const reqs = requests(rideVenue({
    pois: [
      { n: 'Gate', c: 'gate' },
      { n: 'Loos', c: 'restroom' },
      { n: 'Chips', c: 'food' },
      { n: 'The Big One', c: 'coaster' },
    ],
  }));
  assert.equal(reqs[0].key, 'heights');
  // Not a nicety: with no rules at all the app drops the Rides tab, the slider,
  // the tally, the badge over the map and the struck-through markers, silently.
  assert.equal(reqs[0].blocking, true);
  assert.deepEqual(reqs[0].targets, ['The Big One']);
  return true;
});

await check('one ride under two names is asked about once', () => {
  /* OpenStreetMap routinely carries a ride as a way and a node both, which is
     why Fiesta Texas ships two Poltergeists. Both take the rule when one answer
     arrives, so both on the list is the same question asked twice. */
  const reqs = requests(rideVenue({
    pois: [
      { n: 'Gate', c: 'gate' },
      { n: 'Loos', c: 'restroom' },
      { n: 'Chips', c: 'food' },
      { n: 'Poltergeist', c: 'coaster' },
      { n: 'Poltergeist', c: 'ride' },
    ],
  }));
  assert.deepEqual(reqs[0].targets, ['Poltergeist']);
  return true;
});

await check('an override that lands on nothing becomes a question', () => {
  const reqs = requests(rideVenue({
    overrides: {
      pois: {
        'The Big One': { h: { min: 48 } },
        'Renamed Last Season': { h: { min: 54 } },
        'Known By Another Name': { alias: 'The Big One', h: { min: 48 } },
      },
    },
  }));
  const unmatched = reqs.find((r) => r.key === 'unmatched');
  // The alias is what bridges a park that renamed a ride and a map that has not
  // caught up, so an entry carrying one has landed.
  assert.deepEqual(unmatched.targets, ['Renamed Last Season']);
  return true;
});

await check('a town centre is never asked for its ride heights', () => {
  const reqs = requests({
    venue: { id: 'town', name: 'Town', locality: 'Town, State' },
    map: {},
    pois: [{ n: 'Gate', c: 'gate' }, { n: 'Loos', c: 'restroom' }, { n: 'Chips', c: 'food' }],
  });
  assert.deepEqual(reqs.map((r) => r.key), []);
  return true;
});

await check('the brief carries the conventions somebody would otherwise get wrong', () => {
  const reqs = requests(rideVenue({
    pois: [
      { n: 'Gate', c: 'gate' },
      { n: 'Loos', c: 'restroom' },
      { n: 'Chips', c: 'food' },
      { n: 'Lazy River', c: 'ride' },
    ],
  }));
  const brief = renderBrief({ id: 'somewhere', name: 'Somewhere' }, reqs);
  // Every one of these has already been got wrong here once, which is why they
  // are in the brief rather than in somebody's head.
  assert.match(brief, /_unmapped/, 'where a rule with nothing to land on goes');
  assert.match(brief, /`min: 0`/, 'no floor is not the same as nobody looked');
  assert.match(brief, /alias/, 'how a renamed ride is bridged');
  assert.match(brief, /Never estimate a coordinate/);
  assert.match(brief, /data\/venues\/somewhere\.overrides\.json/, 'the one file it all lands in');
  // The name it must be keyed by, exactly as the bundle spells it.
  assert.match(brief, /"Lazy River"/);
  return true;
});

await check('a brief with nothing to ask is empty rather than encouraging', () => {
  const brief = renderBrief({ id: 'somewhere', name: 'Somewhere' }, []);
  assert.match(brief, /Nothing here needs a source outside OpenStreetMap/);
  return true;
});

/* -------------------------------------------------------- georeferencing -- */

/* The park's own map knows things OpenStreetMap does not — which end of a
   coaster the queue is at, the path across the lawn, half the toilets — and
   getting them out means tying a picture to the ground. Big Kahuna's was
   georeferenced by hand once, came out at 33 m RMS in a park 400 m across, and
   every pin from it was thrown away. Correctly; and only because somebody
   happened to check. These are the checks. */

const { compare, crossValidate, fit, project, residuals } = await import('../scripts/lib/georef.mjs');

/* A synthetic park: pixels that are a known rotation, scale and shift away from
   a patch of ground, so the right answer is knowable rather than plausible. */
const KX = 6371000 * (Math.PI / 180) * Math.cos(39.34 * (Math.PI / 180));
const KY = 6371000 * (Math.PI / 180);
const groundOf = (px, py) => {
  const th = 0.15;
  const s = 0.42; // metres per pixel
  const X = s * (px * Math.cos(th) - py * Math.sin(th));
  const Y = s * (px * Math.sin(th) + py * Math.cos(th));
  return { lat: 39.34 + Y / KY, lng: -84.26 + X / KX };
};
const CONTROLS = [[100, 120], [900, 140], [880, 960], [140, 880], [500, 500], [300, 700]]
  .map(([x, y], i) => ({ n: `c${i + 1}`, px: [x, y], ...groundOf(x, y) }));

/* An illustrated map, as a grid of controls put through a warp: stretched where
   the artist needed room, which is what a drawing is and what no rotation,
   scale and shift on Earth straightens out. This is the Big Kahuna's failure,
   reproduced — and the fix. */
const warpedGrid = (n) => {
  const k = Math.ceil(Math.sqrt(n));
  const pts = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k && pts.length < n; j += 1) {
      pts.push([100 + (800 * i) / (k - 1), 100 + (800 * j) / (k - 1)]);
    }
  }
  return pts.map(([x, y], i) => ({
    n: `c${i + 1}`,
    px: [x + 90 * Math.sin(y / 300), y - 70 * Math.sin(x / 280)],
    ...groundOf(x, y),
  }));
};


await check('a square-on scan is read back to the metre', () => {
  for (const model of ['similarity', 'affine', 'projective', 'tps']) {
    const fitted = fit(CONTROLS, { model });
    const worst = Math.max(...residuals(fitted, CONTROLS).map((r) => r.metres));
    assert.ok(worst < 0.5, `${model} is ${worst.toFixed(2)} m out on a transform it can represent exactly`);
    // And a pixel none of the controls sat on.
    const want = groundOf(640, 300);
    const got = project(fitted, [640, 300]);
    const off = Math.hypot((got.lng - want.lng) * KX, (got.lat - want.lat) * KY);
    assert.ok(off < 1, `${model} put an unseen point ${off.toFixed(2)} m out`);
  }
  return true;
});

await check('accuracy is measured where the fit has never been', () => {
  /* The number that matters, and the reason there are two of them. A spline
     passes exactly through its own control points, so its residual against
     them is zero however wrong it is in between — quote that and you have
     proved that arithmetic works, nothing more. Leave-one-out estimates the
     error at a point nobody pinned, which is every point anybody will use.

     Shown on a warped drawing, because that is where the two numbers come
     apart. On a picture whose transform the model can represent exactly they
     agree, and agreeing is not the interesting case. */
  const warped = warpedGrid(9);
  const flattered = Math.max(...residuals(fit(warped, { model: 'tps' }), warped).map((r) => r.metres));
  // Not exactly zero only because a projected point is rounded to six decimal
  // places on the way out — a tenth of a metre, the precision a venue file is
  // written at.
  assert.ok(flattered < 0.2, `a spline flatters itself: ${flattered.toFixed(3)} m`);

  const cv = crossValidate(warped, { model: 'tps' });
  assert.equal(cv.possible, true);
  assert.equal(cv.residuals.length, warped.length);
  // Metres out where nobody pinned it, while claiming perfection where they did.
  assert.ok(cv.rms > 5, `cross-validation should not flatter: ${cv.rms.toFixed(2)} m`);
  assert.ok(cv.rms > flattered * 20, 'the two are not the same measurement');
  return true;
});

await check('too few controls to check is said, not guessed', () => {
  // Four points and a projective fit: it will pass through all four exactly and
  // there is nothing left over to test it with. The honest answer is to say so.
  const cv = crossValidate(CONTROLS.slice(0, 4), { model: 'projective' });
  assert.equal(cv.possible, false);
  assert.equal(cv.rms, null);
  assert.match(cv.why, /too few/);
  return true;
});

await check('a drawing that is not flat is fitted by the model that bends', () => {
  const ranked = compare(warpedGrid(12));
  assert.ok(ranked.length > 1, 'every model the controls can carry is scored');
  assert.equal(ranked[0].model, 'tps', `tps should win, got ${ranked.map((r) => r.model).join(' < ')}`);
  const rigid = ranked.find((r) => r.model === 'similarity');
  // Not a tie-break: the rigid fit is stuck in the tens of metres that got Big
  // Kahuna's thrown out, and the spline is the thing that gets under the gate.
  assert.ok(ranked[0].rms < rigid.rms / 2, 'and beat the rigid fit by a distance');
  return true;
});

await check('more control points is what actually buys accuracy', () => {
  /* The advice the tool gives when a fit is refused, held to. Eleven controls
     and a global fit is where Big Kahuna's got 33 m; the answer is not a
     cleverer model, it is more places pinned, spread out. */
  const few = compare(warpedGrid(6)).find((r) => r.model === 'tps');
  const many = compare(warpedGrid(20)).find((r) => r.model === 'tps');
  assert.ok(many.rms < few.rms / 2, `${few.rms.toFixed(1)} m to ${many.rms.toFixed(1)} m`);
  return true;
});

await check('controls in a line are refused rather than fitted', () => {
  // Collinear controls pin down no unique transform, and a wrong one looks
  // exactly like an answer.
  const inARow = [0, 1, 2, 3].map((i) => ({ n: `c${i}`, px: [100 * i, 500], ...groundOf(100 * i, 500) }));
  assert.throws(() => fit(inARow, { model: 'affine' }), /collinear|do not pin down/);
  return true;
});

await check('a control with nothing surveyed about it is refused', () => {
  assert.throws(
    () => fit([{ n: 'nowhere', px: [1, 2] }, ...CONTROLS], { model: 'affine' }),
    /no surveyed lat\/lng/,
  );
  return true;
});

/* ------------------------------------------- what a trace lands on -------- */

const { applyTrace } = await import('../scripts/lib/venue-trace.mjs');

const tracedFeature = (props, geometry) => ({ type: 'Feature', geometry, properties: props });
const pointAt = (lat, lng) => ({ type: 'Point', coordinates: [lng, lat] });

await check('an entrance lands on the ride it belongs to, and a route on the paths', () => {
  const pois = [{ n: 'Diamondback', c: 'coaster', lat: 39.3438, lng: -84.2658 }];
  const layers = { path: [] };
  const got = applyTrace(pois, layers, {
    features: [
      tracedFeature(
        { kind: 'entrance', of: 'Diamondback', src: { by: 'trace', image: 'the 2026 park map', error_m: 4 } },
        pointAt(39.3440, -84.2660),
      ),
      tracedFeature(
        { kind: 'exit', of: 'Diamondback', src: { by: 'trace', image: 'the 2026 park map', error_m: 4 } },
        pointAt(39.3441, -84.2661),
      ),
      tracedFeature({ kind: 'route', n: 'The cut-through' }, {
        type: 'LineString',
        coordinates: [[-84.2661, 39.3441], [-84.2665, 39.3444]],
      }),
    ],
  });

  assert.deepEqual(got.unmatched, []);
  assert.equal(pois[0].e[0].lat, 39.344);
  assert.equal(pois[0].out.lng, -84.2661);
  // The ride itself does not move — only where walking to it means.
  assert.equal(pois[0].lat, 39.3438);
  // Straight into `path`, which is what lib/routing.js welds into the walkable
  // graph, so a traced cut-through is routable with no other change anywhere.
  assert.equal(layers.path.length, 1);
  assert.equal(layers.path[0].n, 'The cut-through');
  // How far out the fit was travels with the pin. A place surveyed off a sign
  // and a place read off a drawing are different claims.
  assert.equal(pois[0].e[0].src.error_m, 4);
  // The tracer's word for its tool becomes the word the weight table scores,
  // and nothing else about its block is touched.
  assert.equal(pois[0].e[0].src.by, 'traced');
  assert.equal(pois[0].e[0].src.image, 'the 2026 park map');
  return true;
});

await check('an entrance to a ride that is not here is reported, not dropped', () => {
  const pois = [{ n: 'Diamondback', c: 'coaster', lat: 39.3438, lng: -84.2658 }];
  const got = applyTrace(pois, { path: [] }, {
    features: [tracedFeature({ kind: 'entrance', of: 'Banshee' }, pointAt(39.344, -84.266))],
  });
  // The same failure as an override that lands on nothing: a correction that
  // silently did not happen.
  assert.deepEqual(got.unmatched, ['Banshee (entrance)']);
  return true;
});

await check('an entrance traced half a park away from its ride is a mis-click', () => {
  const pois = [{ n: 'Diamondback', c: 'coaster', lat: 39.3438, lng: -84.2658 }];
  const got = applyTrace(pois, { path: [] }, {
    features: [tracedFeature({ kind: 'entrance', of: 'Diamondback' }, pointAt(39.36, -84.30))],
  });
  assert.equal(got.entrances, 0);
  assert.equal(got.skipped.length, 1);
  assert.ok(!pois[0].e, 'and the ride keeps no entrance it never had');
  return true;
});

await check('a traced place is added once and corrected on the next run', () => {
  const pois = [{ n: 'Diamondback', c: 'coaster', lat: 39.3438, lng: -84.2658 }];
  const trace = {
    features: [tracedFeature({ kind: 'place', n: 'Toilets by the lake', c: 'restroom' }, pointAt(39.3450, -84.2670))],
  };
  applyTrace(pois, { path: [] }, trace);
  assert.equal(pois.length, 2);
  // Re-running a trace must correct rather than duplicate, or a venue gains a
  // second set of toilets every time somebody re-fits the picture.
  applyTrace(pois, { path: [] }, trace);
  assert.equal(pois.length, 2);
  assert.equal(pois[1].c, 'restroom');
  return true;
});

/* ------------------------------------------------- evidence and confidence -- */

/* Every coordinate this pipeline produces about a ride's entrance is a claim
   from a source, and the sources are not equal. The failure mode is that "the
   park's own map says so" and "there is a footpath near it, so probably" end up
   as the same six decimal places in the same file and nobody can tell which was
   which afterwards. */

const { atLeast, bandOf, fuse, pointOf, staleness } = await import('../scripts/lib/evidence.mjs');

const near = { lat: 39.3438, lng: -84.2658 };
const alsoNear = { lat: 39.34381, lng: -84.26581 };
const farOff = { lat: 39.3450, lng: -84.2680 };

await check('agreement is worth more than repetition', () => {
  const agreeing = fuse([
    { source: 'osm_named_queue', at: near },
    { source: 'traced', at: alsoNear },
  ]);
  assert.equal(agreeing.score, 7);
  assert.equal(agreeing.band, 'moderate');

  // The same source cited twice is one source. Three forum threads repeating
  // each other are three people repeating each other.
  const repeated = fuse([{ source: 'forum', at: near }, { source: 'forum', at: alsoNear }]);
  assert.deepEqual(repeated.sources, ['forum']);
  assert.equal(repeated.score, 1);
  return true;
});

await check('a guess disagreeing with a survey is the guess being wrong', () => {
  /* The first rule here treated any spread as a standoff, and it was wrong in a
     way the parks on disk showed immediately: a coaster's nearest footpath is
     somewhere along its own track, so it lands a hundred metres from the queue
     every time. That let the weakest source in the pipeline veto the strongest,
     and Cedar Point's three best-evidenced coasters came out disputed. */
  const f = fuse([
    { source: 'osm_named_queue', at: near },
    { source: 'geometry', at: farOff },
  ]);
  assert.equal(f.conflict, false, 'being outranked is not a dispute');
  assert.deepEqual(f.sources, ['osm_named_queue'], 'and the outvoted source does not score');
  assert.equal(f.score, 4);
  assert.equal(f.dissent[0].source, 'geometry');
  assert.ok(f.dissent[0].metres > 100);
  return true;
});

await check('two sources of equal standing disagreeing is a conflict', () => {
  const f = fuse([
    { source: 'official_map', at: near },
    { source: 'official_site', at: farOff },
  ]);
  // The one a person has to settle. Never averaged into a point between them,
  // which is a coordinate neither source supports.
  assert.equal(f.conflict, true);
  assert.equal(f.score, 5, 'capped at what one of them is worth');
  return true;
});

await check('the heaviest source picks the spot outright', () => {
  const at = pointOf([
    { source: 'geometry', at: farOff },
    { source: 'official_map', at: near },
    { source: 'forum', at: farOff },
  ]);
  assert.equal(at.from, 'official_map');
  assert.equal(at.lat, near.lat);
  return true;
});

await check('the bands are the ones a single source cannot reach alone', () => {
  assert.equal(bandOf(0), 'unknown');
  assert.equal(bandOf(4), 'low');
  assert.equal(bandOf(7), 'moderate');
  assert.equal(bandOf(10), 'high');
  assert.equal(bandOf(13), 'very_high');
  // Deliberate: the best automatic evidence there is, on its own, is "low".
  // Corroboration is the whole point of scoring at all.
  assert.equal(bandOf(4), 'low');
  assert.ok(!atLeast('low', 'moderate'));
  assert.ok(atLeast('high', 'moderate'));
  return true;
});

await check('a claim has a shelf life, and it is flagged rather than decayed', () => {
  const old = staleness([{ source: 'official_map', date: '2024-01-01' }], '2026-08-09');
  assert.equal(old.stale, true);
  assert.match(old.why, /2024-01-01/);
  // Not scored down: an old survey is still a survey, and quietly decaying it
  // would invent a decay rate nobody measured.
  assert.equal(fuse([{ source: 'official_map', date: '2024-01-01', at: near }]).score, 5);
  assert.equal(staleness([], '2026-08-09').stale, true, 'undated is stale');
  return true;
});

/* --------------------------------------------------- the ride inventory -- */

const { addEvidence, attractionFor, claimFromSrc, publishable, SRC_BY, unresolved } =
  await import('../scripts/lib/attractions.mjs');
const { candidates, rideNameOf } = await import('../scripts/lib/candidates.mjs');

await check('a queue lane is named for its ride, not for itself', () => {
  assert.equal(rideNameOf('Top Thrill 2 Standby Queue'), 'top thrill 2');
  assert.equal(rideNameOf('Millennium Force Fastlane Queue'), 'millennium force');
  assert.equal(rideNameOf('Red Racer Queue'), 'red racer');
  return true;
});

await check('geometry proposes and does not publish', () => {
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  addEvidence(record, 'queue_entrance', { source: 'geometry', at: near }, { asOf: '2026-08-09' });
  // Not even "low": the cheapest evidence there is, and the only kind that
  // scales to every ride in every park, which is exactly why it is worth 1.
  assert.equal(record.features.queue_entrance.confidence, 'unknown');
  // If the path network alone were enough, every ride in every park would get an
  // entrance and not one of them would ever be checked.
  assert.deepEqual(publishable(record), {});

  addEvidence(record, 'queue_entrance', { source: 'osm_named_queue', at: near }, { asOf: '2026-08-09' });
  addEvidence(record, 'queue_entrance', { source: 'traced', at: alsoNear }, { asOf: '2026-08-09' });
  const out = publishable(record);
  // Into `e`, where the builder already puts entrances derived from named
  // one-way queues and where the app reads them. One concept, one field.
  assert.ok(out.e, 'corroborated evidence reaches the app');
  assert.equal(out.e.src.confidence, 'moderate');
  return true;
});

await check('a conflicted feature is never published', () => {
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  addEvidence(record, 'queue_entrance', { source: 'official_map', at: near });
  addEvidence(record, 'queue_entrance', { source: 'official_site', at: farOff });
  assert.deepEqual(publishable(record), {});
  assert.equal(unresolved([record]).length, 1);
  return true;
});

await check('evidence accumulates, and only its own source supersedes it', () => {
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  addEvidence(record, 'queue_entrance', { source: 'official_map', at: near, date: '2025-04-01' });
  addEvidence(record, 'queue_entrance', { source: 'forum', at: farOff });
  // A forum post does not overwrite the park; the park overwrites the park.
  assert.equal(record.features.queue_entrance.at.lat, near.lat);
  addEvidence(record, 'queue_entrance', { source: 'official_map', at: farOff, date: '2026-04-01' });
  assert.equal(record.features.queue_entrance.at.lat, farOff.lat, 'a redrawn map is a change of mind');
  assert.equal(record.features.queue_entrance.evidence.filter((e) => e.source === 'official_map').length, 1);
  return true;
});

await check('one ride with four mapped lanes yields one way in', () => {
  /* Cedar Point draws Maverick's standby lane, its Fastlane lane and two more
     segments as separate ways, all carrying the ride's name. They are not four
     entrances, and the evidence model dedupes by source rather than by place —
     so without reconciling here, whichever way came last in the file won. */
  const ride = { n: 'Maverick', c: 'coaster', lat: 41.4800, lng: -82.6860 };
  const q = (n, from, to) => ({ n, r: [from, to] });
  const map = {
    path: [
      { n: 'Midway', r: [[-82.6870, 41.4805], [-82.6850, 41.4805]] },
      q('Maverick Standby Queue', [-82.6862, 41.48048], [-82.6860, 41.4800]),
      q('Maverick Fastlane Queue', [-82.6861, 41.4802], [-82.6860, 41.4800]),
    ],
  };
  const got = candidates(map, [ride]).filter((c) => c.source === 'osm_queue_name' && c.type === 'queue_entrance');
  assert.equal(got.length, 1);
  assert.match(got[0].why, /outermost of 2 lanes/);
  return true;
});

/* ------------------------------------------------------ who says so ------- */

/* A coordinate already sitting on a place is evidence only if it says where it
   came from. Three writers hang points on `e` and `out` — the builder's
   `entrancesFromQueues`, the tracer's `applyTrace`, and this pipeline's own
   publish step — and for a long time the readers could not tell them apart: a
   traced entrance was invisible, anything else fell through to a default, and
   the app's own output came back round as the heaviest source in the table. */

const { fromTrace, fromTracedFile, inventory, publish } = await import('../scripts/attractions.mjs');
const { OVERRIDE_DIR, VENUE_DIR } = await import('../scripts/lib/venue-io.mjs');

const tracedSrc = { by: SRC_BY.TRACED, image: 'the 2026 park map', error_m: 4 };

await check('a traced entrance reaches the inventory', () => {
  /* The reader looked for `p.in`, which no writer in this repository has ever
     produced, so every traced entrance was invisible here while exits worked
     and nothing said otherwise. `e` is a list and `out` is one point, and both
     shapes have to be read. */
  const claims = fromTrace([{
    n: 'Orion',
    e: [{ ...near, n: 'Orion entrance', src: tracedSrc }],
    out: { ...farOff, src: tracedSrc },
  }]);
  assert.deepEqual(claims.map((c) => [c.ride, c.type, c.source]), [
    ['Orion', 'queue_entrance', 'traced'],
    ['Orion', 'ride_exit', 'traced'],
  ]);
  assert.equal(claims[0].at.lat, near.lat);
  assert.equal(claims[1].at.lng, farOff.lng);
  // What the point is worth, and how far out it was, both come off the point.
  assert.match(claims[0].why, /traced off the 2026 park map at ±4 m/);

  // A ride with two ways in traced says both, and the field nothing writes
  // says nothing.
  const two = fromTrace([{ n: 'Orion', e: [{ ...near, src: tracedSrc }, { ...farOff, src: tracedSrc }] }]);
  assert.equal(two.length, 2);
  assert.deepEqual(fromTrace([{ n: 'Orion', in: { ...near, src: tracedSrc } }]), []);
  return true;
});

await check('the pipeline does not cite itself', () => {
  /* The loop that let one fact reach the publish floor alone. `publish()`
     stamped `src.by` with the *feature* name, so a published exit carried
     `ride_exit`, both readers fell through to a default, and this app's own
     output came back in as `official_map` at 5 — annotated as though a park
     had printed it. `fuse()` dedupes by source precisely to stop one fact
     counting twice, and this went round it by the field instead. */
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  for (const feature of ['queue_entrance', 'ride_exit']) {
    addEvidence(record, feature, { source: 'osm_named_queue', at: near }, { asOf: '2026-08-09' });
    addEvidence(record, feature, { source: 'traced', at: alsoNear }, { asOf: '2026-08-09' });
  }
  const published = publishable(record);
  assert.equal(published.e.src.by, SRC_BY.FUSED, 'what this pipeline writes is stamped as its own');
  assert.equal(published.out.src.by, SRC_BY.FUSED);

  // Straight back in through the bundle, which is the way it went round: the
  // entrance on `e`, the exit on `out`.
  const place = { n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26, e: [published.e], out: published.out };
  assert.equal(claimFromSrc(published.e), null, 'a conclusion is not evidence for itself');
  assert.deepEqual(fromTrace([place]), [], 'nothing off the out path');
  assert.deepEqual(candidates({}, [place]), [], 'and nothing off the e path');
  // `fused` is deliberately absent from the weight table, so there is nothing
  // downstream to score it with either.
  assert.equal(fuse([{ source: SRC_BY.FUSED, at: near }]).score, 0);
  return true;
});

await check('an unsigned or unrecognised coordinate is worth nothing rather than a default', () => {
  /* There is no fallback and there must never be one. The one that was here
     read anything not stamped `trace` as `official_map` — a weight of 5 on a
     coordinate of unknown standing. */
  assert.equal(claimFromSrc({ ...near }), null, 'nobody signed it');
  assert.equal(claimFromSrc({ ...near, src: {} }), null);
  assert.equal(claimFromSrc({ ...near, src: { by: '' } }), null);
  assert.equal(claimFromSrc(null), null);
  // A word no scoring rule covers cannot be scored — `trace` included, which is
  // the tracer's word for its tool and not the one `WEIGHTS` uses for the kind
  // of source.
  assert.equal(claimFromSrc({ ...near, src: { by: 'trace' } }), null);
  assert.equal(claimFromSrc({ ...near, src: { by: 'official_map_2026' } }), null);

  const place = {
    n: 'Orion',
    c: 'coaster',
    lat: 39.34,
    lng: -84.26,
    e: [{ ...near }, { ...alsoNear, src: { by: 'trace' } }],
    out: { ...farOff, src: { by: 'official_map_2026' } },
  };
  assert.deepEqual(fromTrace([place]), []);
  assert.deepEqual(candidates({}, [place]), []);

  // A word it does know reads as that word, with a note taken off the entry
  // rather than asserted by the reader.
  const known = claimFromSrc({ ...near, n: 'Orion Gate', src: { by: 'osm_entrance' } });
  assert.equal(known.source, 'osm_entrance');
  assert.match(known.why, /"Orion Gate", already on the place, from osm_entrance/);
  return true;
});

await check('a traced pin does not stand the name-only detector down, and a named queue does', () => {
  /* Two readings of the same queue name are one fact and counting them twice is
     the repetition the evidence model refuses to reward. A traced pin is a
     different fact about the same ride, so it is heard beside the name. */
  const at = { n: 'Maverick', c: 'coaster', lat: 41.4800, lng: -82.6860 };
  const map = {
    path: [
      { n: 'Midway', r: [[-82.6870, 41.4805], [-82.6850, 41.4805]] },
      { n: 'Maverick Standby Queue', r: [[-82.6862, 41.48048], [-82.6860, 41.4800]] },
    ],
  };
  // The walkable network always has something to say and it is not what this
  // is about.
  const waysIn = (poi) => candidates(map, [poi])
    .filter((c) => c.type === 'queue_entrance' && c.source !== 'geometry')
    .map((c) => c.source)
    .sort();

  assert.deepEqual(waysIn({ ...at, e: [{ lat: 41.48047, lng: -82.68615, src: tracedSrc }] }),
    ['osm_queue_name', 'traced']);
  assert.deepEqual(waysIn({
    ...at,
    e: [{ lat: 41.48048, lng: -82.6862, n: 'Maverick Standby Queue', src: { by: SRC_BY.NAMED_QUEUE } }],
  }), ['osm_named_queue'], 'the mapper said which end you join, so the guess stands down');
  // And with nothing on the ride at all, the name-only reading is all there is.
  assert.deepEqual(waysIn(at), ['osm_queue_name']);
  return true;
});

await check('an unsigned traced feature is refused rather than signed', () => {
  /* The same shape as the bug on `e`, one file to the left, and the fix had
     not reached it: `applyTrace` stamped `by: 'traced'` onto whatever arrived,
     so a point carrying no block at all was minted into the bundle as a signed
     weight-3 coordinate with no image and no error — and `fromTrace` read it
     straight back out as evidence on the next run. The label came from which
     tool was invoked rather than from the data. A human invokes it, so the lie
     was smaller than the one already fixed; it is the same lie. */
  const ride = () => ({ n: 'Diamondback', c: 'coaster', lat: 39.3438, lng: -84.2658 });
  const traceOf = (props) => ({
    features: [tracedFeature({ kind: 'entrance', of: 'Diamondback', ...props }, pointAt(39.3440, -84.2660))],
  });

  const bare = [ride()];
  const got = applyTrace(bare, { path: [] }, traceOf({}));
  assert.equal(got.entrances, 0);
  assert.match(got.skipped[0], /no src block/);
  assert.equal(bare[0].e, undefined, 'and nothing is written onto the place');

  // A block that names no kind of source, and one naming a word no scoring
  // rule covers, are worth exactly what an absent block is worth.
  const anonymous = [ride()];
  applyTrace(anonymous, { path: [] }, traceOf({ src: { image: 'a screenshot', error_m: 9 } }));
  assert.equal(anonymous[0].e, undefined);
  const ours = [ride()];
  applyTrace(ours, { path: [] }, traceOf({ src: { by: SRC_BY.FUSED } }));
  assert.equal(ours[0].e, undefined, 'this pipeline cannot hand itself a trace either');

  // Signed by the tracer, which is what the tracer actually writes: kept whole,
  // with the tool's word translated to the kind of source `WEIGHTS` scores.
  const signed = [ride()];
  applyTrace(signed, { path: [] }, traceOf({ src: { by: 'trace', image: 'the 2026 park map', error_m: 4 } }));
  assert.equal(signed[0].e[0].src.by, SRC_BY.TRACED);
  assert.equal(signed[0].e[0].src.error_m, 4);

  // The tracer signs every feature and signs the collection once. Either is its
  // own statement about the fit; neither is this reader's guess.
  const stamped = [ride()];
  applyTrace(stamped, { path: [] }, {
    properties: { traced: { by: 'trace', image: 'the 2026 park map', error_m: 4 } },
    features: [tracedFeature({ kind: 'exit', of: 'Diamondback' }, pointAt(39.3441, -84.2661))],
  });
  assert.equal(stamped[0].out.src.by, SRC_BY.TRACED);
  return true;
});

await check('a traced file that says nothing about itself yields no claim', () => {
  /* The short way round a rebuild, and it hardcoded `source: 'traced'` at
     weight 3 for every point in whatever GeoJSON it was handed — annotated
     "traced off the park's own map" whether or not anything in the file said
     so. What a claim is worth comes off the file. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traced-'));
  const wrote = (name, gj) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, JSON.stringify(gj));
    return file;
  };
  const entrance = { type: 'Point', coordinates: [-84.2660, 39.3440] };
  const feature = { type: 'Feature', geometry: entrance, properties: { kind: 'entrance', of: 'Orion' } };
  try {
    assert.deepEqual(
      fromTracedFile(wrote('bare.geojson', { type: 'FeatureCollection', features: [feature] })),
      [],
    );
    const signed = fromTracedFile(wrote('signed.geojson', {
      type: 'FeatureCollection',
      properties: { traced: { by: 'trace', image: 'the 2026 park map', error_m: 4 } },
      features: [feature],
    }));
    assert.deepEqual(signed.map((c) => [c.ride, c.type, c.source]), [['Orion', 'queue_entrance', 'traced']]);
    // The image and the error come out of the file, not out of the flag.
    assert.match(signed[0].why, /traced off the 2026 park map at ±4 m/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return true;
});

/* A ride with a fused entrance, and the builder's own pin a few metres away —
   which is the normal case, since the fused point sits on its heaviest source
   rather than between them. */
const withFused = () => {
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  for (const feature of ['queue_entrance', 'ride_exit']) {
    addEvidence(record, feature, { source: 'osm_named_queue', at: near }, { asOf: '2026-08-09' });
    addEvidence(record, feature, { source: 'traced', at: alsoNear }, { asOf: '2026-08-09' });
  }
  const pin = { ...near, n: 'Orion Standby Queue', src: { by: SRC_BY.NAMED_QUEUE } };
  return { record, pin, place: { n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26, e: [pin] } };
};

await check('a fused point and the pin that produced it stand together', () => {
  /* Publishing kept a prior entry only if it was *both* not ours *and* more
     than 20 m away, and both had to hold — so the builder's own pin, normally
     a few metres from the point it argued for, was deleted by the conclusion
     it produced. The comment said such pins were kept beside the fused one.
     They are the input the next run re-derives from: a conclusion that eats
     its premises is not re-derivable, it is self-perpetuating. */
  const { record, pin, place } = withFused();
  publish('kings-island', [place], [record], 'moderate');

  assert.equal(place.e.length, 2);
  assert.equal(place.e[0].src.by, SRC_BY.FUSED, 'the conclusion first — it is what the app walks to');
  assert.deepEqual(place.e[1], pin, 'and the pin behind it, untouched');
  // Which is the point: the bundle can still say where its own entrance came
  // from, and the next run reads that back as the evidence it was.
  assert.deepEqual(fromTrace([place]).map((c) => c.source), ['osm_named_queue']);
  return true;
});

await check('a published exit is not called an entrance', () => {
  const { record } = withFused();
  const published = publishable(record);
  assert.equal(published.e.n, 'Orion entrance');
  assert.equal(published.out.n, 'Orion exit', 'the point you come out of is not the way in');
  // The feature is a field of its own, as it has to be: `by` is the kind of
  // source, and the two answer different questions.
  assert.equal(published.out.src.feature, 'ride_exit');
  assert.equal(published.out.src.by, SRC_BY.FUSED);
  return true;
});

await check('publishing twice leaves one conclusion, not two', () => {
  /* Derived, not accreted. `e` is a list, so a step that appended rather than
     replaced would give a ride a second entrance every time it ran, and the
     bundle would grow a pull request out of a run that learned nothing. */
  const { record, place } = withFused();
  publish('kings-island', [place], [record], 'moderate');
  const first = JSON.stringify(place);
  publish('kings-island', [place], [record], 'moderate');

  assert.equal(JSON.stringify(place), first, 'the same bytes, so a rebuild that learns nothing writes nothing');
  assert.equal(place.e.filter((x) => x.src?.by === SRC_BY.FUSED).length, 1);
  assert.equal(place.e.length, 2);
  return true;
});

await check('a rebuild on a later day rewrites no dates', () => {
  /* Every record used to read the day the script last ran, so `staleness()`
     could never fire and every rebuild rewrote all 230 records — no diff could
     answer "does OpenStreetMap still say what we shipped?". */
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  const slot = () => record.features.queue_entrance;
  const seen = () => slot().evidence.find((e) => e.source === 'osm_named_queue');

  addEvidence(record, 'queue_entrance', { source: 'osm_named_queue', at: near }, { asOf: '2026-03-01' });
  assert.equal(seen().date, '2026-03-01');

  // The same source, the same point, five months on. Re-deriving a point
  // nobody has moved is not a fresh sighting of anything.
  addEvidence(record, 'queue_entrance', { source: 'osm_named_queue', at: { ...near } }, { asOf: '2026-08-09' });
  assert.equal(seen().date, '2026-03-01');
  assert.equal(slot().newest_evidence, '2026-03-01');

  // Which is the whole of what makes staleness able to fire at all.
  addEvidence(record, 'queue_entrance', { source: 'osm_named_queue', at: near }, { asOf: '2027-04-01' });
  assert.equal(slot().stale, true);

  // Then the mapper moves it. Not a tolerance: a source that has moved its
  // point by any amount it bothered to write down has said something new.
  addEvidence(record, 'queue_entrance', { source: 'osm_named_queue', at: alsoNear }, { asOf: '2027-04-02' });
  assert.equal(seen().date, '2027-04-02');
  assert.equal(slot().stale, false);
  return true;
});

await check('an explicit date on a claim beats both the retained one and the run', () => {
  const record = attractionFor({ n: 'Orion', c: 'coaster', lat: 39.34, lng: -84.26 }, 'kings-island');
  const dateOf = (source) =>
    record.features.queue_entrance.evidence.find((e) => e.source === source)?.date;

  addEvidence(record, 'queue_entrance', { source: 'traced', at: near }, { asOf: '2026-08-09' });
  assert.equal(dateOf('traced'), '2026-08-09');
  // Somebody stating when they saw it, on a point this source has not moved.
  // The retained prior does not get to answer over them.
  addEvidence(record, 'queue_entrance', { source: 'traced', at: near, date: '2025-06-01' }, { asOf: '2026-08-09' });
  assert.equal(dateOf('traced'), '2025-06-01');
  // Nor does the day the run happens to be on, for a source nobody had heard
  // from before.
  addEvidence(record, 'queue_entrance', { source: 'guest_photo', at: near, date: '2024-07-04' }, { asOf: '2026-08-09' });
  assert.equal(dateOf('guest_photo'), '2024-07-04');
  assert.equal(record.features.queue_entrance.newest_evidence, '2025-06-01', 'the file dates observations, not runs');
  return true;
});

/* `inventory` joins its three files by venue id off disk, so a test of that
   join needs a venue on disk. Written under an id no park will ever have and
   taken away again whatever happens, so a failure here cannot leave one. */
const FIXTURE_ID = 'unit-test-venue';

function inventoryOf(pois, attractions) {
  const files = [
    path.join(VENUE_DIR, `${FIXTURE_ID}.map.json`),
    path.join(VENUE_DIR, `${FIXTURE_ID}.pois.json`),
    path.join(OVERRIDE_DIR, `${FIXTURE_ID}.attractions.json`),
  ];
  try {
    fs.writeFileSync(files[0], JSON.stringify({ meta: { id: FIXTURE_ID }, path: [] }));
    fs.writeFileSync(files[1], JSON.stringify(pois));
    fs.writeFileSync(files[2], JSON.stringify({ version: 1, venue: FIXTURE_ID, attractions }));
    return inventory(FIXTURE_ID);
  } finally {
    for (const file of files) fs.rmSync(file, { force: true });
  }
}

const withSurvey = (name) => {
  const record = attractionFor({ n: name, c: 'coaster', lat: 39.3441, lng: -84.2680 }, FIXTURE_ID);
  addEvidence(record, 'queue_entrance', { source: 'official_map', at: near, date: '2025-04-01' });
  return record;
};

await check('a ride the park has recapitalised keeps the evidence it has gathered', () => {
  /* The join used to be an exact, case-sensitive `Map.get`, the strictest in a
     pipeline whose every key is a display string that OpenStreetMap edits. A
     mapper shouting a ride's name would have orphaned every scrap of evidence
     against the old spelling and started the ride again from nothing, on the
     next run, without saying so. */
  const prior = withSurvey('The Beast');
  const state = inventoryOf([{ n: 'The BEAST', c: 'coaster', lat: 39.3441, lng: -84.2680 }], [prior]);
  assert.equal(state.records.length, 1);
  const [record] = state.records;
  assert.equal(record.id, prior.id, 'the same record, not a new one');
  assert.equal(record.name, 'The BEAST', 'reading the spelling the park uses now');
  assert.deepEqual(state.orphans, []);
  const survey = record.features.queue_entrance.evidence.find((e) => e.source === 'official_map');
  assert.equal(survey?.date, '2025-04-01', 'March evidence is still on the record in August');
  return true;
});

await check('a normalised name finds its record, unless it could be any of three', () => {
  /* Dropping a leading "The" and gaining a bracketed suffix is past what the
     lowercased exact index can see, and `normaliseRideName` — the reading the
     builder joins on when it attaches an entrance — sees it. */
  const found = inventoryOf(
    [{ n: 'Beast (Coaster)', c: 'coaster', lat: 39.3441, lng: -84.2680 }],
    [withSurvey('The Beast')],
  );
  assert.equal(found.records[0].features.queue_entrance.evidence.length, 1);

  /* Kings Island ships "The Racer", "Racer (Red)" and "Racer (Blue)" as three
     separate rides that all normalise to "racer". Keying on the normalised name
     alone would have merged three records into one and thrown two rides'
     evidence away, so a reading that identifies three things identifies
     nothing and the ride starts clean. */
  const racers = ['The Racer', 'Racer (Red)', 'Racer (Blue)'].map(withSurvey);
  const merged = inventoryOf([{ n: 'Racer', c: 'coaster', lat: 39.34, lng: -84.26 }], racers);
  assert.equal(merged.records.length, 1);
  assert.deepEqual(merged.records[0].features.queue_entrance.evidence, [],
    'a fresh record beats one of three guesses');
  return true;
});

/* ------------------------------------------------------ heights from OSM -- */

const { heightFromTags, poisFromTrack, entrancesFromQueues } = await import('../scripts/build-venue.mjs');

await check('a height sign on an OpenStreetMap object is read as a rule', () => {
  assert.deepEqual(heightFromTags({ minimum_height_requirement: '48in (122cm)' }), {
    min: 48, alone: null, max: null,
  });
  // A mapper's double space, and a centimetre figure that must not be read as
  // a second inch value.
  assert.deepEqual(heightFromTags({ minimum_height_requirement: '36in  (91cm)' }), {
    min: 36, alone: null, max: null,
  });
  // One tag written as a range is a floor and a ceiling, not two floors.
  assert.deepEqual(heightFromTags({ minimum_height_requirement: '36in-54in (91cm-137cm)' }), {
    min: 36, alone: null, max: 54,
  });
  assert.deepEqual(heightFromTags({ maximum_height_requirement: '52in (132cm)' }), {
    min: null, alone: null, max: 52,
  });
  return true;
});

await check('a tag that is not a height is not read as one', () => {
  assert.equal(heightFromTags({}), null);
  assert.equal(heightFromTags({ name: 'Blue Streak' }), null);
  // Metric-only, which this app has nowhere to put — and 122 would be a
  // nonsense height in inches, so it is refused rather than guessed at.
  assert.equal(heightFromTags({ minimum_height_requirement: '122cm' }), null);
  assert.equal(heightFromTags({ minimum_height_requirement: 'ask at the ride' }), null);
  return true;
});

/* ------------------------------------------------------- rides from track -- */

const TRACK = (n) => ({ n, r: [[-86.4, 30.3], [-86.41, 30.31], [-86.42, 30.32]] });

await check('a named flume with no place of its own becomes a ride', () => {
  // The whole of Big Kahuna's arrived this way: twenty-five water slides drawn
  // as lines, fourteen of them named, and not one of them on the list.
  const added = poisFromTrack([], [
    { track: [TRACK('The Beast')], category: 'coaster' },
    { track: [TRACK('Maui Pipeline')], category: 'ride' },
  ]);
  assert.deepEqual(added.map((p) => [p.n, p.c]), [
    ['The Beast', 'coaster'],
    ['Maui Pipeline', 'ride'],
  ]);
  // Positioned at the middle of its own geometry, not at a guess.
  assert.deepEqual([added[0].lat, added[0].lng], [30.31, -86.41]);
  return true;
});

await check('track never duplicates a place the venue already has', () => {
  // Both within one source and across them: a ride mapped as coaster track and
  // as a flume is one ride, filed as the first thing it matched.
  assert.deepEqual(poisFromTrack([{ n: 'maui pipeline', lat: 1, lng: 2, c: 'ride' }], [
    { track: [TRACK('Maui Pipeline')], category: 'ride' },
  ]), []);
  assert.deepEqual(
    poisFromTrack([], [
      { track: [TRACK('Hybrid')], category: 'coaster' },
      { track: [TRACK('Hybrid'), TRACK('Hybrid')], category: 'ride' },
    ]).map((p) => [p.n, p.c]),
    [['Hybrid', 'coaster']],
  );
  return true;
});

await check('an unnamed or empty piece of track supplies nothing', () => {
  assert.deepEqual(poisFromTrack([], [{ track: [{ r: TRACK('x').r }], category: 'ride' }]), []);
  assert.deepEqual(poisFromTrack([], [{ track: [{ n: 'Nowhere', r: [] }], category: 'ride' }]), []);
  return true;
});

/* ------------------------------------------------------- queue entrances -- */

/* A queue drawn as two one-way ways: the far one starts at the midway and runs
   into the near one, which ends at the ride. Only the first start is a source. */
const queueWay = (name, coords, oneway = 'yes') => ({
  type: 'way',
  tags: { name, highway: 'footway', ...(oneway ? { oneway } : {}) },
  geometry: coords.map(([lat, lon]) => ({ lat, lon })),
});

await check('a named one-way queue says where you join it', () => {
  const pois = [{ n: 'Millennium Force', c: 'coaster', lat: 41.4808, lng: -82.6855 }];
  const out = entrancesFromQueues(pois, [
    queueWay('Millennium Force Standby Queue', [[41.4819, -82.6865], [41.4815, -82.6861]]),
    queueWay('Millennium Force Standby Queue', [[41.4815, -82.6861], [41.4809, -82.6856]]),
  ]);
  assert.equal(out.rides, 1);
  // The vertex that is never any way's end — the back of the line, not the
  // join between the two halves and not the boarding platform.
  assert.deepEqual(pois[0].e, [
    {
      lat: 41.4819,
      lng: -82.6865,
      n: 'Millennium Force Standby Queue',
      // Signed with the kind of source it is. Three writers hang points on
      // `e`, and a reader that cannot tell them apart weighs a guess as a
      // survey — which is exactly what used to happen.
      src: { by: SRC_BY.NAMED_QUEUE },
    },
  ]);
  return true;
});

await check('a queue drawn backwards still points the right way', () => {
  const pois = [{ n: 'Gemini', c: 'coaster', lat: 41.4862, lng: -82.6893 }];
  entrancesFromQueues(pois, [
    queueWay('Gemini Standby Queue', [[41.4860, -82.6890], [41.4866, -82.6897]], '-1'),
  ]);
  assert.deepEqual(pois[0].e, [
    { lat: 41.4866, lng: -82.6897, n: 'Gemini Standby Queue', src: { by: SRC_BY.NAMED_QUEUE } },
  ]);
  return true;
});

await check('two queues to one ride are two ways in, unless they touch', () => {
  const far = [{ n: 'Rougarou', c: 'coaster', lat: 41.4820, lng: -82.6860 }];
  entrancesFromQueues(far, [
    queueWay('Rougarou Standby Queue', [[41.4824, -82.6868], [41.4821, -82.6861]]),
    queueWay('Rougarou Fastlane Queue', [[41.4824, -82.6865], [41.4821, -82.6861]]),
  ]);
  assert.equal(far[0].e.length, 2, 'entrances 24 m apart are two doors');

  const together = [{ n: 'Top Thrill 2', c: 'coaster', lat: 41.4830, lng: -82.6860 }];
  entrancesFromQueues(together, [
    queueWay('Top Thrill 2 Standby Queue', [[41.484023, -82.686051], [41.4835, -82.6861]]),
    queueWay('Top Thrill 2 Fastlane Queue', [[41.484038, -82.686062], [41.4835, -82.6861]]),
  ]);
  assert.equal(together[0].e.length, 1, 'starts 1.9 m apart are one door');
  assert.match(together[0].e[0].n, /Standby.*Fastlane|Fastlane.*Standby/);
  return true;
});

await check('a queue with nothing to go on is reported, not guessed at', () => {
  // No `oneway`: which end is the back of the line is not written down.
  const noDir = [{ n: 'Maverick', c: 'coaster', lat: 41.4785, lng: -82.6835 }];
  const a = entrancesFromQueues(noDir, [
    queueWay('Maverick Fastlane Queue', [[41.4789, -82.6840], [41.4786, -82.6836]], null),
  ]);
  assert.equal(noDir[0].e, undefined);
  assert.deepEqual(a.noDirection, ['Maverick']);

  // Names a ride this venue does not have.
  const b = entrancesFromQueues([{ n: 'The Racer', c: 'coaster', lat: 39.34, lng: -84.26 }], [
    queueWay('Banshee Queue', [[39.3405, -84.2605], [39.3401, -84.2601]]),
  ]);
  assert.deepEqual(b.unmatched, ['Banshee']);
  assert.equal(b.rides, 0);
  return true;
});

/* --------------------------------------------------------- camping detail -- */

const { campDetailsFromTags } = await import('../scripts/lib/osm-tags.mjs');
const { campChips, campDetails, campSearchText } = await import('../lib/camping.js');

await check('hookups are read off whatever the mapper wrote', () => {
  assert.deepEqual(
    campDetailsFromTags({ power_supply: 'yes', 'power_supply:amperage': '30;50', water_point: 'yes' }),
    { power: true, amps: [30, 50], water: true },
  );
  // Every way a person writes amperage, and nothing that is not a real service.
  assert.deepEqual(campDetailsFromTags({ amperage: '50 A' }).amps, [50]);
  assert.deepEqual(campDetailsFromTags({ amperage: '30amp/50amp' }).amps, [30, 50]);
  // 240 is a house supply, not an RV service, so it is not read as one — and a
  // tag set with nothing else in it comes back empty rather than half-filled.
  assert.equal(campDetailsFromTags({ amperage: '240' }), null);
  assert.equal(campDetailsFromTags({ drive_through: 'yes' }).drive, 'pull-through');
  assert.equal(campDetailsFromTags({ drive_through: 'no' }).drive, 'back-in');
  // Nothing recorded is not the same as recorded as absent.
  assert.equal(campDetailsFromTags({ name: 'Site 12' }), null);
  assert.equal(campDetailsFromTags({ power_supply: 'no' }).power, false);
  return true;
});

await check('a pitch says what it knows and inherits the rest', () => {
  const venue = { camping: { hookup: 'full', amps: [30, 50], water: true, surface: 'gravel' } };
  const pitch = { c: 'campsite', n: 'Site 5', camp: { surface: 'concrete', drive: 'pull-through' } };
  const merged = campDetails(pitch, venue);
  // The pitch overrules for what it knows, the venue answers for the rest.
  assert.equal(merged.surface, 'concrete');
  assert.equal(merged.hookup, 'full');
  assert.equal(merged.drive, 'pull-through');
  // A place that is not a campsite has no camping details, whatever the venue
  // publishes — the coaster is not full hookup.
  assert.equal(campDetails({ c: 'coaster', n: 'Blue Streak' }, venue), null);
  return true;
});

await check('what is unknown is left unsaid', () => {
  const chips = campChips({ hookup: 'full', amps: [30, 50] });
  assert.deepEqual(chips, ['Full hookup', '30/50 amp']);
  // Nothing recorded about water must not become "no water".
  assert.ok(!chips.some((c) => /water/i.test(c)));
  assert.deepEqual(campChips(null), []);
  assert.deepEqual(campChips({}), []);
  return true;
});

await check('a pitch is findable by what it offers, not just its number', () => {
  // The whole problem: every pitch is called "Site 247", so the only way to
  // search for one that fits a caravan is through its details.
  const text = campSearchText({ hookup: 'full', amps: [30, 50], drive: 'pull-through' });
  assert.ok(text.includes('50 amp'));
  assert.ok(text.includes('50amp'));
  assert.ok(text.includes('pull-through'));
  assert.ok(text.includes('full hookup'));
  assert.equal(campSearchText(null), '');
  return true;
});

await check('the venue-wide camping facts reach the manifest', () => {
  readVenues().forEach((v) => {
    const pois = readPois(v.pois);
    if (!pois.some((p) => p.c === 'campsite')) return;
    // A campground with no facts at all is a campground the app can say
    // nothing useful about, which is the state this all started in.
    const anything = v.camping || pois.some((p) => p.camp);
    assert.ok(anything, `${v.id}: a campground and not one hookup fact`);
  });
  return true;
});

/* ------------------------------------------------------ georeferenced merge -- */

const { applyCamping, mergeDataset, readDataset } = await import('../scripts/build-venue.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'venue-merge-'));

await check('a spreadsheet of pitch details merges by name', () => {
  const file = path.join(tmp, 'pitches.csv');
  fs.writeFileSync(
    file,
    'name,camp.drive,camp.length,note\nSite 1,pull-through,45,"Lakefront, quiet"\nSite 2,back-in,32,\n',
  );
  const feats = readDataset(file);
  assert.equal(feats.length, 2);
  // A dotted column nests, which is what makes a hookup spreadsheet a one-line
  // import rather than a script.
  assert.deepEqual(feats[0].properties.camp, { drive: 'pull-through', length: 45 });
  // And a quoted cell with a comma in it survives being read.
  assert.equal(feats[0].properties.note, 'Lakefront, quiet');

  const pois = [
    { id: 'site-1', n: 'Site 1', lat: 1, lng: 1, c: 'campsite' },
    { id: 'site-2', n: 'Site 2', lat: 1.001, lng: 1, c: 'campsite' },
  ];
  const { merged, unmatched } = mergeDataset(pois, feats);
  assert.equal(merged, 2);
  assert.deepEqual(unmatched, []);
  assert.equal(pois[0].camp.drive, 'pull-through');
  assert.equal(pois[1].camp.length, 32);
  // The key is not payload: merging must not rewrite the name it matched on.
  assert.equal(pois[0].n, 'Site 1');
  return true;
});

await check('a nameless survey point merges onto the place it is standing on', () => {
  const file = path.join(tmp, 'points.geojson');
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'FeatureCollection',
      features: [
        // Metres away from the first pitch, and nowhere near anything.
        { type: 'Feature', geometry: { type: 'Point', coordinates: [1.00002, 1.00002] }, properties: { camp: { sewer: true } } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [9, 9] }, properties: { camp: { sewer: true } } },
      ],
    }),
  );
  const pois = [{ id: 'site-1', n: 'Site 1', lat: 1, lng: 1, c: 'campsite' }];
  const { merged, unmatched } = mergeDataset(pois, readDataset(file), { metres: 25 });
  assert.equal(merged, 1);
  assert.equal(pois[0].camp.sewer, true);
  /* The one a mile away matched nothing and was reported rather than added: a
     point that lands nowhere near a place is far likelier to be the wrong
     projection than a new place, and silently inventing one would hide that. */
  assert.equal(unmatched.length, 1);
  return true;
});

await check('a camping rule narrows the venue-wide facts by name', () => {
  const pois = [
    { n: 'Site 501', c: 'campsite' },
    { n: 'Site 226', c: 'campsite' },
    { n: 'Millennium Force', c: 'coaster' },
  ];
  const touched = applyCamping(pois, { rules: [{ match: '^Site 5', set: { drive: 'pull-through' } }] });
  assert.equal(touched, 1);
  assert.equal(pois[0].camp.drive, 'pull-through');
  assert.equal(pois[1].camp, undefined);
  // A rule can never reach something that is not a pitch.
  assert.equal(pois[2].camp, undefined);
  return true;
});

/* --------------------------------------------------------- the campground -- */

await check('the campground is drawn, and its sites are places you can find', () => {
  const venues = readVenues();
  const camping = venues.filter((v) => readPois(v.pois).some((p) => p.c === 'campsite'));
  // Not every venue has one. The one that does has to have all of it.
  if (!camping.length) return true;
  camping.forEach((v) => {
    const pois = readPois(v.pois);
    const sites = pois.filter((p) => p.c === 'campsite');
    assert.ok(sites.length > 1, `${v.id}: a campground with no sites in it`);
    // The pitches are the point: a name you can type when you cannot remember
    // which row you are on.
    assert.ok(
      sites.some((p) => /\d/.test(p.n)),
      `${v.id}: not one numbered pitch — the sites did not come through`,
    );
    // And the ground itself is a district, or its name is nowhere on the map.
    const districts = new Set(pois.map((p) => p.a));
    assert.ok(
      sites.every((p) => districts.has(p.a)),
      `${v.id}: a campsite standing in no district`,
    );
  });
  return true;
});

await check('every place still lands in a district this venue draws', () => {
  readVenues().forEach((v) => {
    const map = JSON.parse(fs.readFileSync(new URL(`../public${v.map}`, import.meta.url)));
    const drawn = new Set((map.lands || []).map((l) => l.n));
    const pois = readPois(v.pois);
    /* A place whose district is neither the venue nor anything drawn is a place
       standing in the retail park over the road — the thing the offsite filter
       exists to drop. After the annexed-areas list this is the check that it
       still drops them. */
    const strays = [...new Set(pois.map((p) => p.a).filter((a) => a && a !== v.name && !drawn.has(a)))];
    assert.deepEqual(strays, [], `${v.id}: places filed under undrawn areas: ${strays.join(', ')}`);
  });
  return true;
});

await check('both of a duplicated ride carry the same height rule', () => {
  readVenues().forEach((v) => {
    const byName = new Map();
    readPois(v.pois).forEach((p) => {
      const at = byName.get(p.n);
      if (at) at.push(p);
      else byName.set(p.n, [p]);
    });
    byName.forEach((twins, name) => {
      if (twins.length < 2) return;
      const rules = new Set(twins.map((p) => JSON.stringify(p.h ?? null)));
      // OSM carries a ride as two nodes often enough that this is routine.
      // One of them answering "48 inches" and the other "check at the ride" is
      // the app disagreeing with itself about the same ride.
      assert.equal(rules.size, 1, `${v.id}/${name}: twins with different height rules`);
    });
  });
  return true;
});

await check('a party marker says its age in its own ink', () => {
  const now = 1_000_000;
  const fresh = partyMarkerState({ ts: now - 1000, heading: 90 }, now);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.facing, 90);

  // Past the threshold the heading is no longer worth drawing: it would point
  // confidently in whatever direction they were walking five minutes ago.
  const old = partyMarkerState({ ts: now - STALE_AFTER_MS - 1, heading: 90 }, now);
  assert.equal(old.stale, true);
  assert.equal(old.facing, null);

  // A member we have never had a fix for is stale, not NaN.
  const never = partyMarkerState({ status: 'NEED HELP' }, now);
  assert.equal(never.stale, true);
  assert.equal(never.help, true);
  assert.equal(never.facing, null);
  assert.equal(partyMarkerState(null, now).stale, true);

  // No heading is not a heading of zero.
  assert.equal(partyMarkerState({ ts: now, heading: null }, now).facing, null);
  assert.equal(partyMarkerState({ ts: now, heading: 0 }, now).facing, 0);
  return true;
});

section('map/declutter');

await check('the space goes to whoever asks first', () => {
  const grid = new Declutter();
  assert.equal(grid.claim(boxAround(50, 50, 20, 8)), true);
  assert.equal(grid.claim(boxAround(60, 52, 20, 8)), false, 'overlapping claim let through');
  assert.equal(grid.claim(boxAround(200, 50, 20, 8)), true, 'clear space refused');
  return true;
});

await check('a pinned claim takes the space anyway, and keeps it', () => {
  const grid = new Declutter();
  grid.claim(boxAround(50, 50, 20, 8));
  assert.equal(grid.claim(boxAround(52, 50, 20, 8), true), true);
  // ...and having taken it, it blocks the next comer.
  assert.equal(grid.claim(boxAround(52, 50, 20, 8)), false);
  return true;
});

await check('boxes that only touch are not overlapping', () => {
  const grid = new Declutter();
  grid.claim(boxAround(0, 0, 10, 10));
  assert.equal(grid.claim(boxAround(20, 0, 10, 10)), true, 'edge-to-edge should fit');
  return true;
});

await check('the grid agrees with brute force', () => {
  // The bucketing is an optimisation; it must not change the answer.
  const grid = new Declutter();
  const taken = [];
  let mismatch = 0;
  for (let i = 0; i < 400; i += 1) {
    const box = boxAround((i * 37) % 380, (i * 53) % 700, 12, 7);
    const bruteFree = !taken.some(
      (o) => box.x0 < o.x1 && o.x0 < box.x1 && box.y0 < o.y1 && o.y0 < box.y1,
    );
    const got = grid.claim(box);
    if (got !== bruteFree) mismatch += 1;
    if (bruteFree) taken.push(box);
  }
  assert.equal(mismatch, 0);
  return true;
});

section('map/labels');

await check('a land name lies along its land', () => {
  const wide = principalAxis([[0, 0], [100, 0], [100, 10], [0, 10]]);
  assert.ok(Math.abs(wide.uy) < 0.01, 'east-west land should read east-west');
  assert.equal(Math.round(wide.extent), 100);
  const tall = principalAxis([[0, 0], [10, 0], [10, 100], [0, 100]]);
  assert.ok(Math.abs(tall.ux) < 0.01, 'north-south land should read north-south');
  assert.equal(principalAxis([]), null);
  return true;
});

await check('a name never runs right to left', () => {
  // Walking south turns the map; the words must not turn with it.
  const arc = labelArc(100, 100, -1, 0, 80);
  const [, sx] = /^M([-\d.]+) /.exec(arc);
  const [, ex] = / ([-\d.]+) [-\d.]+$/.exec(arc);
  assert.ok(Number(ex) > Number(sx), 'baseline runs backwards');
  return true;
});

await check('a clamped anchor stays inside the rectangle it was given', () => {
  const rect = { x0: 10, x1: 100, y0: 20, y1: 60 };
  assert.deepEqual(clampInto(-40, 900, rect), [10, 60]);
  assert.deepEqual(clampInto(55, 40, rect), [55, 40]);
  assert.equal(intersect({ x0: 0, x1: 5, y0: 0, y1: 5 }, { x0: 6, x1: 9, y0: 0, y1: 5 }), null);
  assert.deepEqual(intersect({ x0: 0, x1: 10, y0: 0, y1: 10 }, { x0: 5, x1: 20, y0: 5, y1: 20 }), {
    x0: 5,
    x1: 10,
    y0: 5,
    y1: 10,
  });
  return true;
});

await check('label width grows with the label', () => {
  assert.ok(textWidth('Diamondback', 9.5) > textWidth('Orion', 9.5));
  assert.ok(textWidth('AREA 72', 15, 2.4) > textWidth('AREA 72', 15));
  return true;
});

section('map/scale');

await check('the scale bar states a distance it actually spans', () => {
  // The old bar set its width to 100·scale px against a CSS cap of 140px, so
  // from zoom 1.4 up it was clamped while still claiming to be 100 m.
  for (const z of [0.18, 0.3, 0.5, 0.95, 1.4, 2, 3, 4.5, 6]) {
    const bar = scaleBar(z);
    assert.ok(bar.px >= 40 && bar.px <= 140, `bar is ${Math.round(bar.px)}px at zoom ${z}`);
    // The stated length and the drawn length are the same measurement.
    assert.ok(Math.abs(bar.metres * z - bar.px) / bar.px < 0.02, `bar lies at zoom ${z}`);
  }
  return true;
});

await check('the scale bar rounds to numbers people use', () => {
  const allowed = new Set(['25 ft', '50 ft', '100 ft', '250 ft', '500 ft', '1000 ft', '2000 ft', '1 mi']);
  for (let z = 0.18; z <= 6; z += 0.07) {
    assert.ok(allowed.has(scaleBar(z).label), `odd label ${scaleBar(z).label}`);
  }
  return true;
});

await check('zooming in never makes the bar cover more ground', () => {
  let last = Infinity;
  for (let z = 0.18; z <= 6; z += 0.05) {
    const { metres } = scaleBar(z);
    assert.ok(metres <= last + 1e-9, `bar grew from ${last} m to ${metres} m on zooming in`);
    last = metres;
  }
  return true;
});

/* ------------------------------------------------------- venue picking --- */

section('venue selection');

const KI = {
  id: 'kings-island',
  name: 'Kings Island',
  center: { lat: 39.3434, lng: -84.267 },
  bounds: { north: 39.348, south: 39.3365, east: -84.2595, west: -84.2775 },
};
const SFFT = {
  id: 'six-flags-fiesta-texas',
  name: 'Six Flags Fiesta Texas',
  center: { lat: 29.5992, lng: -98.61455 },
  bounds: { north: 29.60898, south: 29.58942, east: -98.60346, west: -98.62564 },
};
const MANIFEST = { venues: [KI, SFFT] };

await check('a fix outside every venue still picks the nearest one', () => {
  // Austin: inside neither park. "Nearest or last" means a phone with no venue
  // of its own gets the nearest rather than whatever the manifest happens to
  // list first — which is how a visitor in San Antonio was shown a park in Ohio.
  const hit = venueForPosition(MANIFEST, 30.2672, -97.7431);
  assert.equal(hit.venue.id, 'six-flags-fiesta-texas');
  assert.equal(hit.inside, false);
  return true;
});

await check('a fix inside a venue picks that venue', () => {
  const hit = venueForPosition(MANIFEST, 39.34395, -84.2673);
  assert.equal(hit.venue.id, 'kings-island');
  assert.equal(hit.inside, true);
  return true;
});

await check('a fix inside the other venue picks the other venue', () => {
  const hit = venueForPosition(MANIFEST, 29.5992, -98.6145);
  assert.equal(hit.venue.id, 'six-flags-fiesta-texas');
  assert.equal(hit.inside, true);
  return true;
});

// Containment has to beat proximity, or standing at the far edge of one venue
// hands you the map of a nearer venue's centre.
await check('a fix in neither venue falls back to the nearest centre', () => {
  const hit = venueForPosition(MANIFEST, 39.1, -84.5);
  assert.equal(hit.venue.id, 'kings-island');
  assert.equal(hit.inside, false);
  return true;
});

await check('withinBounds refuses a missing box or a missing fix', () => {
  assert.equal(withinBounds(null, 39.34, -84.26), false);
  assert.equal(withinBounds(KI.bounds, NaN, -84.26), false);
  return true;
});

/* --------------------------------------------------------- intake question - */

// The question the app asks on the way in, and the two facts it needs to know
// before asking: which park is nearest, and whether it has asked already.

await check('the intake asks about the park an unplaced visitor is nearest', () => {
  // Austin: a couple of hours from Fiesta Texas, a continent from Kings Island.
  const ask = venueChoiceFor(MANIFEST, 30.2672, -97.7431, {});
  assert.equal(ask.venue.id, 'six-flags-fiesta-texas');
  assert.equal(ask.inside, false);
  return true;
});

await check('the intake does not ask twice about the same park', () => {
  const confirmed = 'six-flags-fiesta-texas';
  assert.equal(venueChoiceFor(MANIFEST, 30.2672, -97.7431, { confirmed }), null);
  // Nor when the visitor has drifted nearer another one without going in: they
  // said where they were going, and a motorway is not a park.
  assert.equal(venueChoiceFor(MANIFEST, 39.1, -84.5, { confirmed }), null);
  return true;
});

await check('turning up inside a different park is worth asking about', () => {
  const ask = venueChoiceFor(MANIFEST, 39.34395, -84.2673, {
    confirmed: 'six-flags-fiesta-texas',
  });
  assert.equal(ask.venue.id, 'kings-island');
  assert.equal(ask.inside, true);
  return true;
});

await check('a map picked by hand is never questioned', () => {
  assert.equal(venueChoiceFor(MANIFEST, 30.2672, -97.7431, { pinned: true }), null);
  assert.equal(venueChoiceFor(MANIFEST, 39.34395, -84.2673, { pinned: true }), null);
  return true;
});

await check('the other parks come back nearest first, with real distances', () => {
  const rows = venuesByDistance(MANIFEST, 30.2672, -97.7431);
  assert.deepEqual(
    rows.map((r) => r.venue.id),
    ['six-flags-fiesta-texas', 'kings-island'],
  );
  // Austin to San Antonio is about 120 km; to Mason, Ohio, about 1,600 km.
  // Rough equirectangular metres are wrong by hundreds of km at that spread,
  // which is the reason this list is measured with haversine.
  assert.ok(Math.abs(rows[0].metres - 118_000) < 12_000, `${rows[0].metres} m to Fiesta Texas`);
  assert.ok(Math.abs(rows[1].metres - 1_600_000) < 120_000, `${rows[1].metres} m to Kings Island`);
  return true;
});

await check('standing in a park puts it first however far its centre is', () => {
  // The north-east corner of Kings Island: inside it, but further from its
  // centre than a fix parked outside the fence would be.
  const rows = venuesByDistance(MANIFEST, 39.3478, -84.2597);
  assert.equal(rows[0].venue.id, 'kings-island');
  assert.equal(rows[0].inside, true);
  return true;
});

await check('with no fix the parks still list, undistanced', () => {
  const rows = venuesByDistance(MANIFEST, null, null);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].metres, null);
  assert.equal(rows[0].inside, false);
  return true;
});

await check('a district is tinted by its own venue, or by its own name', () => {
  /* The curated tints belong to the venue now, not to the renderer. Two parks
     can and do use the same district name — Cedar Point's water park was Soak
     City until 2017 and Kings Island's still is — so a table in shared code
     would paint one park in the other's colours. */
  const ki = { lands: { day: { 'Coney Mall': { fill: '#F1EAE4', stroke: '#E0D5CC', label: '#7E5C44' } } } };
  assert.equal(landTint('Coney Mall', 'day', ki).fill, '#F1EAE4');
  // The same name at a venue that has not named it is generated, not borrowed.
  assert.notEqual(landTint('Coney Mall', 'day', null).fill, '#F1EAE4');

  const made = landTint('Los Festivales', 'day');
  assert.equal(made.fill, landTint('Los Festivales', 'day').fill); // stable
  assert.notEqual(made.fill, landTint('Rockville', 'day').fill); // distinct
  assert.notEqual(made.fill, landTint('Los Festivales', 'night').fill); // themed
  return true;
});

await check('every named district is one this venue actually has', () => {
  readVenues().forEach((v) => {
    if (!v.lands) return;
    const map = JSON.parse(fs.readFileSync(new URL(`../public${v.map}`, import.meta.url)));
    const drawn = new Set((map.lands || []).map((l) => l.n));
    for (const theme of ['night', 'day']) {
      const strays = Object.keys(v.lands[theme] || {}).filter((n) => !drawn.has(n));
      // A tint for a district that is not on the map is a colour nobody will
      // ever see, and usually the sign of a park that renamed an area.
      assert.deepEqual(strays, [], `${v.id}/${theme}: tints for absent districts: ${strays.join(', ')}`);
    }
  });
  return true;
});

/* --------------------------------------------------- venue build geometry - */

section('venue geometry');

const SQUARE = [
  [-84.267, 39.343],
  [-84.267, 39.344],
  [-84.266, 39.344],
  [-84.266, 39.343],
  [-84.267, 39.343],
];

// The bug this exists for: Douglas-Peucker measures every vertex against the
// line from the first point to the last, and on a closed ring those are the
// same point — so the whole polygon collapsed to a dot and every filled layer
// came out empty while the open polylines looked fine.
/* Clipping a fill to the venue's box. The case that forced it: Cedar Point is a
   peninsula, so Overpass handed back the whole of Lake Erie — one ring reaching
   into Canada, every vertex of it outside the park, two thirds of the file. */

const BOX = { north: 41.49, south: 41.47, east: -82.67, west: -82.7 };

await check('a shape wholly inside the box comes back untouched', () => {
  const ring = [
    [-82.69, 41.48],
    [-82.68, 41.48],
    [-82.68, 41.485],
    [-82.69, 41.485],
    [-82.69, 41.48],
  ];
  assert.deepEqual(clipToBounds(ring, BOX), ring);
  return true;
});

await check('a lake swallowing the venue is cut down to the venue', () => {
  // Every vertex is outside — and the box is deep inside the polygon, which is
  // why dropping outside points cannot work: it would delete the water the
  // venue is standing in.
  const lake = [
    [-83.5, 41.3],
    [-78.8, 41.3],
    [-78.8, 42.9],
    [-83.5, 42.9],
    [-83.5, 41.3],
  ];
  const out = clipToBounds(lake, BOX);
  assert.equal(out.length, 5, `expected the box back, got ${out.length} points`);
  for (const [lng, lat] of out) {
    assert.ok(lng >= BOX.west - 1e-9 && lng <= BOX.east + 1e-9, `lng ${lng} escaped`);
    assert.ok(lat >= BOX.south - 1e-9 && lat <= BOX.north + 1e-9, `lat ${lat} escaped`);
  }
  // Still a filled ring covering the whole box, not a sliver. Compared as a
  // corner set rather than by area: areaOf anchors its longitude scale to the
  // first vertex's latitude, so the same rectangle measures a thousandth
  // different depending on which corner it is written from.
  const corners = (r) =>
    r
      .slice(0, -1)
      .map(([lng, lat]) => `${lng},${lat}`)
      .sort();
  assert.deepEqual(corners(out), [
    `${BOX.east},${BOX.north}`,
    `${BOX.east},${BOX.south}`,
    `${BOX.west},${BOX.north}`,
    `${BOX.west},${BOX.south}`,
  ].sort());
  return true;
});

await check('a shape straddling one edge keeps the half that is here', () => {
  const ring = [
    [-82.69, 41.48],
    [-82.6, 41.48], // well east of the box
    [-82.6, 41.485],
    [-82.69, 41.485],
    [-82.69, 41.48],
  ];
  const out = clipToBounds(ring, BOX);
  assert.ok(out.every(([lng]) => lng <= BOX.east + 1e-9), 'kept points outside the box');
  // Cut at the boundary, not shrunk back to the last vertex inside it.
  assert.ok(out.some(([lng]) => Math.abs(lng - BOX.east) < 1e-9), 'no cut along the east edge');
  assert.deepEqual(out[0], out[out.length - 1], 'clipped ring left open');
  return true;
});

await check('a shape entirely elsewhere clips to nothing', () => {
  const elsewhere = [
    [-84.27, 39.34],
    [-84.26, 39.34],
    [-84.26, 39.35],
    [-84.27, 39.34],
  ];
  assert.deepEqual(clipToBounds(elsewhere, BOX), []);
  return true;
});

await check('simplifying a closed ring keeps a polygon', () => {
  const dense = [];
  for (let i = 0; i <= 40; i += 1) {
    const t = (i / 40) * Math.PI * 2;
    dense.push([-84.267 + 0.0004 * Math.cos(t), 39.3435 + 0.0004 * Math.sin(t)]);
  }
  dense.push(dense[0]);
  const out = simplify(dense, 1.2);
  assert.ok(out.length >= 4, `ring collapsed to ${out.length} points`);
  assert.ok(out.length < dense.length);
  assert.deepEqual(out[0], out[out.length - 1]);
  return true;
});

await check('simplifying an open line drops only redundant points', () => {
  const straight = [
    [-84.268, 39.343],
    [-84.267, 39.343],
    [-84.266, 39.343],
  ];
  assert.deepEqual(simplify(straight, 1.2), [straight[0], straight[2]]);
  return true;
});

await check('area, centroid and containment agree on a square', () => {
  const area = areaOf(SQUARE);
  assert.ok(area > 8000 && area < 12000, `${area} m2`);
  const [lng, lat] = centroidOf(SQUARE);
  assert.ok(Math.abs(lat - 39.3435) < 1e-6 && Math.abs(lng + 84.2665) < 1e-6);
  assert.equal(pointInRing([-84.2665, 39.3435], SQUARE), true);
  assert.equal(pointInRing([-84.2, 39.3435], SQUARE), false);
  return true;
});

await check('rounding collapses duplicate points at metre precision', () => {
  const out = round([
    [-84.2670001, 39.3430001],
    [-84.2670002, 39.3430002],
    [-84.266, 39.343],
  ]);
  assert.deepEqual(out, [
    [-84.267, 39.343],
    [-84.266, 39.343],
  ]);
  return true;
});

/* ------------------------------------------------------- venue tag rules - */

section('venue tag rules');

/* The boundary. Kings Island shipped drawing the census area of Landen as its
   own ground: TIGER mapped it as a named `place=locality`, which walked through
   the district rule, and being five times the size of the park it then won the
   biggest-ring-wins test for the venue outline. One place out of 219 was inside
   the shape the app believed was the park. */

const LANDEN = { boundary: 'census', place: 'locality', name: 'Landen' };
const MASON = { boundary: 'administrative', admin_level: '8', place: 'city', name: 'Mason' };
const KI_PARK = { tourism: 'theme_park', name: 'Kings Island' };
const CONEY = { place: 'locality', name: 'Coney Mall' };

await check('a census tract or a city is never part of a venue', () => {
  assert.equal(isCivicBoundary(LANDEN), true);
  assert.equal(isCivicBoundary(MASON), true);
  assert.equal(isLand(LANDEN), false, 'a census tract came back as a district');
  assert.equal(isLand(MASON), false);
  assert.equal(isVenueOutline(LANDEN), false, 'a census tract could be taken for the park');
  return true;
});

await check('a themed area inside the park is still a district', () => {
  // The rule that admits Coney Mall is the same one that admitted Landen, so
  // the fix has to leave this standing.
  assert.equal(isCivicBoundary(CONEY), false);
  assert.equal(isLand(CONEY), true);
  return true;
});

await check('the park itself can be the outline, a district cannot', () => {
  assert.equal(isVenueOutline(KI_PARK), true);
  assert.equal(isVenueOutline(CONEY), false, 'a locality is a district, not the venue');
  assert.equal(isVenueOutline({ leisure: 'park', name: 'Somewhere' }), true);
  assert.equal(isVenueOutline({ amenity: 'university', name: 'A Campus' }), true);
  assert.equal(isVenueOutline({ building: 'yes', name: 'A Shed' }), false);
  return true;
});

await check('coaster track is track and its station is a building', () => {
  assert.equal(classify(LAYER_RULES, { roller_coaster: 'track', name: 'Banshee' }), 'coaster');
  assert.equal(
    classify(LAYER_RULES, { attraction: 'roller_coaster', roller_coaster: 'station', building: 'yes' }),
    'building',
  );
  return true;
});

await check('a mini golf course is a place to meet and a green to draw', () => {
  // Half of Big Kahuna's Adventure Park is three 18-hole courses. Without this
  // they were neither on the list nor on the map — a couple of acres of bare
  // ground where the golf is.
  assert.equal(classify(POI_RULES, { leisure: 'miniature_golf', name: 'Tropical Mini Golf' }), 'ride');
  assert.equal(classify(LAYER_RULES, { leisure: 'miniature_golf' }), 'grass');
  return true;
});

await check('walkable ground with no highway tag is still a walking route', () => {
  /* The path layer is not only drawn — routing.js welds it into the route
     graph, so a walkable way missing from it is a route the app will not send
     anyone down. Cedar Point had 830 m of boardwalk in that state. */
  assert.equal(classify(LAYER_RULES, { man_made: 'pier' }), 'path');
  assert.equal(classify(LAYER_RULES, { man_made: 'pier', area: 'yes', name: 'Boggy Bridge' }), 'path');
  assert.equal(classify(LAYER_RULES, { railway: 'platform', area: 'yes' }), 'path');
  assert.equal(classify(LAYER_RULES, { public_transport: 'platform' }), 'path');
  assert.equal(classify(LAYER_RULES, { highway: 'crossing' }), 'path');
  assert.equal(classify(LAYER_RULES, { highway: 'bridleway' }), 'path');
  return true;
});

await check('steps stay in the walkable network and are marked rather than dropped', () => {
  /* Both halves matter and they pull against each other. Dropping steps from
     the `path` layer would take 112 flights out of four parks' networks — a
     route the app will not offer is worse than a route it offers badly — so
     they stay, and carry a flag instead. */
  assert.equal(classify(LAYER_RULES, { highway: 'steps' }), 'path');
  assert.equal(wayAttributes({ highway: 'steps' }).f, WAY_FLAGS.STEPS);
  return true;
});

await check('the attributes read off a way are the ones worth their bytes', () => {
  // Present at all four venues and worth carrying.
  assert.equal(wayAttributes({ highway: 'footway', bridge: 'viaduct', layer: '1' }).f, WAY_FLAGS.BRIDGE);
  assert.equal(wayAttributes({ highway: 'footway', bridge: 'yes', layer: '1' }).l, 1);
  assert.equal(wayAttributes({ highway: 'footway', tunnel: 'building_passage' }).f, WAY_FLAGS.TUNNEL);
  assert.equal(wayAttributes({ highway: 'service', oneway: 'yes' }).f, WAY_FLAGS.ONEWAY);
  assert.equal(wayAttributes({ highway: 'service', oneway: '-1' }).f, WAY_FLAGS.ONEWAY_BACK);
  assert.equal(wayAttributes({ highway: 'service', access: 'private' }).f, WAY_FLAGS.RESTRICTED);
  assert.equal(wayAttributes({ highway: 'service', access: 'no' }).f, WAY_FLAGS.RESTRICTED);

  // A denial is not an assertion, and neither is silence.
  assert.equal(wayAttributes({ highway: 'footway' }), null);
  assert.equal(wayAttributes({ highway: 'footway', bridge: 'no', tunnel: 'no', layer: '0' }), null);
  assert.equal(wayAttributes({ highway: 'service', oneway: 'no' }), null);
  /* `access=customers` is 173 ways at Cedar Point and means "people with a
     ticket", which is nearly every path inside the gate. It is not the same
     claim as `private`, and folding it in would make a fifth of the park read
     as back of house. */
  assert.equal(wayAttributes({ highway: 'footway', access: 'customers' }), null);

  // Measured at zero or near it across all four venues, so deliberately unread.
  assert.equal(wayAttributes({ highway: 'footway', incline: '10%' }), null);
  assert.equal(wayAttributes({ highway: 'footway', surface: 'asphalt' }), null);
  assert.equal(wayAttributes({ highway: 'footway', width: "10'" }), null);
  assert.equal(wayAttributes({ highway: 'footway', covered: 'yes' }), null);
  assert.equal(wayAttributes({ highway: 'footway', wheelchair: 'yes' }), null);

  // A `layer` outside the nibble it is worth storing in is a typo, not a cliff.
  assert.equal(wayAttributes({ highway: 'footway', layer: '99' }).l, 7);
  assert.equal(wayAttributes({ highway: 'footway', layer: '-99' }).l, -8);
  assert.equal(wayAttributes({ highway: 'footway', layer: 'ground' }), null);

  // Only the two layers the router welds carry any of it.
  assert.deepEqual([...ROUTED_LAYERS].sort(), ['path', 'service']);
  return true;
});

await check('a boat slip is not a walking route', () => {
  /* The marina at Cedar Point is 228 floating finger docks and six and a half
     kilometres of them, all tagged exactly like the boardwalks. A person can
     stand on one; no route through a park goes down one. */
  assert.equal(classify(LAYER_RULES, { man_made: 'pier', floating: 'yes', name: 'Pier 11' }), null);
  // Unless it is also drawn as somewhere to walk, which a few of them are.
  assert.equal(classify(LAYER_RULES, { man_made: 'pier', floating: 'yes', highway: 'footway' }), 'path');
  return true;
});

await check('ordinary map furniture lands in the right layer', () => {
  assert.equal(classify(LAYER_RULES, { highway: 'footway' }), 'path');
  assert.equal(classify(LAYER_RULES, { highway: 'service' }), 'service');
  assert.equal(classify(LAYER_RULES, { natural: 'water' }), 'water');
  assert.equal(classify(LAYER_RULES, { amenity: 'parking' }), 'parking');
  assert.equal(classify(LAYER_RULES, { building: 'yes' }), 'building');
  assert.equal(classify(LAYER_RULES, { name: 'Nothing in particular' }), null);
  return true;
});

// The rules have to hold up somewhere that is not an amusement park, which is
// the whole claim the venue builder makes.
await check('a campus and a town centre classify without coasters', () => {
  assert.equal(classify(POI_RULES, { amenity: 'cafe', name: 'Refectory' }), 'food');
  assert.equal(classify(POI_RULES, { amenity: 'toilets' }), 'restroom');
  assert.equal(classify(POI_RULES, { shop: 'books', name: 'Campus Books' }), 'shop');
  assert.equal(classify(POI_RULES, { historic: 'memorial', name: 'War Memorial' }), 'landmark');
  assert.equal(isLand({ place: 'neighbourhood', name: 'Old Town' }), true);
  assert.equal(isLand({ amenity: 'university', name: 'The University' }), true);
  assert.equal(isLand({ building: 'yes', name: 'Hall' }), false);
  return true;
});

/* -------------------------------------------------------- ride reports --- */

section('state/ride-reports');

await check('a member can report a ride down', () => {
  const now = 2_000_000;
  const state = seeded(now);
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'the-beast', status: RIDE_DOWN } },
    now,
  );
  assert.equal(out.state.version, state.version + 1);
  assert.deepEqual(out.state.rides['the-beast'], {
    id: 'the-beast',
    status: RIDE_DOWN,
    by: PEER,
    byName: 'Ava',
    ts: now,
    note: null,
  });
  return true;
});

await check('a ride report is not owned by whoever wrote it', () => {
  const now = 2_000_000;
  let state = seeded(now);
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'orion', status: RIDE_DOWN } },
    now,
  ).state;
  // Unlike a member record, the next person past the gate may correct it.
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: HOST, body: { rideId: 'orion', status: RIDE_OPEN } },
    now + 60_000,
  );
  assert.equal(out.state.rides.orion.status, RIDE_OPEN);
  assert.equal(out.state.rides.orion.by, HOST);
  return true;
});

await check('re-reporting the same thing straight away is silent', () => {
  const now = 2_000_000;
  let state = seeded(now);
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'banshee', status: RIDE_DOWN } },
    now,
  ).state;
  const before = state.version;
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: HOST, body: { rideId: 'banshee', status: RIDE_DOWN } },
    now + 1000,
  );
  assert.equal(out.ops.length, 0);
  assert.equal(out.state.version, before);
  return true;
});

await check('re-reporting later refreshes the clock', () => {
  const now = 2_000_000;
  let state = seeded(now);
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'banshee', status: RIDE_DOWN } },
    now,
  ).state;
  const later = now + RIDE_CONFIRM_MS + 1;
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: HOST, body: { rideId: 'banshee', status: RIDE_DOWN } },
    later,
  );
  assert.equal(out.ops.length, 1);
  assert.equal(out.state.rides.banshee.ts, later);
  return true;
});

await check('a retraction removes the record rather than writing open over it', () => {
  const now = 2_000_000;
  let state = seeded(now);
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'diamondback', status: RIDE_DOWN } },
    now,
  ).state;
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'diamondback', status: null } },
    now + 1,
  );
  assert.equal(out.state.rides.diamondback, undefined);
  // An unreported ride and a retracted one must be indistinguishable.
  assert.deepEqual(Object.keys(out.state.rides), []);
  return true;
});

await check('a nonsense status never reaches the party', () => {
  const now = 2_000_000;
  const state = seeded(now);
  for (const body of [
    { rideId: 'orion', status: 'exploded' },
    { rideId: '', status: RIDE_DOWN },
    { rideId: 42, status: RIDE_DOWN },
  ]) {
    const out = reduce(state, { kind: 'set-ride-status', from: PEER, body }, now);
    assert.equal(out.ops.length, 0, JSON.stringify(body));
  }
  return true;
});

await check('a stranger cannot report anything', () => {
  const now = 2_000_000;
  const state = seeded(now);
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: 'nobody', body: { rideId: 'orion', status: RIDE_DOWN } },
    now,
  );
  assert.equal(out.ops.length, 0);
  return true;
});

await check('a note rides along but is clipped', () => {
  const now = 2_000_000;
  const state = seeded(now);
  const out = reduce(
    state,
    {
      kind: 'set-ride-status',
      from: PEER,
      body: { rideId: 'orion', status: RIDE_DOWN, note: 'x'.repeat(200) },
    },
    now,
  );
  assert.equal(out.state.rides.orion.note.length, 60);
  return true;
});

await check('evictRides drops reports past the TTL and leaves the rest', () => {
  const now = 2_000_000;
  let state = seeded(now);
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'old', status: RIDE_DOWN } },
    now,
  ).state;
  state = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'fresh', status: RIDE_DOWN } },
    now + RIDE_REPORT_TTL_MS,
  ).state;
  const out = evictRides(state, now + RIDE_REPORT_TTL_MS + 1);
  assert.equal(out.state.rides.old, undefined);
  assert.ok(out.state.rides.fresh);
  assert.equal(out.state.version, state.version + 1);
  return true;
});

await check('evictRides with nothing to do bumps no version', () => {
  const state = seeded(2_000_000);
  const out = evictRides(state, 2_000_000);
  assert.equal(out.ops.length, 0);
  assert.equal(out.state, state);
  return true;
});

await check('a report replicates onto a replica through ops alone', () => {
  const now = 2_000_000;
  const state = seeded(now);
  const out = reduce(
    state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'orion', status: RIDE_DOWN } },
    now,
  );
  const replica = applyOps(state, out.ops);
  assert.deepEqual(replica.rides, out.state.rides);
  // And the deletion op replicates too.
  const gone = reduce(
    out.state,
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'orion', status: null } },
    now + 1,
  );
  assert.deepEqual(applyOps(replica, gone.ops).rides, {});
  return true;
});

await check('publicSnapshot carries the ride reports', () => {
  const now = 2_000_000;
  const state = reduce(
    seeded(now),
    { kind: 'set-ride-status', from: PEER, body: { rideId: 'orion', status: RIDE_DOWN } },
    now,
  ).state;
  assert.equal(publicSnapshot(state).rides.orion.status, RIDE_DOWN);
  return true;
});

await check('isReportStale hedges an old report', () => {
  const now = 2_000_000;
  assert.equal(isReportStale({ ts: now }, now), false);
  assert.equal(isReportStale({ ts: now - RIDE_STALE_AFTER_MS - 1 }, now), true);
  assert.equal(isReportStale(null, now), true);
  return true;
});

/* ------------------------------------------------------------- weather --- */

section('weather/exposure');

const wxPoi = (n, c, a, note) => ({ id: n.toLowerCase().replace(/\W+/g, '-'), n, c, a, note });

await check('a food stand is sheltered and never carries ride status', () => {
  const e = exposureFor(wxPoi('Skyline Chili', 'food', 'Coney Mall'));
  assert.equal(e.kind, 'sheltered');
  assert.equal(e.shelter, 'indoor');
  return true;
});

await check('parking and gates are inert', () => {
  assert.equal(exposureFor(wxPoi('North Lot', 'parking', 'Parking')).kind, 'inert');
  assert.equal(exposureFor(wxPoi('Main Entrance', 'gate', 'Front Gate')).kind, 'inert');
  return true;
});

await check('a water-park area marks its rides as the water park', () => {
  const e = exposureFor(wxPoi('Tropical Plunge', 'ride', 'Soak City'));
  assert.equal(e.waterpark, true);
  assert.equal(e.wet, true);
  return true;
});

await check('a flume outside the water park is wet but not the water park', () => {
  const e = exposureFor(wxPoi('White Water Canyon', 'ride', 'Rivertown'));
  assert.equal(e.wet, true);
  assert.equal(e.waterpark, false);
  return true;
});

await check('a note saying indoor is believed over the name', () => {
  const e = exposureFor(wxPoi('Flight of Fear', 'coaster', 'Area 72', 'Indoor launch coaster'));
  assert.equal(e.shelter, 'indoor');
  // And an enclosed ride is never counted as wind-exposed, whatever it is called.
  assert.equal(e.tall, false);
  return true;
});

await check('drop towers and skyflyers read as tall', () => {
  assert.equal(exposureFor(wxPoi('Drop Tower: Scream Zone', 'ride', 'Action Zone')).tall, true);
  assert.equal(exposureFor(wxPoi('WindSeeker', 'ride', 'Coney Mall')).tall, true);
  assert.equal(exposureFor(wxPoi('Xtreme Skyflyer', 'ride', 'Action Zone')).tall, true);
  assert.equal(exposureFor(wxPoi('Dodgem', 'ride', 'Coney Mall')).tall, false);
  return true;
});

await check('an amphitheatre is open air, a theater is not', () => {
  assert.equal(exposureFor(wxPoi('Timberwolf Amphitheatre', 'show', 'Action Zone')).shelter, 'open');
  assert.equal(exposureFor(wxPoi('Festhaus Theater', 'show', 'International Street')).shelter, 'indoor');
  return true;
});

await check('exposure reads a park it has never seen', () => {
  // Nothing in weather.js knows a ride name, so another park's vocabulary
  // classifies on the same rules.
  assert.equal(exposureFor(wxPoi('Typhoon Tower', 'ride', 'Hurricane Harbor')).waterpark, true);
  assert.equal(exposureFor(wxPoi('Superman: Tower of Power', 'ride', 'Goliath Plaza')).tall, true);
  return true;
});

section('weather/classify');

await check('a missing reading is clear, not an alarm', () => {
  assert.equal(classifyWeather(null).key, CONDITIONS.clear.key);
  assert.equal(classifyWeather({}).key, CONDITIONS.clear.key);
  return true;
});

await check('a thunderstorm code is a storm', () => {
  const w = classifyWeather({ code: 95, tempF: 78 });
  assert.equal(w.key, CONDITIONS.storm.key);
  assert.ok(w.reasons.some((r) => /lightning/i.test(r)));
  return true;
});

await check('lightning outranks everything below it', () => {
  const w = classifyWeather({ code: 96, gustMph: 50, tempF: 50 });
  assert.equal(w.key, CONDITIONS.storm.key);
  // The flattened ladder still keeps the facts the outlook rules need.
  assert.equal(w.obs.windy, true);
  assert.equal(w.obs.cold, true);
  return true;
});

await check('high CAPE alone is not a storm without rain behind it', () => {
  // Convective energy with a dry forecast is just a warm afternoon.
  assert.equal(classifyWeather({ cape: 3000, precipChance: 10, tempF: 90 }).key, CONDITIONS.clear.key);
  assert.equal(classifyWeather({ cape: 3000, precipChance: 70, tempF: 80 }).key, CONDITIONS.storm.key);
  return true;
});

await check('extreme heat is called out but closes nothing', () => {
  const w = classifyWeather({ tempF: 102 });
  assert.equal(w.key, CONDITIONS.heat.key);
  assert.equal(outlookFor(wxPoi('The Beast', 'coaster', 'Rivertown'), w).key, OUTLOOK.running.key);
  return true;
});

await check('gusts at the hold threshold are wind', () => {
  assert.equal(classifyWeather({ gustMph: WIND_HOLD_MPH, tempF: 80 }).key, CONDITIONS.wind.key);
  assert.equal(classifyWeather({ gustMph: WIND_HOLD_MPH - 1, tempF: 80 }).key, CONDITIONS.clear.key);
  return true;
});

await check('a cold day reads as cold for the water park', () => {
  assert.equal(classifyWeather({ tempF: COLD_WATER_F - 1 }).key, CONDITIONS.cold.key);
  assert.equal(classifyWeather({ tempF: COLD_WATER_F }).key, CONDITIONS.clear.key);
  return true;
});

await check('a high chance of rain counts even with nothing falling yet', () => {
  assert.equal(classifyWeather({ precipChance: 80, tempF: 80 }).key, CONDITIONS.rain.key);
  assert.equal(classifyWeather({ precipChance: 30, tempF: 80 }).key, CONDITIONS.clear.key);
  return true;
});

section('weather/outlook');

const STORM = classifyWeather({ code: 95, tempF: 75, precipChance: 90 });
const GALE = classifyWeather({ gustMph: 38, tempF: 75 });
const HARD_GALE = classifyWeather({ gustMph: WIND_HARD_MPH + 5, tempF: 75 });
const SHOWER = classifyWeather({ code: 63, tempF: 75 });
const CHILLY = classifyWeather({ tempF: 55 });
const FINE = classifyWeather({ tempF: 78, gustMph: 6, code: 0 });

await check('lightning closes the outdoor rides and empties the pools', () => {
  assert.equal(outlookFor(wxPoi('The Beast', 'coaster', 'Rivertown'), STORM).key, OUTLOOK.closed.key);
  assert.equal(outlookFor(wxPoi('Breakers Bay', 'ride', 'Soak City'), STORM).key, OUTLOOK.closed.key);
  return true;
});

await check('an indoor ride keeps going through a storm', () => {
  const o = outlookFor(wxPoi('Flight of Fear', 'coaster', 'Area 72', 'Indoor launch coaster'), STORM);
  assert.equal(o.key, OUTLOOK.watch.key);
  const food = outlookFor(wxPoi('Skyline Chili', 'food', 'Coney Mall'), STORM);
  assert.equal(food.key, OUTLOOK.running.key);
  return true;
});

await check('wind takes the tall rides before anything else', () => {
  assert.equal(outlookFor(wxPoi('WindSeeker', 'ride', 'Coney Mall'), GALE).key, OUTLOOK.hold.key);
  assert.equal(outlookFor(wxPoi('Dodgem', 'ride', 'Coney Mall'), GALE).key, OUTLOOK.running.key);
  return true;
});

await check('a hard gale takes the tall rides down and holds the rest', () => {
  assert.equal(outlookFor(wxPoi('WindSeeker', 'ride', 'Coney Mall'), HARD_GALE).key, OUTLOOK.closed.key);
  assert.equal(outlookFor(wxPoi('The Racer', 'coaster', 'Coney Mall'), HARD_GALE).key, OUTLOOK.hold.key);
  return true;
});

await check('a dry gale does not put the whole park on a rain watch', () => {
  // Regression: the catch-all keyed on the severity ladder, and wind outranks
  // rain on it, so every outdoor ride read "Rain in the forecast" in a gale.
  const dry = classifyWeather({ gustMph: 38, tempF: 75, precipChance: 5 });
  const racer = outlookFor(wxPoi('The Racer', 'coaster', 'Coney Mall'), dry);
  assert.equal(racer.key, OUTLOOK.running.key);
  // The tall rides are still held — that is the part a gale is supposed to do.
  assert.equal(outlookFor(wxPoi('WindSeeker', 'ride', 'Coney Mall'), dry).key, OUTLOOK.hold.key);
  return true;
});

await check('rain coming but not yet is a watch, and only for what stays dry', () => {
  const soon = classifyWeather({ precipChance: 80, tempF: 75 });
  assert.equal(outlookFor(wxPoi('The Racer', 'coaster', 'Coney Mall'), soon).key, OUTLOOK.watch.key);
  assert.equal(outlookFor(wxPoi('White Water Canyon', 'ride', 'Rivertown'), soon).key, OUTLOOK.running.key);
  return true;
});

await check('rain is not news for a ride that soaks you', () => {
  assert.equal(outlookFor(wxPoi('White Water Canyon', 'ride', 'Rivertown'), SHOWER).key, OUTLOOK.running.key);
  assert.equal(outlookFor(wxPoi('The Racer', 'coaster', 'Coney Mall'), SHOWER).key, OUTLOOK.watch.key);
  return true;
});

await check('rain empties an amphitheatre but not a theater', () => {
  assert.equal(outlookFor(wxPoi('Timberwolf Amphitheatre', 'show', 'Action Zone'), SHOWER).key, OUTLOOK.hold.key);
  assert.equal(outlookFor(wxPoi('Festhaus Theater', 'show', 'International Street'), SHOWER).key, OUTLOOK.running.key);
  return true;
});

await check('a cold day shuts the water park and nothing else', () => {
  assert.equal(outlookFor(wxPoi('Tropical Plunge', 'ride', 'Soak City'), CHILLY).key, OUTLOOK.closed.key);
  assert.equal(outlookFor(wxPoi('The Beast', 'coaster', 'Rivertown'), CHILLY).key, OUTLOOK.running.key);
  return true;
});

await check('a fine day says nothing about anything', () => {
  for (const p of [
    wxPoi('The Beast', 'coaster', 'Rivertown'),
    wxPoi('Tropical Plunge', 'ride', 'Soak City'),
    wxPoi('WindSeeker', 'ride', 'Coney Mall'),
  ]) {
    assert.equal(outlookFor(p, FINE).key, OUTLOOK.running.key, p.n);
  }
  return true;
});

await check('no forecast at all is never a warning', () => {
  assert.equal(outlookFor(wxPoi('The Beast', 'coaster', 'Rivertown'), null).key, OUTLOOK.running.key);
  return true;
});

await check('parkOutlook counts rides and ignores the gift shops', () => {
  const pois = [
    wxPoi('The Beast', 'coaster', 'Rivertown'),
    wxPoi('Tropical Plunge', 'ride', 'Soak City'),
    wxPoi('Skyline Chili', 'food', 'Coney Mall'),
    wxPoi('North Lot', 'parking', 'Parking'),
  ];
  const out = parkOutlook(pois, STORM);
  assert.equal(out.total, 2);
  assert.equal(out.tally.closed, 2);
  assert.equal(out.worst.key, OUTLOOK.closed.key);
  return true;
});

/* -------------------------------------------------- reports vs forecast -- */

section('status/merge');

const BEAST = wxPoi('The Beast', 'coaster', 'Rivertown');

await check('a fresh report beats the forecast in both directions', () => {
  const now = 5_000_000;
  const down = statusFor(BEAST, { status: RIDE_DOWN, byName: 'Ava', ts: now - 60_000 }, FINE, now);
  assert.equal(down.key, STATUS.down.key);
  assert.equal(down.source, 'party');
  assert.match(down.detail, /Ava, 1 min ago/);

  // And a person saying it is running outranks a forecast saying it should not be.
  const up = statusFor(BEAST, { status: RIDE_OPEN, byName: 'Ava', ts: now }, STORM, now);
  assert.equal(up.key, STATUS.open.key);
  assert.equal(up.source, 'party');
  return true;
});

await check('with no report the forecast speaks', () => {
  const now = 5_000_000;
  const s = statusFor(BEAST, null, STORM, now);
  assert.equal(s.key, STATUS.closed.key);
  assert.equal(s.source, 'weather');
  assert.ok(s.detail);
  return true;
});

await check('a stale down still counts against a clear sky', () => {
  const now = 5_000_000;
  const s = statusFor(BEAST, { status: RIDE_DOWN, byName: 'Ava', ts: now - RIDE_STALE_AFTER_MS - 1 }, FINE, now);
  assert.equal(s.tone, 'bad');
  assert.equal(s.stale, true);
  assert.equal(s.label, 'Was down');
  return true;
});

await check('but weather that has since turned takes the headline back', () => {
  const now = 5_000_000;
  const old = { status: RIDE_DOWN, byName: 'Ava', ts: now - RIDE_STALE_AFTER_MS - 1 };
  const s = statusFor(BEAST, old, STORM, now);
  assert.equal(s.source, 'weather');
  assert.equal(s.key, STATUS.closed.key);
  assert.equal(s.stale, true);
  // The report is still handed over, so the UI can show both if it wants to.
  assert.equal(s.report, old);
  return true;
});

await check('a stale open does not outrank a storm', () => {
  const now = 5_000_000;
  const s = statusFor(BEAST, { status: RIDE_OPEN, byName: 'Ava', ts: now - RIDE_STALE_AFTER_MS - 1 }, STORM, now);
  assert.equal(s.source, 'weather');
  assert.equal(s.key, STATUS.closed.key);
  return true;
});

await check('a garbage report is ignored rather than rendered', () => {
  const now = 5_000_000;
  const s = statusFor(BEAST, { status: 'melted', ts: now }, FINE, now);
  assert.equal(s.source, 'none');
  assert.equal(s.report, null);
  return true;
});

await check('a clear sky with nothing reported says nothing at all', () => {
  const s = statusFor(BEAST, null, FINE, 5_000_000);
  assert.equal(s.key, STATUS.running.key);
  assert.equal(s.label, '');
  return true;
});

await check('the summary keeps reports and guesses apart', () => {
  const now = 5_000_000;
  const pois = [
    BEAST,
    wxPoi('WindSeeker', 'ride', 'Coney Mall'),
    wxPoi('Skyline Chili', 'food', 'Coney Mall'),
  ];
  const reports = { [BEAST.id]: { status: RIDE_DOWN, byName: 'Ava', ts: now } };
  const sum = statusSummary(pois, reports, GALE, now);
  // One person saw one ride down; the forecast doubts one more. Never merged
  // into a single number, which would claim two rides are known to be out.
  assert.equal(sum.reportedDown, 1);
  assert.equal(sum.atRisk, 1);
  return true;
});

await check('the summary survives no weather and no party', () => {
  const sum = statusSummary([BEAST], null, null, 5_000_000);
  assert.deepEqual(sum, { reportedDown: 0, atRisk: 0 });
  return true;
});

/* ------------------------------------------------------------ venue ids -- */

section('venue/ids');

await check('every place in every shipped venue gets a unique id', () => {
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../public/venues/manifest.json', import.meta.url), 'utf8'),
  );
  assert.ok(manifest.venues.length > 0);
  for (const v of manifest.venues) {
    const pois = JSON.parse(
      fs.readFileSync(new URL(`../public/venues/${v.id}.pois.json`, import.meta.url), 'utf8'),
    );
    const ids = withIds(pois).map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${v.id} has colliding ids`);
    assert.equal(ids.length, pois.length, `${v.id} lost places`);
    assert.ok(ids.every(Boolean), `${v.id} has a blank id`);
  }
  return true;
});

await check('a repeated name is suffixed in file order', () => {
  // The case that matters: a park has ten "Restrooms", and a ride report is
  // addressed by id. Every reader has to number them the same way.
  const ids = withIds([
    { n: 'Restrooms' },
    { n: 'The Beast' },
    { n: 'Restrooms' },
    { n: 'Restrooms' },
  ]).map((p) => p.id);
  assert.deepEqual(ids, ['restrooms', 'the-beast', 'restrooms-2', 'restrooms-3']);
  return true;
});

await check('a nameless place still gets an id rather than an empty one', () => {
  assert.deepEqual(withIds([{ n: '' }, { n: '!!!' }]).map((p) => p.id), ['poi', 'poi-2']);
  return true;
});

await check('withIds does not mutate what it is given', () => {
  const input = [{ n: 'Orion' }];
  withIds(input);
  assert.equal(input[0].id, undefined);
  return true;
});

await check('a place is addressable by id and by name', () => {
  const index = indexById(withIds([{ n: 'Orion' }, { n: 'Restrooms' }, { n: 'Restrooms' }]));
  assert.equal(index.get('orion').n, 'Orion');
  // The first of a repeated name wins the bare-name key; the rest need the id.
  assert.equal(index.get('restrooms').n, 'Restrooms');
  assert.ok(index.get('restrooms-2'));
  return true;
});

/* ------------------------------------------------------- primary keys ---- */

/* The key a place is issued at build time, and the ledger that remembers it.
   Everything below is about one property: an edit is filed under a key, so a
   key that moves does not move the edit — it loses it. */

section('venue/keys');

/** A venue at build time: three places, one name worn twice. */
const SOURCE = () => [
  { n: 'Orion', lat: 39.3441, lng: -84.2681, c: 'coaster', osm: 'w111' },
  { n: 'Restrooms', lat: 39.3450, lng: -84.2700, c: 'restroom', osm: 'n222' },
  { n: 'Restrooms', lat: 39.3402, lng: -84.2650, c: 'restroom', osm: 'n333' },
];
/* Keyed on where a place stands, because that is the one thing every pass
   here leaves alone — the name repeats and `osm` is stripped on the way out. */
const keysOf = (pois) => Object.fromEntries(pois.map((p) => [`${p.lat},${p.lng}`, p.i]));

await check('a key survives the park renaming the ride', () => {
  const first = assignKeys(SOURCE(), null, { venue: 'v' });
  assert.equal(first.pois.find((p) => p.n === 'Orion').i, 'orion');

  // Same coaster, same OpenStreetMap way, new name on the sign.
  const renamed = SOURCE().map((p) => (p.osm === 'w111' ? { ...p, n: 'Orion Reborn' } : p));
  const second = assignKeys(renamed, first.ledger, { venue: 'v' });
  const moved = second.pois.find((p) => p.n === 'Orion Reborn');
  assert.equal(moved.i, 'orion', 'the key follows the ride, not the sign');
  // And the title moved while the key did not — that is the whole split.
  assert.equal(titleOf(moved), 'Orion Reborn');
  assert.equal(keyOf(moved), 'orion');
  return true;
});

await check('a key survives a rebuild that hands the places over in another order', () => {
  const first = assignKeys(SOURCE(), null, { venue: 'v' });
  // Overpass is under no obligation to answer in the same order twice.
  const shuffled = [...SOURCE()].reverse();
  const second = assignKeys(shuffled, first.ledger, { venue: 'v' });
  assert.deepEqual(keysOf(second.pois), keysOf(first.pois));
  // Even with no ledger at all, the order it arrives in cannot decide a key:
  // an unmatched place is numbered by where it stands, not by where it sits in
  // the array.
  const scratch = assignKeys(shuffled, null, { venue: 'v' });
  assert.deepEqual(keysOf(scratch.pois), keysOf(first.pois));
  return true;
});

await check('two places sharing a name get different keys, and keep the ones they had', () => {
  const first = assignKeys(SOURCE(), null, { venue: 'v' });
  const north = first.pois.find((p) => p.lat > 39.344 && p.n === 'Restrooms').i;
  const south = first.pois.find((p) => p.lat < 39.344 && p.n === 'Restrooms').i;
  assert.notEqual(north, south);

  /* The failure this replaces: the northern block is deleted, so under the old
     rule every restroom after it in the file shifted up a number and a "closed"
     report landed on the wrong one. Here the survivor keeps its own number. */
  const without = SOURCE().filter((p) => p.osm !== 'n222');
  const second = assignKeys(without, first.ledger, { venue: 'v' });
  assert.equal(second.pois.find((p) => p.n === 'Restrooms').i, south);

  // And the vacated number is retired rather than freed: a new block built on
  // the same spot next season is a different place and must not inherit its
  // reports.
  assert.equal(second.ledger.keys[north].retired, true);
  const reborn = [...without, { n: 'Restrooms', lat: 39.3450, lng: -84.2700, c: 'restroom', osm: 'n444' }];
  const third = assignKeys(reborn, second.ledger, { venue: 'v' });
  const issued = third.pois.map((p) => p.i);
  assert.equal(new Set(issued).size, issued.length);
  assert.ok(!issued.includes(north), `${north} was reissued`);
  return true;
});

await check('the same object coming back gets its own key back', () => {
  const first = assignKeys(SOURCE(), null, { venue: 'v' });
  const gone = SOURCE().filter((p) => p.osm !== 'n333');
  const second = assignKeys(gone, first.ledger, { venue: 'v' });
  // A mapper deletes it, somebody puts it back. Same element, same key.
  const third = assignKeys(SOURCE(), second.ledger, { venue: 'v' });
  assert.deepEqual(keysOf(third.pois), keysOf(first.pois));
  return true;
});

await check('a place with no OpenStreetMap element of its own still gets a stable key', () => {
  /* Pitches, rides taken from their track, traced places and everything under
     `overrides.add` have no element at all, which is the reason an element id
     could not be the key. They match on position instead. */
  const hand = [
    { n: 'First Aid', lat: 39.3410, lng: -84.2660, c: 'service' },
    { n: 'Site 247', lat: 39.3480, lng: -84.2710, c: 'campsite' },
  ];
  const first = assignKeys(hand, null, { venue: 'v' });
  const second = assignKeys([...hand].reverse(), first.ledger, { venue: 'v' });
  assert.deepEqual(keysOf(second.pois), keysOf(first.pois));
  assert.deepEqual(first.pois.map((p) => p.i).sort(), ['first-aid', 'site-247']);
  return true;
});

await check('the element id is kept as provenance and never reaches the phone', () => {
  assert.equal(osmRef({ type: 'way', id: 12345 }), 'w12345');
  assert.equal(osmRef({ type: 'node', id: 7 }), 'n7');
  assert.equal(osmRef({ type: 'relation', id: 7 }), 'r7');
  assert.equal(osmRef({ id: 7 }), null);
  const { pois, ledger } = assignKeys(SOURCE(), null, { venue: 'v' });
  // Off the bundle — no reader wants it and it is bytes on a precached file.
  assert.equal(pois.every((p) => p.osm === undefined), true);
  // In the ledger, where the next rebuild is the one that needs it.
  assert.equal(ledger.keys.orion.osm, 'w111');
  return true;
});

await check('a venue built before keys existed loads, and loads unchanged', () => {
  /* The bundles on disk carry no key. A phone updates its app long before it
     updates its precached map, so the fallback has to hold — and it has to
     produce exactly the ids that are already out there. */
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../public/venues/manifest.json', import.meta.url), 'utf8'),
  );
  for (const v of manifest.venues) {
    const pois = JSON.parse(
      fs.readFileSync(new URL(`../public/venues/${v.id}.pois.json`, import.meta.url), 'utf8'),
    );
    const ids = withIds(pois).map((p) => p.id);
    assert.equal(new Set(ids).size, ids.length, `${v.id}: the fallback collided`);
    /* And the migration is free: seeding the ledger from the bundle on disk
       reproduces every one of those ids, so nothing a visitor has already
       reported, favourited or navigated to moves when the keys land. */
    const seeded = seedLedger(v.id, pois);
    const keyed = assignKeys(pois, seeded, { venue: v.id }).pois.map((p) => p.i);
    assert.deepEqual(keyed, ids, `${v.id}: the ledger disagrees with what is on phones`);
  }
  return true;
});

await check('a key in the bundle beats the name, and the fallback steps around it', () => {
  const ids = withIds([
    { i: 'restrooms-2', n: 'Restrooms' },
    { n: 'Restrooms' },
    { n: 'Restrooms' },
  ]).map((p) => p.id);
  // The explicit key is honoured, and no derived id is allowed to collide with it.
  assert.deepEqual(ids, ['restrooms-2', 'restrooms', 'restrooms-3']);
  assert.equal(new Set(ids).size, 3);
  return true;
});

await check('a ledger that would not change is not rewritten', () => {
  /* A rebuild that changes nothing must change nothing on disk, or "does
     OpenStreetMap still say what we shipped?" stops being a question a diff can
     answer. The ledger is written through one serialiser so the build can ask. */
  const first = assignKeys(SOURCE(), null, { venue: 'v' });
  const second = assignKeys(SOURCE(), first.ledger, { venue: 'v' });
  assert.equal(serializeLedger(second.ledger), serializeLedger(first.ledger));
  // One line per key: a rename has to read as one changed line, not eight.
  assert.equal(serializeLedger(first.ledger).trim().split('\n').length, SOURCE().length + 6);
  return true;
});

await check('an overrides file keyed by a display name still lands on its places', () => {
  const { pois } = assignKeys(SOURCE(), null, { venue: 'v' });
  const book = addressBook(pois);
  // The name is an alias layer over the keys, and an ambiguous name deliberately
  // resolves to every place wearing it — two Poltergeists, one height rule.
  assert.deepEqual(resolveOverride(book, 'Restrooms').map((p) => p.i).sort(), ['restrooms', 'restrooms-2']);
  assert.deepEqual(resolveOverride(book, 'orion').map((p) => p.i), ['orion']);
  // The name the park renamed it *from*, which is what `alias` is for.
  assert.deepEqual(
    resolveOverride(book, 'Orion Reborn', { alias: 'Orion' }).map((p) => p.i),
    ['orion'],
  );
  assert.equal(resolveOverride(book, 'Nothing By That Name'), null);
  return true;
});

await check('a duplicate key is reported rather than quietly merged away', () => {
  /* The one function the checklist and the build's own refusal both read, so
     the two can never disagree about what a broken venue looks like. A hand-
     written `i` under a name two places wear is how this happens in practice. */
  const clash = assignKeys(
    [
      { i: 'restrooms', n: 'Restrooms', lat: 39.345, lng: -84.27, c: 'restroom' },
      { i: 'restrooms', n: 'Restrooms', lat: 39.340, lng: -84.265, c: 'restroom' },
      { n: 'Orion', lat: 39.3441, lng: -84.2681, c: 'coaster' },
    ],
    null,
    { venue: 'v' },
  );
  const audit = keyAudit(clash.pois);
  assert.equal(audit.total, 3);
  assert.equal(audit.unkeyed, 0);
  assert.deepEqual(audit.duplicates.map((d) => d.key), ['restrooms']);

  // Clean venues say so, and so does one that has no keys yet.
  assert.deepEqual(keyAudit(assignKeys(SOURCE(), null, { venue: 'v' }).pois).duplicates, []);
  assert.equal(keyAudit([{ n: 'Orion' }]).keyed, 0);
  return true;
});

await check('a key is the escape hatch for the name that addresses too much', () => {
  const { pois } = assignKeys(SOURCE(), null, { venue: 'v' });
  const book = addressBook(pois);
  // One of the two, on purpose — the case a name cannot express.
  const hit = resolveOverride(book, 'restrooms-2');
  assert.equal(hit.length, 1);
  assert.equal(hit[0].i, 'restrooms-2');
  return true;
});

section('push');

/* The notification path carries the most revealing frame the app has — a name,
   and often where that name is — through two parties that must not read it: our
   own relay and the phone vendor's push service. These assert that. */

const { default: webpush } = await import('web-push');

await check('a sealed note round-trips, and a phone from another party cannot open it', async () => {
  const pid = 'push-party-0001';
  const note = { kind: 'help', title: 'Ava needs help', body: 'Tap to see where they are.' };
  const sealed = await seal(key, pid, note);
  assert.deepEqual(await open(key, sealed), note);
  assert.equal(await open(other, sealed), null, 'a foreign key opened it');
  // The party id is authenticated, not encrypted: relabelling breaks the tag.
  assert.equal(await open(key, { ...sealed, pid: 'push-party-0002' }), null, 'relabelling worked');
  return true;
});

await check('nothing readable reaches the push service', async () => {
  const pid = 'push-party-0003';
  const vapid = webpush.generateVAPIDKeys();
  webpush.setVapidDetails('mailto:test@example.com', vapid.publicKey, vapid.privateKey);

  const { subtle } = globalThis.crypto;
  const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const b64 = (u8) => Buffer.from(u8).toString('base64url');
  const auth = new Uint8Array(16);
  globalThis.crypto.getRandomValues(auth);
  const sub = {
    endpoint: 'https://push.example.com/send/fake',
    keys: { p256dh: b64(raw), auth: b64(auth) },
  };

  const sealed = await seal(key, pid, { kind: 'help', title: 'Ava needs help', body: 'By Iron Rattler' });
  const req = webpush.generateRequestDetails(sub, JSON.stringify({ pid, sealed }), {
    TTL: 300,
    urgency: 'high',
  });

  assert.equal(req.headers.TTL, 300);
  assert.match(req.headers.Authorization || '', /^vapid /i, 'not VAPID-signed');
  assert.equal(req.headers['Content-Encoding'], 'aes128gcm');

  const wire = Buffer.from(req.body).toString('latin1');
  assert.equal(/Ava|Iron Rattler|help/i.test(wire), false, 'the words reached the wire');
  assert.equal(wire.includes(pid), false, 'the party id reached the wire');
  return true;
});

/* ----------------------------------------------------------- lib/sheet --- */

section('sheet');

const STOPS = sheetStops(844); // an iPhone 13/14/15's viewport

await check('the stops come out where the CSS puts them', () => {
  assert.equal(STOPS.shut, 84);
  assert.equal(STOPS.peek, SHEET_PEEK_PX);
  assert.equal(STOPS.half, 439);
  assert.equal(STOPS.full, 743);
  return true;
});

await check('a release away from every stop stays exactly where it was let go', () => {
  // The whole point of the rewrite: 360px is nowhere near a stop, so the sheet
  // is left at 360px rather than jumping to peek or half.
  assert.equal(settleSheet(360, STOPS, 0), 360);
  assert.equal(settleSheet(500, STOPS, 0), 500);
  return true;
});

await check('a release near a stop is taken by it', () => {
  assert.equal(settleSheet(STOPS.peek + 8, STOPS, 0), STOPS.peek);
  assert.equal(settleSheet(STOPS.half - SHEET_MAGNET_PX, STOPS, 0), STOPS.half);
  assert.equal(settleSheet(STOPS.half - SHEET_MAGNET_PX - 1, STOPS, 0), STOPS.half - 27);
  return true;
});

await check('a flick coasts, and a hard one reaches the ceiling', () => {
  // Let go just above peek but moving up at 2px/ms: 140ms of coast is 280px,
  // and it comes to rest there rather than being collected by a stop.
  assert.equal(settleSheet(STOPS.peek + 10, STOPS, 2), STOPS.peek + 290);
  // Thrown, it still gets all the way up — which is the reason for the coast.
  assert.equal(settleSheet(STOPS.peek + 10, STOPS, 4), STOPS.full);
  // The same release, slowly, is a placement rather than a throw.
  assert.equal(settleSheet(STOPS.peek + 40, STOPS, 0), STOPS.peek + 40);
  return true;
});

await check('a settle never leaves the travel', () => {
  assert.equal(settleSheet(9000, STOPS, 8), STOPS.full);
  assert.equal(settleSheet(-500, STOPS, -8), STOPS.shut);
  return true;
});

await check('a tap walks up the stops and wraps to shut', () => {
  assert.equal(nextSheetStop(STOPS.shut, STOPS), STOPS.peek);
  assert.equal(nextSheetStop(STOPS.peek, STOPS), STOPS.half);
  assert.equal(nextSheetStop(STOPS.half, STOPS), STOPS.full);
  assert.equal(nextSheetStop(STOPS.full, STOPS), STOPS.shut);
  return true;
});

await check('a tap from a height with no name goes to the next stop above it', () => {
  assert.equal(nextSheetStop(360, STOPS), STOPS.half);
  assert.equal(nextSheetStop(700, STOPS), STOPS.full);
  return true;
});

await check('the form only calls itself full near the ceiling', () => {
  assert.equal(sheetForm(STOPS.shut, STOPS), 'shut');
  assert.equal(sheetForm(STOPS.peek, STOPS), 'peek');
  assert.equal(sheetForm(STOPS.half, STOPS), 'half');
  assert.equal(sheetForm(STOPS.full, STOPS), 'full');
  // Two thirds of the way up is still a card floating over a map.
  assert.equal(sheetForm(560, STOPS), 'half');
  return true;
});

await check('the form agrees with the plan about whether anything is on the sheet', () => {
  // `shut` is not a midpoint: it ends exactly where the first rung becomes
  // affordable, or the sheet would show a shape with nothing in it.
  const edge = SHEET_CHROME_PX + SHEET_DIGEST_PX;
  assert.equal(sheetForm(edge - 1, STOPS), 'shut');
  assert.equal(sheetPlan(edge - 1).digest, false);
  assert.equal(sheetForm(edge, STOPS), 'peek');
  assert.equal(sheetPlan(edge).digest, true);
  return true;
});

await check('the shut stop pays for nothing at all', () => {
  const p = sheetPlan(STOPS.shut);
  assert.deepEqual(
    { ...p, spare: 0 },
    { digest: false, rail: false, search: false, brand: false, list: false, hint: false, spare: 0 },
  );
  return true;
});

await check('the glance stop buys the rail, the search field, the venue line and the hint', () => {
  const p = sheetPlan(STOPS.peek);
  assert.equal(p.rail, true);
  assert.equal(p.digest, false);
  assert.equal(p.search, true);
  assert.equal(p.brand, true);
  assert.equal(p.list, false);
  assert.equal(p.hint, true);
  return true;
});

await check('the rail degrades to one line before it disappears', () => {
  const p = sheetPlan(SHEET_CHROME_PX + SHEET_DIGEST_PX + 4);
  assert.equal(p.digest, true);
  assert.equal(p.rail, false);
  assert.equal(p.search, false);
  return true;
});

await check('the rail is bought before the search field, and the search field before its cards', () => {
  // The question a phone comes out of a pocket to ask is "which way, and how
  // long", not "what is this place called" — so the rail's line comes first.
  // Its upgrade to cards does not, because that would outbid a search field
  // already on the sheet. See the monotonicity check below.
  const line = sheetPlan(SHEET_CHROME_PX + SHEET_DIGEST_PX + 10);
  assert.equal(line.digest, true);
  assert.equal(line.search, false);

  const both = sheetPlan(200);
  assert.equal(both.digest, true);
  assert.equal(both.search, true);
  assert.equal(both.rail, false);
  return true;
});

await check('a rung that will not fit does not let a cheaper one below it in', () => {
  // Room for the rail's line and the venue line, but not the search field
  // between them.
  const p = sheetPlan(SHEET_CHROME_PX + SHEET_DIGEST_PX + 30);
  assert.equal(p.digest, true);
  assert.equal(p.search, false);
  assert.equal(p.brand, false, 'the park name arrived with no way to search it');
  return true;
});

await check('the hint is only offered once the list has been turned down', () => {
  assert.equal(sheetPlan(SHEET_LIST_AT_PX - 1).hint, true);
  assert.equal(sheetPlan(SHEET_LIST_AT_PX).hint, false);
  assert.equal(sheetPlan(SHEET_LIST_AT_PX).list, true);
  return true;
});

await check('the plan only ever grows as the sheet does', () => {
  // Nothing may drop out on the way up: a row that appears at 300px and is gone
  // again at 320 is the arithmetic showing through the interface.
  const rungs = ['digest', 'rail', 'search', 'brand', 'list'];
  let best = 0;
  for (let px = 0; px <= 900; px += 1) {
    const p = sheetPlan(px);
    // The digest is the rail's understudy, so count them as one rung.
    const score = (p.rail || p.digest ? 1 : 0) + rungs.slice(2).filter((k) => p[k]).length;
    assert.ok(score >= best, `the plan shrank at ${px}px`);
    best = score;
    if (p.rail) assert.equal(p.digest, false, `both rails at ${px}px`);
  }
  assert.equal(best, 4);
  return true;
});

await check('the map controls step aside before the sheet climbs into them', () => {
  // Not merely at the top stop: with four stops the pad fitted at half and was
  // hidden at full, and nothing could stop in between. Something can now.
  assert.equal(sheetCrowdsMap(STOPS.peek, 844), false);
  assert.equal(sheetCrowdsMap(STOPS.half, 844), false);
  assert.equal(sheetCrowdsMap(560, 844), true, 'the zoom pad is in the top bar');
  assert.equal(sheetCrowdsMap(STOPS.full, 844), true);
  return true;
});

await check('a short phone still reaches the list', () => {
  // An SE at 667px: half is 347, which is under the list's floor, so the app
  // has to send the sheet to the list's own height rather than to a named stop.
  const small = sheetStops(667);
  assert.ok(small.half < SHEET_LIST_AT_PX);
  assert.ok(small.full >= SHEET_LIST_AT_PX, 'no height on this phone shows the list');
  assert.equal(sheetPlan(SHEET_LIST_AT_PX).list, true);
  return true;
});

/* ------------------------------------------------------------- app version */

const { APP_VERSION, compareVersions, isNewerVersion, parseVersion } = await import('../lib/version.js');

await check('APP_VERSION is a semver string', () => {
  assert.ok(parseVersion(APP_VERSION), `not semver: ${APP_VERSION}`);
  return true;
});

await check('compareVersions orders releases correctly', () => {
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.1.0', '1.0.9'), 1);
  assert.equal(compareVersions('1.0.0', '2.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc1', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.0-rc1'), 1);
  return true;
});

await check('isNewerVersion is strict', () => {
  assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
  assert.equal(isNewerVersion('1.0.0', '1.0.0'), false);
  assert.equal(isNewerVersion('1.0.0', '1.1.0'), false);
  return true;
});

await check('inject-version stamps public/app-version.json from package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const stamped = JSON.parse(
    fs.readFileSync(new URL('../public/app-version.json', import.meta.url), 'utf8'),
  );
  assert.equal(stamped.version, pkg.version);
  assert.equal(typeof stamped.protocol, 'number');
  assert.ok(stamped.built);
  const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, new RegExp(`const CACHE = 'tracker-${pkg.version.replace(/\./g, '\\.')}'`));
  return true;
});

/* ---------------------------------------------------------------- tally -- */



console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
