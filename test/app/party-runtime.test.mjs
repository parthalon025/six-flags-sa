#!/usr/bin/env node
/**
 * lib/partyRuntime.js — the single seam between React and the networking stack.
 *
 * 1115 lines, no test imported it. The rules below are real invariants that
 * were enforced only by the one call site remembering them: app/page.js
 * hand-rolls three separate in-flight guards (:1206, :1249, :1253) around
 * methods that are not re-entrant, and nothing anywhere states that they are
 * not.
 *
 * How the wire is observed. The runtime builds its own transport stack with no
 * seam to replace it (`buildTransports`, partyRuntime.js:519-532), so these
 * tests give it a browser with no network: every real transport probes
 * unavailable and the offline queue — always available by contract — becomes
 * the active path. Everything the runtime sends therefore lands in
 * `ki-outbox-<partyId>` in local storage, sealed under the party key the
 * snapshot hands out. Decrypting that is a faithful tap on what a phone would
 * have transmitted.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { installAppAlias } = await import('./lib/appAlias.mjs');
installAppAlias();

/* A phone-shaped global, installed before the module under test is loaded. */
const storage = new Map();
globalThis.window = {
  location: { origin: 'https://example.test' },
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
};
/** No network at all: `allocate` falls back to local ids, every transport fails. */
globalThis.fetch = async () => {
  throw new Error('offline');
};
/**
 * Read once per runtime, at construction (partyRuntime.js:283-284) — so a test
 * that wants a window it can outlive sets this before building its runtime.
 */
const DEFAULT_KEY_WINDOW_MS = 5000;
globalThis.__PARTY_KEY_WINDOW_MS = DEFAULT_KEY_WINDOW_MS;

const APP = '../../apps/party-tracker/';
const { createPartyRuntime } = await import(`${APP}lib/partyRuntime.js`);
const { importKey, open } = await import(`${APP}lib/core/crypto.js`);
const { createBroadcastGate } = await import(`${APP}lib/gps/adaptive.js`);
const { SESSION_STORAGE_KEY } = await import(`${APP}lib/core/session.js`);

const PASS = [];
const FAIL = [];
const live = new Set();
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  } finally {
    for (const rt of live) {
      try {
        await rt.destroy();
      } catch {
        /* a runtime that never opened is not a leak */
      }
    }
    live.clear();
  }
};

const settle = async (turns = 25) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0));
};

function runtime(handlers = {}) {
  const seen = { states: [], statuses: [], toasts: [] };
  const rt = createPartyRuntime({
    onState: (s) => seen.states.push(s),
    onStatus: (s) => seen.statuses.push(s),
    onToast: (t) => seen.toasts.push(t),
    ...handlers,
  });
  live.add(rt);
  rt.seen = seen;
  return rt;
}

/** Everything the runtime actually put on the wire, decrypted, oldest first. */
async function wire(partyId, keyString) {
  const key = await importKey(keyString);
  const raw = JSON.parse(storage.get(`ki-outbox-${partyId}`) || '[]');
  const out = [];
  for (const sealed of raw) {
    const f = await open(key, sealed);
    if (f) out.push(f);
  }
  return out;
}

const kinds = (frames) => frames.map((f) => f.kind);

/** A host party, connected, with the offline queue carrying its traffic. */
async function hostParty(rt = runtime()) {
  const snap = await rt.createParty({ name: 'Trip', memberName: 'Ana' });
  await settle();
  return { rt, snap };
}

/* -------------------------------------------------------- re-entrancy --- */

console.log('the entry points are not re-entrant');

await check('createParty called twice concurrently leaves exactly one live party', async () => {
  // partyRuntime.js:832 — createParty opens with `await teardown()`, which
  // destroys whatever the first call has built so far. app/page.js guards
  // every call site by hand because of this; nothing in the module says so.
  const rt = runtime();
  const [first, second] = await Promise.allSettled([
    rt.createParty({ name: 'A', memberName: 'Ana' }),
    rt.createParty({ name: 'B', memberName: 'Ana' }),
  ]);
  await settle();
  const now = rt.getSnapshot();

  assert.equal(now.phase, 'live', 'the interleaving left the runtime not live');
  assert.equal(now.hosting, true);
  // Whatever the two calls each returned, the runtime holds ONE party.
  const returned = [first, second]
    .filter((r) => r.status === 'fulfilled')
    .map((r) => r.value.partyId);
  assert.ok(returned.length >= 1);
  assert.ok(
    returned.includes(now.partyId),
    'the live party is one neither call returned — a session was orphaned',
  );
  // ...and the loser's party id is not the live one, i.e. it was discarded.
  const orphans = returned.filter((id) => id !== now.partyId);
  assert.ok(orphans.length <= 1, `more than one party survived: ${returned}`);
});

await check('a join racing a create does not leave the runtime half-attached', async () => {
  const seed = runtime();
  const { snap } = await hostParty(seed);
  const rt = runtime();
  await Promise.allSettled([
    rt.createParty({ name: 'A', memberName: 'Ben' }),
    rt.joinParty(snap.invite, { memberName: 'Ben' }),
  ]);
  await settle();
  const now = rt.getSnapshot();
  assert.equal(now.phase, 'live');
  // Exactly one of the two roles, never both and never neither.
  assert.equal(
    Number(now.hosting) + Number(now.role === 'client'),
    1,
    `runtime is ${JSON.stringify({ hosting: now.hosting, role: now.role })}`,
  );
  assert.equal(now.active, true, 'a half-attached runtime accepts no commands');
});

await check('resume racing a create is resolved the same way — one session', async () => {
  const seed = runtime();
  await hostParty(seed);
  await seed.destroy();
  const rt = runtime();
  await Promise.allSettled([
    rt.resume({ memberName: 'Ana' }),
    rt.createParty({ name: 'C', memberName: 'Ana' }),
  ]);
  await settle();
  const now = rt.getSnapshot();
  assert.equal(now.phase, 'live');
  assert.ok(now.partyId, 'no party id survived the interleaving');
  assert.equal(now.active, true);
});

/* ------------------------------------------------------------ teardown -- */

console.log('teardown mutes before it stops');

await check('unmounting posts no BYE — closing a tab is not leaving', async () => {
  // partyRuntime.js:744-750. `stop()` posts a BYE unconditionally, so teardown
  // has to mute the link first or an unmount deletes you from your own party.
  const seed = runtime();
  const { snap } = await hostParty(seed);
  const joiner = runtime();
  await joiner.joinParty(snap.invite, { memberName: 'Ben' });
  await settle();

  const before = kinds(await wire(snap.partyId, snap.keyString));
  assert.ok(before.includes('hello'), 'test setup: the joiner never said hello');

  await joiner.destroy();
  await settle();
  const after = kinds(await wire(snap.partyId, snap.keyString));
  assert.deepEqual(after, before, `an unmount put ${after.slice(before.length)} on the wire`);
});

await check('leaving deliberately does post a BYE', async () => {
  const seed = runtime();
  const { snap } = await hostParty(seed);
  const joiner = runtime();
  await joiner.joinParty(snap.invite, { memberName: 'Cat' });
  await settle();
  const before = kinds(await wire(snap.partyId, snap.keyString));

  await joiner.leave();
  await settle();
  const added = kinds(await wire(snap.partyId, snap.keyString)).slice(before.length);
  assert.ok(added.includes('bye'), 'a deliberate leave left a ghost on the roster');
});

await check("leave() broadcasts its BYE rather than addressing the host", async () => {
  // client.js:379-390 — `hostId` is only as fresh as the last host frame seen,
  // so a phone that has lived through a migration would address a member who
  // is gone and every roster would keep a ghost until the TTL.
  const seed = runtime();
  const { snap } = await hostParty(seed);
  const joiner = runtime();
  await joiner.joinParty(snap.invite, { memberName: 'Dee' });
  await settle();
  const before = (await wire(snap.partyId, snap.keyString)).length;
  await joiner.leave();
  await settle();
  const added = (await wire(snap.partyId, snap.keyString)).slice(before);
  const byes = added.filter((f) => f.kind === 'bye');
  assert.ok(byes.length >= 1);
  assert.ok(
    byes.some((f) => f.to === '*'),
    'no broadcast BYE — a migrated phone would leave a ghost behind',
  );
});

await check('teardown clears the snapshot back to idle and stops emitting', async () => {
  const rt = runtime();
  await hostParty(rt);
  await rt.destroy();
  const after = rt.getSnapshot();
  assert.equal(after.phase, 'idle');
  assert.equal(after.active, false);
  assert.equal(after.hosting, false);
  assert.equal(after.partyId, null);
  assert.equal(after.members.length, 0);
  const seenBefore = rt.seen.states.length;
  await rt.destroy(); // idempotent
  assert.equal(rt.seen.states.length, seenBefore, 'a destroyed runtime is still emitting');
});

/* ----------------------------------------------------------- resume ----- */

console.log('resume');

await check('resume comes back as a client, never as the host it was', async () => {
  // partyRuntime.js:907-915 — a reloaded tab has no authoritative state to
  // serve, and returning with an empty one at version 0 would strand every
  // replica ahead of it.
  const rt = runtime();
  const { snap } = await hostParty(rt);
  assert.equal(snap.hosting, true, 'test setup: this runtime was the host');
  await rt.destroy();

  const back = runtime();
  const resumed = await back.resume({ memberName: 'Ana' });
  await settle();
  assert.ok(resumed, 'the saved party did not reopen');
  assert.equal(resumed.partyId, snap.partyId, 'resume attached to a different party');
  assert.equal(resumed.hosting, false, 'resume came back as the host');
  assert.equal(resumed.role, 'client');
});

await check('resume returns null when there is nothing saved', async () => {
  storage.delete(SESSION_STORAGE_KEY);
  const rt = runtime();
  assert.equal(await rt.resume({ memberName: 'Ana' }), null);
  assert.equal(rt.getSnapshot().phase, 'idle');
});

await check('hasSavedParty and hasLiveParty read the store, not the runtime', async () => {
  storage.delete(SESSION_STORAGE_KEY);
  const rt = runtime();
  assert.equal(rt.hasSavedParty(), false);
  assert.equal(rt.hasLiveParty(), false);
  await hostParty(rt);
  assert.equal(rt.hasSavedParty(), true);
  assert.equal(rt.hasLiveParty(), true);
  // A destroyed runtime leaves the session behind on purpose — that is what
  // resume() is for. Only leave() clears it.
  await rt.destroy();
  assert.equal(rt.hasSavedParty(), true, 'an unmount deleted the saved session');
});

await check('leave() clears the saved session; destroy() does not', async () => {
  const rt = runtime();
  await hostParty(rt);
  await rt.leave();
  assert.equal(rt.hasSavedParty(), false);
  assert.equal(storage.get(SESSION_STORAGE_KEY), undefined);
});

/* --------------------------------------------------------- allowJoins --- */

console.log('allowJoins');

await check('a host opens the key window on its own, and it lapses', async () => {
  // Deliberately tiny window so the test can outlive it.
  globalThis.__PARTY_KEY_WINDOW_MS = 60;
  try {
    const rt = runtime();
    await hostParty(rt);
    // openKeyWindow() is fired and not awaited (partyRuntime.js:646), so the
    // snapshot createParty returned predates it — the window is on the NEXT one.
    assert.ok(rt.getSnapshot().joinsOpenUntil > 0, 'the window was never open');
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(rt.getSnapshot().joinsOpenUntil, 0, 'the window did not lapse');
  } finally {
    globalThis.__PARTY_KEY_WINDOW_MS = DEFAULT_KEY_WINDOW_MS;
  }
});

await check('allowJoins reopens a lapsed key window for a host', async () => {
  globalThis.__PARTY_KEY_WINDOW_MS = 60;
  let rt;
  try {
    rt = runtime();
    await hostParty(rt);
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(rt.getSnapshot().joinsOpenUntil, 0, 'test setup: the window must have lapsed');
  } finally {
    globalThis.__PARTY_KEY_WINDOW_MS = DEFAULT_KEY_WINDOW_MS;
  }
  rt.allowJoins();
  await settle();
  assert.ok(rt.getSnapshot().joinsOpenUntil > 0, 'allowJoins did not reopen the window');
});

await check('allowJoins is a silent no-op for a client', async () => {
  // partyRuntime.js:323-325 — `if (host) ...`. A UI that puts the code back on
  // screen on a non-hosting phone gets nothing, and no way to find that out.
  const seed = runtime();
  const { snap } = await hostParty(seed);
  const joiner = runtime();
  await joiner.joinParty(snap.invite, { memberName: 'Ben' });
  await settle();
  assert.equal(joiner.getSnapshot().hosting, false);
  assert.equal(joiner.getSnapshot().joinsOpenUntil, 0);

  assert.doesNotThrow(() => joiner.allowJoins());
  await settle();
  assert.equal(
    joiner.getSnapshot().joinsOpenUntil,
    0,
    'behaviour changed — a client can open a key window now',
  );
});

await check('allowJoins on an idle runtime does not throw', async () => {
  const rt = runtime();
  assert.doesNotThrow(() => rt.allowJoins());
  assert.equal(rt.getSnapshot().joinsOpenUntil, 0);
});

/* -------------------------------------------------------------- submit -- */

console.log('submit fails silently');

/** Every wrapper over `submit`, with an argument each will accept. */
const WRAPPERS = [
  ['submit', (rt) => rt.submit('heartbeat', {})],
  ['setMeet', (rt) => rt.setMeet({ lat: 1, lng: 2 })],
  ['setTarget', (rt) => rt.setTarget('ride-1')],
  ['reportRide', (rt) => rt.reportRide('ride-1', 'down', null)],
  ['setStatus', (rt) => rt.setStatus('here')],
  ['setGroupId', (rt) => rt.setGroupId('g1')],
  ['setShareMode', (rt) => rt.setShareMode('live')],
  ['bindUserId', (rt) => rt.bindUserId('usr_1')],
  ['setPlan', (rt) => rt.setPlan([])],
  ['applyContribution', (rt) => rt.applyContribution({})],
  ['addMember', (rt) => rt.addMember({ name: 'Kid' })],
  ['removeMember', (rt) => rt.removeMember('m1')],
  ['setMemberFacts', (rt) => rt.setMemberFacts({ height: 48 })],
  ['offerSkin', (rt) => rt.offerSkin('skin-1')],
  ['withdrawOffer', (rt) => rt.withdrawOffer('skin-1')],
  ['dropWorldMark', (rt) => rt.dropWorldMark({ type: 'x' })],
  ['thankWorldMark', (rt) => rt.thankWorldMark('m1')],
  ['setKit', (rt) => rt.setKit('kit-1')],
  ['setWearSkin', (rt) => rt.setWearSkin('skin-1')],
  ['pushLocation', (rt) => rt.pushLocation({ lat: 1, lng: 2, ts: 1 })],
  ['pushBattery', (rt) => rt.pushBattery(0.5)],
];

await check('every command wrapper returns null on a runtime with no party', async () => {
  // partyRuntime.js:963-968 — no session and no service means `return null`,
  // with nothing told to the caller and nothing told to the user. Twenty-one
  // wrappers inherit it. Pinned across the whole surface.
  const rt = runtime();
  for (const [name, call] of WRAPPERS) {
    assert.equal(call(rt), null, `${name} did not fail silently`);
  }
});

await check('the same wrappers still return null after teardown', async () => {
  const rt = runtime();
  await hostParty(rt);
  await rt.destroy();
  for (const [name, call] of WRAPPERS) {
    assert.equal(call(rt), null, `${name} threw or returned a value after destroy`);
  }
});

await check('setMemberName is the one wrapper that answers even with no party', async () => {
  const rt = runtime();
  // partyRuntime.js:993 — trim, then slice(0, 24). In that order, so a name cut
  // at the limit can come back with a trailing space. Pinned as written.
  assert.equal(rt.setMemberName('  A Very Long Name Indeed Yes  '), 'A Very Long Name Indeed ');
  assert.equal(rt.setMemberName('Ana'), 'Ana');
  assert.equal(rt.setMemberName(''), 'Guest');
  assert.equal(rt.setMemberName(null), 'Guest');
  assert.equal(rt.setMemberName('   '), 'Guest');
});

await check('a host command goes through the reducer and moves the version', async () => {
  const rt = runtime();
  const { snap } = await hostParty(rt);
  const before = rt.getSnapshot().version;
  const result = rt.setMeet({ lat: 1, lng: 2 });
  await settle();
  assert.notEqual(result, null, 'a live host still failed silently');
  const after = rt.getSnapshot();
  assert.ok(after.version > before, 'the command never reached the reducer');
  // The reducer stamps who set it and when (state.js:392-396).
  assert.equal(after.meet.lat, 1);
  assert.equal(after.meet.lng, 2);
  assert.equal(after.meet.by, 'Ana');
  assert.ok(Number.isFinite(after.meet.ts));
  assert.ok(
    kinds(await wire(snap.partyId, snap.keyString)).includes('patch'),
    'the host never told the party',
  );
});

/* ------------------------------------------- the gate / pushLocation gap - */

console.log('the adaptive gate and pushLocation');

await check('CHARACTERISED: a dropped fix is one the gate has already spent', async () => {
  // components/useGeolocation.js:283-286 asks the gate, and the gate's
  // `shouldSend` COMMITS on the way out (lib/gps/adaptive.js:129-165): it
  // records the fix as sent before app/page.js:1637-1641 has called
  // pushLocation. pushLocation then returns null with no session or service
  // (partyRuntime.js:963-968, :974-977) and the fix is gone — but the gate
  // believes it went, so it refuses the next one until the phone has moved
  // 12 m or 20 s have passed.
  //
  // Pinned as OBSERVED. Do not fix here — this is the follow-up's to reshape.
  const gate = createBroadcastGate();
  const rt = runtime(); // no party: pushLocation cannot deliver

  const fix = { lat: 39.3447, lng: -84.2686, ts: 1_000 };
  const first = gate.shouldSend(fix, { now: 1_000 });
  assert.equal(first.send, true, 'the gate refused the very first fix');
  assert.equal(rt.pushLocation(fix), null, 'the runtime accepted it after all');

  // The very next offer, same spot, moments later: the gate says no, because
  // as far as it knows the last one was broadcast.
  const second = gate.shouldSend({ ...fix, ts: 1_500 }, { now: 1_500 });
  assert.equal(second.send, false);
  assert.equal(second.reason, 'rate-limited');

  // Even well past the rate limit it stays refused — nothing has changed, and
  // the fix that was dropped is still recorded as the last one sent.
  const third = gate.shouldSend({ ...fix, ts: 12_000 }, { now: 12_000 });
  assert.equal(third.send, false);
  assert.equal(third.reason, 'unchanged');

  // The party only hears about this phone again on the 20s heartbeat.
  const fourth = gate.shouldSend({ ...fix, ts: 21_500 }, { now: 21_500 });
  assert.equal(fourth.send, true);
  assert.equal(fourth.reason, 'heartbeat');
});

await check('`active` means a service will accept a command, not merely a session', async () => {
  // partyRuntime.js:159-167 — the snapshot's own comment: "otherwise the first
  // location a phone ever produces is thrown away, and the broadcast gate,
  // having recorded it as sent, does not offer another until the phone moves".
  const rt = runtime();
  assert.equal(rt.getSnapshot().active, false);
  const { snap } = await hostParty(rt);
  assert.equal(snap.active, true);
  assert.notEqual(rt.pushLocation({ lat: 1, lng: 2, ts: 1 }), null);
  await rt.destroy();
  assert.equal(rt.getSnapshot().active, false);
  assert.equal(rt.pushLocation({ lat: 1, lng: 2, ts: 1 }), null);
});

await check('pushLocation and pushBattery refuse empty input before they refuse anything else', async () => {
  const rt = runtime();
  await hostParty(rt);
  assert.equal(rt.pushLocation(null), null);
  assert.equal(rt.pushBattery(null), null);
  assert.equal(rt.pushBattery(0), null, 'a flat battery reads as absent');
});

/* --------------------------------------------------------- the snapshot - */

console.log('the snapshot and diagnostics');

await check('the snapshot carries the invite only once there is a key to put in it', async () => {
  const rt = runtime();
  const { snap } = await hostParty(rt);
  assert.ok(snap.invite?.startsWith('https://example.test/join#'));
  assert.ok(snap.keyString, 'the snapshot withheld the key the notification path needs');
  await rt.destroy();
  assert.equal(rt.getSnapshot().invite, null);
});

await check('an onState listener that throws does not take the party down', async () => {
  const rt = createPartyRuntime({
    onState: () => {
      throw new Error('bad listener');
    },
  });
  live.add(rt);
  const snap = await rt.createParty({ name: 'T', memberName: 'Ana' });
  await settle();
  assert.equal(snap.phase, 'live');
  assert.equal(rt.getSnapshot().hosting, true);
});

await check('stats() reports the role, the transport and the queue depth', async () => {
  const rt = runtime();
  await hostParty(rt);
  const s = rt.stats();
  assert.equal(s.role, 'host');
  assert.equal(s.phase, 'live');
  assert.equal(s.transport.active, 'offline', 'the test wire is not the offline queue');
  assert.ok(s.party, 'no party stats');
  assert.ok(Array.isArray(s.transport.probes) && s.transport.probes.length > 0);
  rt.setMeet({ lat: 1, lng: 2 });
  await settle();
  assert.ok(rt.stats().queued > 0, 'the outbox depth is not reported');
});

await check('a local-only party warns that the code will not resolve', async () => {
  const rt = runtime();
  await hostParty(rt);
  assert.ok(
    rt.seen.toasts.some((t) => /No server reachable/.test(t)),
    'the visitor was not told their code is dead',
  );
});

if (FAIL.length) {
  console.error(`party runtime tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`party runtime tests: ${PASS.length} passed`);
}
// Real heartbeat and election intervals belong to services this file has now
// destroyed, but Node keeps the loop alive for any that raced teardown.
process.exit(process.exitCode || 0);
