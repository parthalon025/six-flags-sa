#!/usr/bin/env node
/**
 * The host-migration PROTOCOL, in Node.
 *
 * WHAT THIS COVERS
 *   The wire protocol a migration is made of, driven through the shipped
 *   modules: lib/party/client.js, lib/party/hostService.js,
 *   lib/party/election.js and lib/core/state.js, over a fake wire
 *   (lib/partyBus.mjs) carrying real AES-GCM envelopes. The election and its
 *   claim window, WELCOME / VICTORY / CLAIM / BYE, snapshot adoption, the
 *   reducer's set-leader patch and the unscored-is-unbeatable rule are all
 *   real code. Mutation-checked: setting STEAL_STEPS = 0 at election.js:85
 *   fails three of the tests below.
 *
 * WHAT THIS DOES NOT COVER — read this before trusting the file
 *   partyRuntime.js's own copy of the migration wiring. `makePeer` below
 *   TRANSCRIBES `reconcile`, `startHost`, `startClient`, `promote` and
 *   `stepDown` out of partyRuntime.js. Nothing here imports that module and
 *   nothing here executes it, so all of the following is UNTESTED:
 *
 *     - the re-entrancy guards: `!client || host || destroyed`
 *       (partyRuntime.js:700) and `!host || destroyed` (:717) — a second
 *       promote arriving mid-migration, or either running after destroy()
 *     - the ordering inside `startHost` (:634-667): seed before start, join
 *       before set-leader, assert last, with openKeyWindow and persistSession
 *       alongside
 *     - the drop-then-stop ordering in `promote` (:702-703) and `stepDown`
 *       (:720-721), which is what stops a `change` fired during teardown
 *       reaching a service the runtime no longer owns
 *     - the version guard at :723-724 that picks which snapshot the demoted
 *       host hands to its new client
 *     - `emit()`, `persistSession()`, and the runtime's own `link.reselect()`
 *
 *   Mutation-checked the other way round: gutting the real `promote` and
 *   `stepDown` to a bare `return;` — which is deleting host migration from the
 *   product — leaves every test in this file and every test in
 *   party-runtime.test.mjs green.
 *
 * WHY IT IS LIKE THIS
 *   `buildTransports` (partyRuntime.js:523-533) constructs all five transports
 *   inline with no injection point, so the runtime cannot be started in Node
 *   without a network; and `promote` / `stepDown` / `reconcile` are private to
 *   the closure with no other way in. Opening that seam is the partyRuntime
 *   simplification follow-up. This file is tests-only and must not move the
 *   thing it measures, so it names the gap instead of closing it.
 *
 * WHEN A TITLE SAYS "TRANSCRIBED"
 *   The rule under assertion is one `makePeer` copied. The parts it drives —
 *   the client, the host service, the election, the reducer — are real, and a
 *   change to those still fails the test; a change to partyRuntime's own copy
 *   does not. `the transcribed wiring has not drifted from partyRuntime.js`
 *   at the foot of this file is what catches that, within the limits stated
 *   there.
 *
 *   The prior coverage this replaces is unchanged: test/app/functional.mjs
 *   :2149-2182, three real browsers and a 75s timeout, in the module that
 *   records at :956 and :1019 that it hangs in CI and locally (#194).
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const APP = '../../apps/party-tracker/';
const { createClient } = await import(`${APP}lib/party/client.js`);
const { createHostService } = await import(`${APP}lib/party/hostService.js`);
const { adoptSnapshot } = await import(`${APP}lib/core/state.js`);
const { readRank, shouldYield } = await import(`${APP}lib/party/election.js`);
const { open } = await import(`${APP}lib/core/crypto.js`);
const { BYE, CLAIM, PING, VICTORY, WELCOME } = await import(`${APP}lib/core/protocol.js`);
const { createBus, captureTimers, partyKey } = await import('./lib/partyBus.mjs');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

const HOST_TIMEOUT_MS = 12000;
const CLAIM_WINDOW_MS = 2500;

/**
 * One phone, wired the way partyRuntime wires one.
 *
 * `seedHost`, `assertHost`, `reconcile`, `startHost`, `startClient`, `promote`
 * and `stepDown` below are TRANSCRIPTIONS of the same-named functions in
 * partyRuntime.js — a copy, not the shipped code. Nothing that follows can
 * fail because partyRuntime changed; only `the transcribed wiring has not
 * drifted from partyRuntime.js` at the foot of this file can. Every function
 * cites the lines it stands in for, and TRANSCRIBED_FROM at the foot is the
 * list those citations have to stay true to.
 */
function makePeer({ id, name, bus, key, partyId, clock }) {
  const session = { selfId: id, partyId, memberName: name, partyName: 'Party', role: 'client', hostId: null };
  const link = bus.link(id);
  const peer = { id, session, link, host: null, client: null, events: [] };
  const now = () => clock.at;

  const service = () => peer.host || peer.client || null;
  bus.attach(id, (sealed) => service()?.handleSealed?.(sealed));

  /** partyRuntime.js:558-570 — the host service offers no seam for an existing party. */
  function seedHost(svc, snapshot) {
    const state = svc.getState();
    Object.assign(state, adoptSnapshot(state, snapshot));
  }

  /**
   * partyRuntime.js:572-581. The floor between unprompted re-assertions.
   *
   * Load-bearing, and not obviously so: two hosts that will not stand down for
   * each other (see BUG #split-brain) answer each other's VICTORY forever. This
   * throttle is the only thing turning that infinite loop into a 1.5s beacon
   * war. Reproduced faithfully because a harness without it hangs.
   */
  const ASSERT_GAP_MS = 1500;
  let lastAssertAt = 0;
  function assertHost() {
    const at = now();
    if (at - lastAssertAt < ASSERT_GAP_MS) return;
    lastAssertAt = at;
    peer.host?.assert();
  }

  /** partyRuntime.js:598-627. */
  function reconcile(frame) {
    if (!peer.host || !frame?.from || frame.from === session.selfId) return;
    if (frame.kind !== CLAIM && frame.kind !== VICTORY && frame.kind !== PING) return;
    if (frame.kind === CLAIM) {
      assertHost();
      return;
    }
    const mine = peer.host.rank();
    if (!mine) {
      stepDown(frame.from, frame.body?.snapshot ?? null);
      return;
    }
    // partyRuntime.js:619 — unscored is unbeatable. Duplicated at election.js:400.
    const theirs = readRank(frame, { score: Infinity, joinOrder: -1 });
    if (shouldYield({ ...mine, id: session.selfId }, theirs)) {
      stepDown(theirs.id, frame.body?.snapshot ?? null);
      return;
    }
    assertHost();
  }

  /** partyRuntime.js:634-667. */
  function startHost(snapshot, rank = null) {
    session.role = 'host';
    session.hostId = session.selfId;
    peer.host = createHostService({
      session,
      key,
      transport: link,
      rank,
      now,
      setIntervalFn: () => 0,
      clearIntervalFn: () => {},
    });
    const adopted = snapshot && Number.isFinite(snapshot.version) && snapshot.version > 0;
    if (adopted) seedHost(peer.host, snapshot);
    peer.host.on('change', () => peer.events.push('host-change'));
    peer.host.on('election', reconcile);
    peer.host.start();
    if (adopted) {
      if (!peer.host.getState().members[session.selfId]) {
        peer.host.applyLocal({
          kind: 'join',
          from: session.selfId,
          body: { name: session.memberName || 'Guest', userId: null },
        });
      }
      peer.host.applyLocal({ kind: 'set-leader', body: { leader: session.selfId } });
      peer.host.assert();
    }
  }

  /** partyRuntime.js:671-694. */
  function startClient(snapshot = null) {
    session.role = 'client';
    peer.client = createClient({ session, key, transport: link, snapshot, now });
    peer.client.on('change', (state) => {
      if (state?.leader && state.leader !== session.hostId) session.hostId = state.leader;
    });
    peer.client.on('host-lost', () => {
      peer.events.push('host-lost');
      link.reselect();
    });
    peer.client.on('promote', ({ snapshot: snap, score, joinOrder }) =>
      promote(snap, { score, joinOrder }),
    );
    peer.client.start();
  }

  /** partyRuntime.js:699-706. */
  function promote(snapshot, rank = null) {
    if (!peer.client || peer.host) return;
    peer.events.push('promote');
    const leaving = peer.client;
    peer.client = null;
    leaving.stop(); // posts a BYE addressed to the host that just vanished
    startHost(snapshot, rank);
  }

  /** partyRuntime.js:716-727. */
  function stepDown(newHostId, snapshot = null) {
    if (!peer.host) return;
    peer.events.push('step-down');
    const leaving = peer.host;
    const held = leaving.getState();
    peer.host = null;
    leaving.stop();
    session.hostId = newHostId;
    const better =
      snapshot && Number(snapshot.version) >= Number(held?.version ?? -1) ? snapshot : held;
    startClient(better || null);
  }

  return Object.assign(peer, { startHost, startClient, promote, stepDown, service });
}

/** A party with one host and N clients, all joined and adopted. */
async function makeParty({ clients = 2 } = {}) {
  const key = await partyKey();
  const partyId = 'party-test';
  const clock = { at: 1_000_000 };
  const bus = createBus();
  const timers = captureTimers();

  const hostPeer = makePeer({ id: 'phone-a', name: 'Ana', bus, key, partyId, clock });
  hostPeer.startHost(null);

  const clientPeers = [];
  for (let i = 0; i < clients; i += 1) {
    const p = makePeer({ id: `phone-${'bcd'[i]}`, name: `Guest${i}`, bus, key, partyId, clock });
    p.startClient();
    clientPeers.push(p);
    await bus.settle();
  }
  await bus.settle();

  return {
    key,
    partyId,
    clock,
    bus,
    timers,
    host: hostPeer,
    clients: clientPeers,
    all: [hostPeer, ...clientPeers],
    /** One wall-clock tick of every live election watcher. */
    async tick(times = 1) {
      for (let i = 0; i < times; i += 1) {
        timers.tick();
        await bus.settle();
      }
    },
    async teardown() {
      for (const p of [hostPeer, ...clientPeers]) {
        p.host?.stop();
        p.client?.stop();
      }
      timers.restore();
    },
  };
}

/** Read every frame a peer put on the wire. */
async function framesFrom(party, id) {
  const out = [];
  for (const { from, sealed } of party.bus.wire) {
    if (from !== id) continue;
    const f = await open(party.key, sealed);
    if (f) out.push(f);
  }
  return out;
}

/* ------------------------------------------------------------ the party -- */

console.log('a party forms — real client, real host service');

await check('clients join, adopt the roster, and agree who the leader is', async () => {
  const party = await makeParty({ clients: 2 });
  try {
    const hostState = party.host.host.getState();
    assert.equal(Object.keys(hostState.members).length, 3, 'the roster is not everybody');
    assert.equal(hostState.leader, 'phone-a');
    for (const c of party.clients) {
      const s = c.client.getState();
      assert.equal(s.leader, 'phone-a', `${c.id} names the wrong leader`);
      assert.equal(Object.keys(s.members).length, 3, `${c.id} has a partial roster`);
      assert.equal(s.version, hostState.version, `${c.id} is out of step`);
    }
  } finally {
    await party.teardown();
  }
});

await check('a joiner is welcomed with the snapshot, not left to resync for it', async () => {
  const party = await makeParty({ clients: 1 });
  try {
    const sent = await framesFrom(party, 'phone-a');
    const welcome = sent.find((f) => f.kind === WELCOME);
    assert.ok(welcome, 'no WELCOME reached the joiner');
    assert.equal(welcome.to, 'phone-b');
    assert.ok(welcome.body?.snapshot?.members, 'the WELCOME carried no roster');
  } finally {
    await party.teardown();
  }
});

/* --------------------------------------------------------- host walks off */

console.log('the host walks off — real election, transcribed wiring');

await check('TRANSCRIBED: host-lost is raised, and the wiring reselects before campaigning', async () => {
  // partyRuntime.js:683-688 — the path that was chosen to reach the host is
  // the thing that just went. Choose again before the claim goes out.
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    const before = party.clients[0].link.state.reselects;
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();

    const b = party.clients[0];
    assert.ok(b.events.includes('host-lost'), 'nobody noticed the host had gone');
    assert.ok(b.link.state.reselects > before, 'campaigned down the dead channel');
  } finally {
    await party.teardown();
  }
});

await check('the election settles on exactly one winner, and it is the one the order names', async () => {
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    const hosts = party.clients.filter((p) => p.host);
    assert.equal(hosts.length, 1, `promoted: ${party.clients.filter((p) => p.host).map((p) => p.id)}`);
    // Every client scores identically in Node (no navigator, no battery), so
    // the total order falls through to joinOrder: the earlier joiner wins.
    assert.equal(hosts[0].id, 'phone-b');
    assert.equal(party.clients[1].host, null);
    assert.equal(party.clients[1].client.getState().leader, 'phone-b', 'the loser disagrees');
  } finally {
    await party.teardown();
  }
});

await check('the party id, the roster and the version survive the hand-over', async () => {
  const party = await makeParty({ clients: 2 });
  try {
    // Something to lose: a meet-up point set before the host vanished.
    party.host.host.applyLocal({ kind: 'set-meet', from: 'phone-a', body: { meet: { lat: 1, lng: 2 } } });
    await party.bus.settle();
    const before = party.clients[0].client.getState();
    assert.ok(before.meet, 'test setup: the meet never reached the client');

    party.bus.partition('phone-a');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    const promoted = party.clients.find((p) => p.host);
    const after = promoted.host.getState();
    assert.equal(after.id, party.partyId, 'the party id changed under the visitor');
    assert.deepEqual(after.meet, before.meet, 'the meet-up was lost in the migration');
    assert.equal(Object.keys(after.members).length, 3, 'the roster blinked');
    assert.ok(after.version > before.version, 'the new host did not move the party forward');
  } finally {
    await party.teardown();
  }
});

await check('leadership lands as a patch at exactly version + 1', async () => {
  // partyRuntime.js:647-664 — the replica is adopted verbatim, old leader and
  // all, so taking leadership goes through the reducer. Every other replica
  // applies it without a resync and without ever seeing an empty roster.
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    const adoptedVersion = party.clients[0].client.getState().version;
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    const promoted = party.clients.find((p) => p.host);
    const state = promoted.host.getState();
    assert.equal(state.leader, promoted.id);
    assert.equal(
      state.version,
      adoptedVersion + 1,
      'set-leader did not land at exactly one past the adopted version',
    );
  } finally {
    await party.teardown();
  }
});

await check('the new host announces itself with VICTORY, carrying its snapshot and rank', async () => {
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    const promoted = party.clients.find((p) => p.host);
    const sent = await framesFrom(party, promoted.id);
    const victory = sent.filter((f) => f.kind === VICTORY);
    assert.ok(victory.length >= 1, 'the new host never said it was hosting');
    const last = victory[victory.length - 1];
    assert.ok(last.body?.snapshot?.members, 'VICTORY carried no snapshot to repair peers with');
    assert.ok(Number.isFinite(last.body.score), 'VICTORY carried no rank to be compared on');
    assert.ok(Number.isFinite(last.body.joinOrder));
    assert.equal(last.body.snapshot.leader, promoted.id);
  } finally {
    await party.teardown();
  }
});

await check('CHARACTERISED: client.stop() posts a BYE to the host that just vanished', async () => {
  // client.stop() posts BYE unconditionally to toHost() (client.js:397), and
  // promote() calls stop() (partyRuntime.js:703). The addressee is the host
  // that has just been declared gone, so the frame is delivered to peers and
  // accepted by none. Harmless today — BYE is a host-only command and the
  // other clients drop it — but it is a frame sent into a locker, and the
  // `leave()` path deliberately broadcasts instead (client.js:388-397).
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    const promoted = party.clients.find((p) => p.host);
    const sent = await framesFrom(party, promoted.id);
    const bye = sent.find((f) => f.kind === BYE);
    assert.ok(bye, 'behaviour changed: promote() no longer posts a BYE');
    assert.notEqual(bye.to, '*', 'behaviour changed: the BYE is broadcast now');
    // The loser must not have acted on it — it is still on the new roster.
    const loser = party.clients.find((p) => !p.host);
    assert.ok(
      promoted.host.getState().members[loser.id],
      'the stray BYE removed a member who never left',
    );
  } finally {
    await party.teardown();
  }
});

await check('the loser follows the winner without ever seeing an empty roster', async () => {
  const party = await makeParty({ clients: 2 });
  try {
    const loserSeen = [];
    party.clients[1].client.on('change', (s) => loserSeen.push(Object.keys(s.members).length));
    party.bus.partition('phone-a');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    assert.ok(loserSeen.length > 0, 'the loser saw no updates at all');
    assert.ok(!loserSeen.includes(0), `the roster blinked empty: ${loserSeen.join(',')}`);
    assert.equal(party.clients[1].client.getState().leader, 'phone-b');
  } finally {
    await party.teardown();
  }
});

/* ------------------------------------------------------------ split brain */

console.log('two hosts — real election');

await check('BUG #split-brain: two phones that promote at once BOTH keep hosting', async () => {
  // The claim windows overlap but the transport underneath is repairing
  // itself, so neither hears the other in time (partyRuntime.js:583-597). The
  // block says this "is survivable only if the pair can settle it afterwards
  // without a human", and :624-626 claims "the total order admits exactly one
  // winner, so this cannot ping-pong".
  //
  // It cannot ping-pong. It also never resolves. `reconcile` stands a host
  // down only on `shouldYield`, which demands a margin of STEAL_STEPS battery
  // steps (5e10); the tiebreak tiers of `outranks` that actually separate two
  // otherwise-identical phones — join order and id — are worth at most 1. So
  // `outranks` names a winner that `shouldYield` will never ratify, and both
  // phones assert at each other for the rest of the trip.
  //
  // Pinned as OBSERVED, not endorsed. See the PR body.
  const party = await makeParty({ clients: 2 });
  try {
    party.bus.partition('phone-a');
    // Cut the two clients off from each other as well, so both win their own
    // election: this is the simultaneous promotion, written down.
    party.bus.partition('phone-b');
    party.bus.partition('phone-c');
    party.clock.at += HOST_TIMEOUT_MS + 1;
    await party.tick();
    party.clock.at += CLAIM_WINDOW_MS + 1;
    await party.tick();

    assert.ok(party.clients[0].host, 'phone-b did not promote in isolation');
    assert.ok(party.clients[1].host, 'phone-c did not promote in isolation');

    // The radio comes back. Each hears the other beacon, repeatedly.
    party.bus.heal('phone-b');
    party.bus.heal('phone-c');
    for (let i = 0; i < 3; i += 1) {
      party.clock.at += 2000; // past ASSERT_GAP_MS, so each round really beacons
      party.clients[0].host?.assert();
      party.clients[1].host?.assert();
      await party.bus.settle();
    }

    const stillHosting = party.clients.filter((p) => p.host);
    assert.equal(
      stillHosting.length,
      2,
      'behaviour changed — the split brain resolves now, check the follow-up fix',
    );
    assert.ok(!party.clients[0].events.includes('step-down'));
    assert.ok(!party.clients[1].events.includes('step-down'));
  } finally {
    await party.teardown();
  }
});

await check('BUG #split-brain: the order names a winner that the margin refuses to ratify', async () => {
  // The arithmetic behind the test above, isolated. Two candidates identical
  // but for join order: `outranks` separates them, `shouldYield` does not.
  const { scoreCandidate, outranks, STEAL_STEPS } = await import(`${APP}lib/party/election.js`);
  const shared = { battery: 0.8, signal: 0.5, network: 1, performance: 0.5 };
  const first = { id: 'phone-b', score: scoreCandidate({ ...shared, joinOrder: 1 }), joinOrder: 1 };
  const second = { id: 'phone-c', score: scoreCandidate({ ...shared, joinOrder: 2 }), joinOrder: 2 };

  assert.equal(outranks(first, second), true, 'the total order no longer names a winner');
  assert.equal(outranks(second, first), false);
  // ...and yet neither will stand down for the other.
  assert.equal(shouldYield(second, first), false, 'behaviour changed — the loser yields now');
  assert.equal(shouldYield(first, second), false);
  // Because the gap the tiebreak can produce is ~1 and the margin wanted is 5e10.
  assert.ok(first.score - second.score < 1);
  assert.ok(STEAL_STEPS * (1e12 / 100) > 1e10);
});

await check('the election margin DOES resolve a split brain once the battery gap clears it', async () => {
  // The path that works, pinned so the follow-up keeps it. A phone six battery
  // steps better than the incumbent takes the party, and the loser stands down
  // within one assert.
  const party = await makeParty({ clients: 2 });
  try {
    const { scoreCandidate } = await import(`${APP}lib/party/election.js`);
    const weak = party.clients[0];
    const strong = party.clients[1];
    const base = { signal: 0.5, network: 1, performance: 0.5 };

    party.bus.partition('phone-a');
    weak.promote(weak.client.getState(), {
      score: scoreCandidate({ ...base, battery: 0.5, joinOrder: 1 }),
      joinOrder: 1,
    });
    strong.promote(strong.client.getState(), {
      score: scoreCandidate({ ...base, battery: 0.9, joinOrder: 2 }),
      joinOrder: 2,
    });
    await party.bus.settle();

    strong.host?.assert();
    await party.bus.settle();

    assert.equal(weak.host, null, 'the flatter phone kept hosting');
    assert.ok(weak.events.includes('step-down'));
    assert.ok(strong.host, 'the better phone stood down instead');
    assert.equal(weak.session.hostId, strong.id);
    assert.equal(weak.client.getState().leader, strong.id);
  } finally {
    await party.teardown();
  }
});

await check('TRANSCRIBED: a host with no claim of its own yields to any peer that says it is serving', async () => {
  // The phone that started the party has no rank to compare and does not need
  // one (partyRuntime.js:611-615).
  const party = await makeParty({ clients: 1 });
  try {
    assert.equal(party.host.host.rank(), null, 'the founding host carries a claim');
    const rival = party.clients[0];
    // The rival promotes itself while the founder is still serving.
    rival.promote(rival.client.getState(), { score: 1, joinOrder: 9 });
    await party.bus.settle();

    assert.equal(party.host.host, null, 'the unscored founder refused to stand down');
    assert.ok(party.host.events.includes('step-down'));
    assert.equal(party.host.session.hostId, rival.id);
  } finally {
    await party.teardown();
  }
});

await check('TRANSCRIBED: the hand-over keeps whichever snapshot has the higher version', async () => {
  // partyRuntime.js:723-724. The roster on screen must not blink while the new
  // host's WELCOME is in flight, so the better of the two pictures is handed on.
  const party = await makeParty({ clients: 1 });
  try {
    const founder = party.host;
    const held = founder.host.getState();
    // A snapshot from behind must be refused in favour of what we hold.
    founder.stepDown('phone-z', { ...held, version: held.version - 5, meet: { lat: 9, lng: 9 } });
    await party.bus.settle();
    assert.equal(founder.host, null);
    assert.equal(founder.client.getState().version, held.version, 'adopted a stale snapshot');
    assert.equal(founder.client.getState().meet, held.meet);
  } finally {
    await party.teardown();
  }
});

await check('TRANSCRIBED: the hand-over takes the offered snapshot when it is ahead', async () => {
  const party = await makeParty({ clients: 1 });
  try {
    const founder = party.host;
    const held = founder.host.getState();
    const ahead = { ...held, version: held.version + 3, meet: { lat: 7, lng: 7 } };
    founder.stepDown('phone-z', ahead);
    await party.bus.settle();
    assert.equal(founder.client.getState().version, held.version + 3);
    assert.deepEqual(founder.client.getState().meet, { lat: 7, lng: 7 });
  } finally {
    await party.teardown();
  }
});

await check('TRANSCRIBED: a CLAIM against a live host is answered, never yielded to', async () => {
  // partyRuntime.js:604-609 — a claim is a peer that has not decided yet.
  const party = await makeParty({ clients: 1 });
  try {
    const founder = party.host;
    const before = (await framesFrom(party, 'phone-a')).filter((f) => f.kind === VICTORY).length;
    founder.host.handleSealed(
      await (async () => {
        const { seal } = await import(`${APP}lib/core/crypto.js`);
        return seal(party.key, party.partyId, {
          v: 1,
          seq: 99,
          kind: CLAIM,
          from: 'phone-b',
          to: '*',
          body: { score: 9e9, joinOrder: 0 },
          ts: party.clock.at,
        });
      })(),
    );
    await party.bus.settle();
    assert.ok(founder.host, 'stood down to a peer that was only campaigning');
    const after = (await framesFrom(party, 'phone-a')).filter((f) => f.kind === VICTORY).length;
    assert.ok(after > before, 'the host did not answer the claim');
  } finally {
    await party.teardown();
  }
});

/* --------------------------------------------------- the duplicated rule -- */

console.log('the unscored-is-unbeatable rule');

await check('an unscored rival outranks any real claim, both places it is written', async () => {
  const unscored = readRank({ from: 'phone-z', body: {} }, { score: Infinity, joinOrder: -1 });
  assert.equal(unscored.score, Infinity);
  assert.equal(unscored.joinOrder, -1);
  // One host too few repairs itself in a timeout; one host too many never does.
  assert.equal(shouldYield({ id: 'me', score: 9e9, joinOrder: 0 }, unscored), true);
  // A rival that does say what it won on is compared on the numbers.
  const scored = readRank({ from: 'phone-z', body: { score: 1, joinOrder: 5 } }, { score: Infinity, joinOrder: -1 });
  assert.equal(shouldYield({ id: 'me', score: 9e9, joinOrder: 0 }, scored), false);
});

await check('the rule is still written out in both files, and identically', async () => {
  // election.js:400 and partyRuntime.js:619 hold the same literal with no
  // shared constant between them. Pinned so the follow-up cannot change one
  // and leave the other — the failure mode is two hosts, which never repairs.
  const { readFile } = await import('node:fs/promises');
  const files = ['lib/party/election.js', 'lib/partyRuntime.js'];
  const pattern = /readRank\(\s*f(?:rame)?\s*,\s*\{\s*score:\s*Infinity\s*,\s*joinOrder:\s*-1\s*\}\s*\)/;
  for (const rel of files) {
    const src = await readFile(new URL(`${APP}${rel}`, import.meta.url), 'utf8');
    assert.match(src, pattern, `${rel} no longer carries the unscored-is-unbeatable default`);
  }
});

/* ------------------------------------------- the documented path that is dead */

console.log('the two migration-adoption paths');

await check('nothing in the repo ever sets session.snapshot', async () => {
  // hostService.js:114-136 reads `session.snapshot` behind a shape guard and
  // adopts it. It is the documented migration path and it is dead: the live
  // one is partyRuntime.js:640 (seedHost) plus :660 (set-leader). Confirmed by
  // grep and pinned here. Delete neither — report only.
  const { readFile, readdir } = await import('node:fs/promises');
  const roots = ['apps', 'packages', 'test', 'scripts'];
  const hits = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!/\.(js|mjs|jsx)$/.test(entry.name)) continue;
      const src = await readFile(full, 'utf8');
      // An assignment to a `snapshot` property on a session-shaped object.
      if (/session\s*\.\s*snapshot\s*=/.test(src)) hits.push(full);
      if (/createSession\(\{[^}]*\bsnapshot\b/s.test(src)) hits.push(full);
    }
  };
  const base = new URL('../../', import.meta.url).pathname;
  for (const r of roots) await walk(`${base}${r}`);
  assert.deepEqual(hits, [], `session.snapshot is written now — the dead path woke up: ${hits}`);
});

await check('the dead path still works if anything ever does set it', async () => {
  // Not endorsement — it is a second way to do the one thing, and the follow-up
  // should delete one of them. Pinned so whichever survives is known to work.
  const key = await partyKey();
  const bus = createBus();
  const held = {
    id: 'party-test',
    name: 'Party',
    leader: 'phone-a',
    createdAt: 1,
    version: 7,
    members: { 'phone-a': { id: 'phone-a', name: 'Ana', joinOrder: 0, lastSeen: 1 } },
    rides: {},
    meet: { lat: 3, lng: 4 },
    plan: [],
    settings: {},
  };
  const svc = createHostService({
    session: { selfId: 'phone-b', partyId: 'party-test', memberName: 'Ben', snapshot: held },
    key,
    transport: bus.link('phone-b'),
    now: () => 2,
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
  });
  const state = svc.getState();
  assert.deepEqual(state.meet, { lat: 3, lng: 4 }, 'the documented path lost the meet-up');
  assert.equal(state.leader, 'phone-b');
  assert.ok(state.version > 7, 'the documented path did not move the version forward');
  assert.ok(state.members['phone-a'], 'the documented path lost the old roster');
});

/* ------------------------------------------------------ the transcription -- */

console.log('the transcription');

/**
 * Every function `makePeer` copies, the lines it stands in for, and a digest of
 * the real source as it read when this file was written.
 *
 * WHAT THIS CATCHES: any change to the body of one of these functions, and any
 * rename or deletion of one. That is the failure this file is otherwise wide
 * open to — the copy quietly describing a partyRuntime that no longer exists,
 * with 20 green tests on top of it.
 *
 * WHAT IT CANNOT DO, and this matters: it cannot tell you the copy is still
 * EQUIVALENT to the original. It compares the original against its own past
 * self, not against the transcription. A green run means "partyRuntime has not
 * moved", never "the harness is faithful" — only reading both does that.
 *
 * The comparison is normalised: comments and whitespace are stripped, so
 * re-wrapping a comment does not trip it. A local variable renamed DOES trip
 * it, and that is the trade taken deliberately — a false alarm costs one
 * re-read of two functions, and a missed change costs the whole claim.
 *
 * TO UPDATE A DIGEST: re-read the transcription above against the new source,
 * change it where it has to change, and only then paste in the digest the
 * failure message prints. Pasting the digest first is how this becomes
 * decoration.
 */
const TRANSCRIBED_FROM = [
  ['seedHost', 'partyRuntime.js:558-570', '4fb69935fdef7959'],
  ['assertHost', 'partyRuntime.js:572-581', '57882eace55375dd'],
  ['reconcile', 'partyRuntime.js:598-627', 'dde630159493ea42'],
  ['startHost', 'partyRuntime.js:634-667', '2d2b03a6f4145427'],
  ['startClient', 'partyRuntime.js:671-694', 'b0bcc3e55e2e5818'],
  ['promote', 'partyRuntime.js:699-706', '4416f5d52f62c8c0'],
  ['stepDown', 'partyRuntime.js:716-727', '527dccc95dc010ea'],
];

/**
 * The source of one `function NAME(...) { ... }`, comments dropped and runs of
 * whitespace collapsed to one space.
 *
 * Scanned character by character rather than matched with a regex: a brace
 * inside a string or a comment would otherwise end the body early and hand
 * back a digest of half a function, which would still be stable and would
 * still catch nothing beyond the half it saw.
 */
function normalisedSource(src, name) {
  const start = src.search(new RegExp(`\\bfunction\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  let i = src.indexOf('{', start);
  if (i < 0) return null;
  const out = [src.slice(start, i)];
  let depth = 0;
  for (; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out.push(' ');
      continue;
    }
    if (c === '/' && next === '*') {
      i = src.indexOf('*/', i + 2) + 1;
      out.push(' ');
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out.push(src.slice(i, j + 1));
      i = j;
      continue;
    }
    out.push(c);
    if (c === '{') depth += 1;
    else if (c === '}' && (depth -= 1) === 0) break;
  }
  if (depth !== 0) return null;
  return out.join('').replace(/\s+/g, ' ').trim();
}

await check('the transcribed wiring has not drifted from partyRuntime.js', async () => {
  const { readFile } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const src = await readFile(new URL(`${APP}lib/partyRuntime.js`, import.meta.url), 'utf8');

  const drifted = [];
  for (const [name, where, expected] of TRANSCRIBED_FROM) {
    const body = normalisedSource(src, name);
    if (!body) {
      drifted.push(`${name} (${where}) is gone or no longer a function declaration`);
      continue;
    }
    const actual = createHash('sha256').update(body).digest('hex').slice(0, 16);
    if (actual !== expected) drifted.push(`${name} (${where}) ${expected} -> ${actual}`);
  }
  assert.deepEqual(
    drifted,
    [],
    `partyRuntime moved under the transcription in makePeer. Re-read the copy against the new source, fix it, then update the digest:\n  ${drifted.join('\n  ')}`,
  );
});

/** The extractor has to be able to fail, or the guard above cannot. */
await check('the drift check reads a whole function, not a prefix of one', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL(`${APP}lib/partyRuntime.js`, import.meta.url), 'utf8');

  const stepDown = normalisedSource(src, 'stepDown');
  assert.ok(stepDown.startsWith('function stepDown('), 'the extractor lost the signature');
  assert.ok(stepDown.endsWith('}'), 'the extractor stopped before the closing brace');
  assert.ok(stepDown.includes('startClient('), 'the extractor stopped before the last statement');
  assert.equal(stepDown.includes('//'), false, 'comments survived the normalisation');
  assert.equal(normalisedSource(src, 'noSuchFunctionAnywhere'), null);
  // A brace inside a string must not end a body early: the outbox key at
  // partyRuntime.js:525 is inside a template literal in buildTransports.
  const build = normalisedSource(src, 'buildTransports');
  assert.ok(build.endsWith('];\n }'.replace(/\s+/g, ' ')) || build.endsWith('}'));
  assert.ok(build.includes('outbox,'), 'a quoted brace truncated the body');
});

if (FAIL.length) {
  console.error(`party protocol tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`party protocol tests: ${PASS.length} passed`);
}
