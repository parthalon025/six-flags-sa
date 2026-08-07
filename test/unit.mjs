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
  MEMBER_TTL_MS,
  OP,
  ROLE_HOST,
  ROLE_MEMBER,
  applyOps,
  createMember,
  createParty,
  evict,
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
  navKeyOf,
  routeProgress,
  snapToGraph,
} = await import('../lib/routing.js');
const { distance } = await import('../lib/geo.js');

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
  fs.readFileSync(new URL('../public/parkmap.json', import.meta.url), 'utf8'),
);
const RIDES = JSON.parse(fs.readFileSync(new URL('../lib/rides.json', import.meta.url), 'utf8'));
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

/* ---------------------------------------------------------------- tally -- */


console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
