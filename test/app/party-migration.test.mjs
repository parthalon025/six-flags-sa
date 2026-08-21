#!/usr/bin/env node
/**
 * Host migration, end to end, in Node.
 *
 * The sequence that keeps a party alive when the host walks off had exactly
 * one test before this file: test/app/functional.mjs:2149-2182, three real
 * browsers and a 75s timeout, in the module that same file records at :956 and
 * :1019 as hanging in CI and locally (#194). So the single test protecting
 * migration was the one known not to run.
 *
 * This drives the real client, the real host service and the real election
 * over a fake wire (lib/partyBus.mjs) with real AES-GCM envelopes. The
 * promote/stepDown/reconcile wiring is reproduced here from partyRuntime.js
 * because that module builds its own transport stack with no seam to replace
 * it — see `buildTransports` (partyRuntime.js:519-532) and the PR body.
 * Every step below cites the line it stands in for.
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
 * One phone, wired exactly as partyRuntime wires one.
 *
 * The bodies of `promote`, `startHost` and `stepDown` are transcriptions of
 * partyRuntime.js:697-728 and :636-668. If the follow-up reshapes those, this
 * harness is the thing that has to be reshaped with them — which is the point.
 */
function makePeer({ id, name, bus, key, partyId, clock }) {
  const session = { selfId: id, partyId, memberName: name, partyName: 'Party', role: 'client', hostId: null };
  const link = bus.link(id);
  const peer = { id, session, link, host: null, client: null, events: [] };
  const now = () => clock.at;

  const service = () => peer.host || peer.client || null;
  bus.attach(id, (sealed) => service()?.handleSealed?.(sealed));

  /** partyRuntime.js:557-568 — the host service offers no seam for an existing party. */
  function seedHost(svc, snapshot) {
    const state = svc.getState();
    Object.assign(state, adoptSnapshot(state, snapshot));
  }

  /**
   * partyRuntime.js:576-580. The floor between unprompted re-assertions.
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

  /** partyRuntime.js:600-630. */
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

  /** partyRuntime.js:636-668. */
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

  /** partyRuntime.js:672-693. */
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

  /** partyRuntime.js:697-706. */
  function promote(snapshot, rank = null) {
    if (!peer.client || peer.host) return;
    peer.events.push('promote');
    const leaving = peer.client;
    peer.client = null;
    leaving.stop(); // posts a BYE addressed to the host that just vanished
    startHost(snapshot, rank);
  }

  /** partyRuntime.js:715-728. */
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

console.log('a party forms');

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

console.log('the host walks off');

await check('losing the host is noticed, and reselects the transport before campaigning', async () => {
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

await check('exactly one client promotes, and it is the one the order names', async () => {
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

await check('the party id, the roster and the version survive the swap', async () => {
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
  // partyRuntime.js:653-662 — the replica is adopted verbatim, old leader and
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

await check('CHARACTERISED: the promoted client posts a BYE to the host that just vanished', async () => {
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

console.log('two hosts');

await check('BUG #split-brain: two phones that promote at once BOTH keep hosting', async () => {
  // The claim windows overlap but the transport underneath is repairing
  // itself, so neither hears the other in time (partyRuntime.js:583-598). The
  // block says this "is survivable only if the pair can settle it afterwards
  // without a human", and :626-628 claims "the total order admits exactly one
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

await check('a split brain DOES resolve once the battery gap clears the margin', async () => {
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

await check('a host with no claim of its own yields to any peer that says it is serving', async () => {
  // The phone that started the party has no rank to compare and does not need
  // one (partyRuntime.js:611-614).
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

await check('stepDown keeps whichever snapshot has the higher version', async () => {
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

await check('stepDown takes the offered snapshot when it is ahead', async () => {
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

await check('a CLAIM against a live host is answered, never yielded to', async () => {
  // partyRuntime.js:606-610 — a claim is a peer that has not decided yet.
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

if (FAIL.length) {
  console.error(`party migration tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`party migration tests: ${PASS.length} passed`);
}
