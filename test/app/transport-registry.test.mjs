#!/usr/bin/env node
/**
 * lib/transport/registry.js, driven with fake transports.
 *
 * The module's own header (registry.js:4-6) says it carries no browser API so
 * that "the Node tests can drive it with fake transports and get exactly the
 * behaviour a phone gets". Until now nothing walked through that door: 505
 * lines of selection, warmth, mirroring, failover and replay had no test that
 * imported them. This is that test.
 *
 * Everything here drives the real TransportManager and the real
 * `defineTransport`; only the transports' verbs are fakes. See
 * lib/fakeTransport.mjs for the contract gap those fakes have to paper over.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { TransportManager, createRegistry, createTransportManager } = await import(
  '../../apps/party-tracker/lib/transport/registry.js'
);
const { RANK, STATUS } = await import('../../apps/party-tracker/lib/transport/types.js');
const { createOfflineQueue } = await import('../../apps/party-tracker/lib/transport/offlineQueue.js');
const { fakeTransport, fakeOfflineQueue, fakeClock } = await import('./lib/fakeTransport.mjs');

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

/** Let the manager's deliberately un-awaited background work settle. */
const settle = async (turns = 4) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const lan = (o) => fakeTransport({ name: 'lan', rank: RANK.LOCAL_HTTP, ...o });
const rtc = (o) => fakeTransport({ name: 'webrtc', rank: RANK.WEBRTC, standby: true, carries: false, ...o });
const relay = (o) => fakeTransport({ name: 'relay', rank: RANK.CLOUD_RELAY, ...o });

const manager = (transports, extra = {}) =>
  createTransportManager({ session: { role: 'client' }, transports, ...extra });

/* ------------------------------------------------------------- registry -- */

console.log('registry');

await check('registry lists ascending by rank, whatever order it was fed', () => {
  const reg = createRegistry();
  reg.register(relay());
  reg.register(lan());
  reg.register(rtc());
  assert.deepEqual(
    reg.list().map((t) => t.name),
    ['lan', 'webrtc', 'relay'],
  );
  assert.equal(reg.get('lan').rank, RANK.LOCAL_HTTP);
  assert.equal(reg.get('nope'), null);
});

await check('a transport with no name is refused outright', () => {
  const reg = createRegistry();
  assert.throws(() => reg.register({ rank: 1 }), /needs a name/);
  assert.throws(() => reg.register(null), /needs a name/);
});

await check('registering the same name twice replaces rather than duplicates', () => {
  const reg = createRegistry();
  reg.register(lan());
  reg.register(lan({ rank: RANK.CLOUD_RELAY }));
  assert.equal(reg.list().length, 1);
  assert.equal(reg.list()[0].rank, RANK.CLOUD_RELAY);
});

await check('the manager accepts an existing registry as well as an array', async () => {
  const reg = createRegistry();
  reg.register(lan());
  const mgr = new TransportManager({ transports: reg, session: { role: 'client' } });
  await mgr.connect();
  assert.equal(mgr.activeName(), 'lan');
  await mgr.close();
});

/* ------------------------------------------------------------ selection -- */

console.log('selection');

await check('selection takes the lowest rank that probes available', async () => {
  const a = lan();
  const b = relay();
  const mgr = manager([b, a]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'lan');
  assert.equal(a.log.opens, 1);
  assert.equal(b.log.opens, 0, 'opened a transport it never needed');
  await mgr.close();
});

await check('a transport that probes unavailable is never opened', async () => {
  const a = lan({ available: false, reason: 'no LAN' });
  const b = relay();
  const mgr = manager([a, b]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'relay');
  assert.equal(a.log.opens, 0);
  assert.equal(mgr.probeOf('lan').reason, 'no LAN');
  await mgr.close();
});

await check('a probe that throws is recorded as unavailable with its message', async () => {
  const a = lan();
  a.probe = async () => {
    throw new Error('boom');
  };
  const mgr = manager([a, relay()]);
  await mgr.connect();
  assert.equal(mgr.probeOf('lan').available, false);
  assert.equal(mgr.probeOf('lan').reason, 'boom');
  assert.equal(mgr.activeName(), 'relay');
  await mgr.close();
});

await check('an open that fails hands the turn to the next rank', async () => {
  const a = lan({ openFails: true });
  const b = relay();
  const mgr = manager([a, b]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'relay');
  assert.equal(a.status, STATUS.FAILED);
  assert.equal(b.log.opens, 1);
  await mgr.close();
});

await check('probes run in parallel — a dead LAN does not delay the relay', async () => {
  const a = lan({ probeDelayMs: 80, available: false });
  const b = relay({ probeDelayMs: 80 });
  const mgr = manager([a, b]);
  const started = Date.now();
  await mgr.connect();
  const elapsed = Date.now() - started;
  assert.equal(mgr.activeName(), 'relay');
  assert.ok(elapsed < 160, `probes serialised: ${elapsed}ms for two 80ms probes`);
  await mgr.close();
});

await check('the offline queue is the floor: nothing reachable is still a selection', async () => {
  const outbox = fakeOfflineQueue();
  const mgr = manager([lan({ available: false }), relay({ available: false }), outbox]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'offline');
  const result = await mgr.send('env-1');
  // Landing in the outbox is `queued`, not sent — registry.js:237.
  assert.deepEqual(result, { ok: false, via: 'offline', queued: true });
  assert.deepEqual(outbox.contents(), ['env-1']);
  await mgr.close();
});

await check('with no offline queue at all an envelope is dropped, and says so', async () => {
  const mgr = manager([lan({ sendFails: true })]);
  await mgr.connect();
  const result = await mgr.send('env-1');
  assert.deepEqual(result, { ok: false, queued: true, via: null });
  await mgr.close();
});

await check('connect() forgives past failures — a relay down at the gate gets another turn', async () => {
  const a = lan({ openFails: true });
  const mgr = manager([a, relay()]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'relay');
  a.knobs.openFails = false;
  a.announce(STATUS.IDLE);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'lan', 'connect() did not clear the failed set');
  await mgr.close();
});

/* --------------------------------------------------------------- warmth -- */

console.log('warmth');

await check('a client warms standby transports and nothing else', async () => {
  const direct = rtc();
  const mgr = manager([lan(), direct, relay()]);
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  assert.deepEqual(mgr.warmNames(), ['webrtc']);
  assert.equal(direct.log.opens, 1, 'standby was not held open behind the active path');
  await mgr.close();
});

await check('a host also warms the best mailbox, so a joiner HELLO is never missed', async () => {
  // The production shape: no LAN configured, so WebRTC (standby) takes the
  // send path and the cloud relay is the inbox a joiner can always reach.
  const direct = rtc({ carries: true });
  const cloud = relay();
  const mgr = manager([lan({ available: false }), direct, cloud], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  assert.deepEqual(mgr.warmNames(), ['relay'], 'the host has no mailbox a joiner can reach');
  await mgr.close();
});

await check('a host on LAN also warms the cloud mailbox for joiners on mobile data', async () => {
  // When both LAN and relay are available, the host sends over LAN but keeps
  // the relay warm so a joiner that can only reach the cloud is heard.
  const cloud = relay();
  const local = lan();
  const mgr = manager([local, cloud], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  assert.deepEqual(mgr.warmNames(), ['relay']);
  assert.equal(cloud.log.opens, 1);
  assert.deepEqual(
    mgr.desiredWarm().map((t) => t.name),
    ['relay'],
  );
  await mgr.close();
});

await check('a host opens the active transport only once', async () => {
  const local = lan();
  const mgr = manager([local, relay()], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  assert.equal(local.log.opens, 1);
  await mgr.close();
});

await check('a client never warms a mailbox — only the host needs an inbox', async () => {
  const cloud = relay();
  const mgr = manager([lan(), cloud], { session: { role: 'client' } });
  await mgr.connect();
  await settle();
  assert.deepEqual(mgr.warmNames(), []);
  assert.equal(cloud.log.opens, 0);
  await mgr.close();
});

await check('the host warms exactly one mailbox, the best available one', async () => {
  const second = fakeTransport({ name: 'bluetooth', rank: RANK.BLUETOOTH });
  const cloud = relay();
  const direct = rtc({ carries: true });
  const mgr = manager([lan({ available: false }), direct, second, cloud], {
    session: { role: 'host' },
  });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  assert.deepEqual(mgr.warmNames(), ['bluetooth'], 'warmed more than one inbox');
  assert.equal(cloud.log.opens, 0);
  await mgr.close();
});

await check('an unavailable transport is never warmed', async () => {
  const direct = rtc({ available: false });
  const mgr = manager([lan(), direct], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.deepEqual(mgr.warmNames(), []);
  assert.equal(direct.log.opens, 0);
  await mgr.close();
});

await check('a standby transport whose open has not finished stays warm, not failed', async () => {
  // WebRTC's open times out while ICE is still running — a slow success, not a
  // failure (registry.js:308-317). It must keep its subscriptions.
  const direct = rtc({ openFails: true });
  const mgr = manager([direct, relay()]);
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'relay');
  assert.ok(mgr.warmNames().includes('webrtc'), 'a still-negotiating standby was written off');
  assert.notEqual(direct.status, STATUS.CLOSED);
  await mgr.close();
});

await check('a non-standby transport whose open fails is closed and written off', async () => {
  const cloud = relay({ openFails: true });
  const outbox = fakeOfflineQueue();
  const mgr = manager([cloud, outbox], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(cloud.status, STATUS.FAILED);
  assert.equal(mgr.warmNames().includes('relay'), false);
  await mgr.close();
});

/* ------------------------------------------------------------ promotion -- */

console.log('promotion');

await check('a warm standby that can carry a frame takes the send path', async () => {
  const direct = rtc({ carries: false });
  const cloud = relay();
  const mgr = manager([direct, cloud]);
  direct.knobs.openFails = true; // no channel yet: warm, not active
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'relay');

  // The channel opens. READY on a warm standby is what invites promotion.
  direct.knobs.carries = true;
  direct.announce(STATUS.READY);
  await settle();
  assert.equal(mgr.activeName(), 'webrtc', 'a usable direct channel did not take over');
  await mgr.close();
});

await check('a warm standby that is READY but cannot carry stays warm', async () => {
  const direct = rtc({ carries: false, openFails: true });
  const mgr = manager([direct, relay()]);
  await mgr.connect();
  await settle();
  direct.announce(STATUS.READY); // carries() still false — no peer on the channel
  await settle();
  assert.equal(mgr.activeName(), 'relay', 'promoted a channel with nobody on it');
  assert.ok(mgr.warmNames().includes('webrtc'));
  await mgr.close();
});

await check('a warm transport never demotes a better-ranked active one', async () => {
  const direct = rtc({ carries: true, openFails: true });
  const mgr = manager([lan(), direct], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  direct.announce(STATUS.READY);
  await settle();
  assert.equal(mgr.activeName(), 'lan', 'a worse rank took the send path');
  await mgr.close();
});

await check('promotion keeps the old path warm when a host still wants it as an inbox', async () => {
  const direct = rtc({ carries: false, openFails: true });
  const cloud = relay();
  const mgr = manager([direct, cloud], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'relay');
  direct.knobs.carries = true;
  direct.announce(STATUS.READY);
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  assert.ok(mgr.warmNames().includes('relay'), 'the host lost its mailbox inbox on upgrade');
  assert.equal(cloud.log.closes, 0);
  await mgr.close();
});

await check('promotion closes the old path when a client has no use for it', async () => {
  const direct = rtc({ carries: false, openFails: true });
  const cloud = relay();
  const mgr = manager([direct, cloud], { session: { role: 'client' } });
  await mgr.connect();
  await settle();
  direct.knobs.carries = true;
  direct.announce(STATUS.READY);
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  assert.equal(cloud.log.closes, 1, 'a client kept paying for a relay it no longer needs');
  await mgr.close();
});

/* ------------------------------------------------------------ mirroring -- */

console.log('mirroring');

await check('a host mirrors broadcasts down a warm path a peer was just heard on', async () => {
  const clock = fakeClock();
  try {
    const direct = rtc({ carries: true });
    const cloud = relay();
    const mgr = manager([lan({ available: false }), direct, cloud], { session: { role: 'host' } });
    await mgr.connect();
    await settle();
    assert.equal(mgr.activeName(), 'webrtc');
    assert.ok(mgr.warmNames().includes('relay'));

    // Nobody heard from yet: no mirror.
    await mgr.send('env-1');
    await settle();
    assert.deepEqual(cloud.log.sent, []);

    // A peer says something on the relay. Now the host answers down it too.
    cloud.receive('inbound');
    await mgr.send('env-2');
    await settle();
    assert.deepEqual(cloud.log.sent, ['env-2'], 'the mixed party lost its relay half');
    await mgr.close();
  } finally {
    clock.restore();
  }
});

await check('mirroring lapses 30s after the last peer was heard', async () => {
  const clock = fakeClock();
  try {
    const cloud = relay();
    const mgr = manager([lan({ available: false }), rtc({ carries: true }), cloud], {
      session: { role: 'host' },
    });
    await mgr.connect();
    await settle();
    assert.ok(mgr.warmNames().includes('relay'));
    cloud.receive('inbound');

    clock.advance(29_000);
    await mgr.send('inside');
    await settle();
    assert.deepEqual(cloud.log.sent, ['inside'], 'stopped mirroring inside the window');

    clock.advance(2_000); // 31s since lastRx
    await mgr.send('outside');
    await settle();
    assert.deepEqual(cloud.log.sent, ['inside'], 'still paying for the relay past the window');
    await mgr.close();
  } finally {
    clock.restore();
  }
});

await check('a client never mirrors, however recently it heard a peer', async () => {
  // registry.js:402, the role guard, is the whole of this behaviour, so the
  // shape has to be one where a client genuinely HAS something to mirror down:
  // a warm transport that is not the active one and that a peer was just heard
  // on. A client on the cloud relay has neither — `desiredWarm` (:341) grants
  // the mailbox to hosts only — so the mirror set is empty for want of a
  // candidate and the guard makes no difference. The standby WebRTC path does
  // have both: the manager holds it warm for every role (:345).
  const direct = rtc(); // standby, carries: false — warm, never active
  const mgr = manager([lan(), direct], { session: { role: 'client' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  assert.deepEqual(mgr.warmNames(), ['webrtc'], 'setup: the client holds nothing to mirror down');

  direct.receive('inbound'); // inside the 30s window, so only the role stops it
  await mgr.send('env-1');
  await settle();
  assert.deepEqual(direct.log.sent, [], 'a client copied its traffic down a warm path');
  await mgr.close();
});

await check('a failing mirror is swallowed — the real send still reports ok', async () => {
  const clock = fakeClock();
  try {
    const cloud = relay();
    const mgr = manager([lan({ available: false }), rtc({ carries: true }), cloud], {
      session: { role: 'host' },
    });
    await mgr.connect();
    await settle();
    cloud.receive('inbound');
    cloud.knobs.sendFails = true;
    const result = await mgr.send('env-1');
    await settle();
    assert.deepEqual(result, { ok: true, via: 'webrtc', queued: false });
    await mgr.close();
  } finally {
    clock.restore();
  }
});

/* ------------------------------------------------------------- failover -- */

console.log('failover');

await check('one send failure costs one failover and one retry', async () => {
  const a = lan({ sendFails: true });
  const b = relay();
  const mgr = manager([a, b]);
  await mgr.connect();
  const result = await mgr.send('env-1');
  assert.deepEqual(result, { ok: true, via: 'relay', queued: false });
  assert.deepEqual(b.log.sent, ['env-1'], 'the envelope did not survive the failover');
  await mgr.close();
});

await check('a second failure parks the envelope in the outbox rather than dropping it', async () => {
  const outbox = fakeOfflineQueue();
  const mgr = manager([lan({ sendFails: true }), relay({ sendFails: true }), outbox]);
  await mgr.connect();
  const result = await mgr.send('env-1');
  assert.equal(result.queued, true);
  assert.equal(result.ok, false);
  assert.deepEqual(outbox.contents(), ['env-1'], 'a send failed silently');
  await mgr.close();
});

await check('failover demotes a standby transport instead of closing it', async () => {
  // registry.js:455-458. Closing WebRTC would take the signaling loop with it,
  // and the signaling loop is the only route back to a direct channel.
  const direct = rtc({ carries: true });
  const cloud = relay();
  const mgr = manager([direct, cloud]);
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');

  const next = await mgr.failover(direct);
  assert.equal(next?.name, 'relay');
  assert.equal(direct.log.closes, 0, 'closed the standby transport on failover');
  assert.ok(mgr.warmNames().includes('webrtc'), 'the standby was not demoted to warm');
  await mgr.close();
});

await check('failover closes a non-standby transport outright', async () => {
  const a = lan();
  const mgr = manager([a, relay()]);
  await mgr.connect();
  await mgr.failover(a);
  assert.equal(a.log.closes, 1);
  assert.equal(mgr.warmNames().includes('lan'), false);
  await mgr.close();
});

await check('CHARACTERISED: a send failure closes a standby transport anyway', async () => {
  // trySend() stamps FAILED on the transport (registry.js:433) before
  // failover() reads `previous.status !== STATUS.FAILED` (:455), so the
  // demotion branch above cannot be reached through the public send() path.
  // Pinned as observed behaviour, NOT endorsed — see the PR body.
  const direct = rtc({ carries: true, sendFails: true });
  const mgr = manager([direct, relay()]);
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  await mgr.send('env-1');
  assert.equal(direct.log.closes, 1, 'behaviour changed: the standby survived a send failure');
  assert.equal(mgr.warmNames().includes('webrtc'), false);
  await mgr.close();
});

await check('failover takes over a warm transport only if it can carry', async () => {
  const direct = rtc({ carries: false, openFails: true });
  const cloud = relay();
  const outbox = fakeOfflineQueue();
  const mgr = manager([lan({ sendFails: true }), direct, cloud, outbox], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'lan');
  assert.ok(mgr.warmNames().includes('webrtc'));

  const result = await mgr.send('env-1');
  assert.equal(result.via, 'relay', 'failed over onto a channel with nobody on it');
  await mgr.close();
});

await check('a transport probed unavailable does not get a failover turn', async () => {
  const cloud = relay({ available: false });
  const outbox = fakeOfflineQueue();
  const mgr = manager([lan({ sendFails: true }), cloud, outbox]);
  await mgr.connect();
  const result = await mgr.send('env-1');
  assert.equal(result.via, 'offline');
  assert.equal(cloud.log.opens, 0);
  await mgr.close();
});

await check('a standby coming good clears its own past failure', async () => {
  // registry.js:279 — "a standby transport that comes good has earned another
  // turn, whatever it did earlier in the session".
  const direct = rtc({ carries: true });
  const mgr = manager([direct, relay()]);
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');

  // failover() writes the standby off and demotes it to warm, still subscribed.
  await mgr.failover(direct);
  assert.equal(mgr.activeName(), 'relay');
  assert.equal(mgr.failed.has('webrtc'), true);
  assert.ok(mgr.warmNames().includes('webrtc'));

  // The channel comes back. READY on a warm standby earns it another turn.
  direct.announce(STATUS.DEGRADED);
  direct.announce(STATUS.READY);
  await settle();
  assert.equal(mgr.failed.has('webrtc'), false, 'a recovered standby stayed written off');
  assert.equal(mgr.activeName(), 'webrtc', 'the recovered direct channel did not take back over');
  await mgr.close();
});

/* --------------------------------------------------------------- replay -- */

console.log('replay');

await check('replay pushes the outbox through the active path, oldest first', async () => {
  const outbox = fakeOfflineQueue();
  await outbox.send('a');
  await outbox.send('b');
  await outbox.send('c');
  const good = lan();
  const mgr = manager([good, outbox]);
  await mgr.connect(); // openTransport replays on the transition to READY
  await settle();
  assert.deepEqual(good.log.sent, ['a', 'b', 'c']);
  assert.equal(outbox.size(), 0);
  await mgr.close();
});

await check('a stalled replay returns the unsent tail to the queue, in order', async () => {
  // registry.js:174-186. Two of four go out, the third throws, and c and d
  // must be back in the outbox in that order — reordered at most one batch,
  // never dropped.
  const outbox = fakeOfflineQueue();
  const good = lan({ sendFails: (_sealed, index) => index === 2 });
  const mgr = manager([good, outbox]);
  await mgr.connect();
  for (const item of ['a', 'b', 'c', 'd']) await outbox.send(item);

  const sent = await mgr.replay();
  assert.equal(sent, 2);
  assert.deepEqual(good.log.sent, ['a', 'b']);
  assert.deepEqual(outbox.contents(), ['c', 'd'], 'the unsent tail came back out of order');
  await mgr.close();
});

await check('anything enqueued during a replay sorts ahead of the returned tail', async () => {
  const outbox = fakeOfflineQueue();
  let n = 0;
  const good = lan({
    sendFails: () => {
      n += 1;
      if (n === 3) {
        outbox.send('late'); // arrives while the replay is running
        return true;
      }
      return false;
    },
  });
  const mgr = manager([good, outbox]);
  await mgr.connect();
  for (const item of ['a', 'b', 'c', 'd']) await outbox.send(item);
  await mgr.replay();
  assert.deepEqual(outbox.contents(), ['late', 'c', 'd']);
  await mgr.close();
});

await check('replay is not re-entrant and is a no-op on an empty outbox', async () => {
  const outbox = fakeOfflineQueue();
  const good = lan();
  const mgr = manager([good, outbox]);
  await mgr.connect();
  assert.equal(await mgr.replay(), 0);
  mgr.replaying = true;
  await outbox.send('a');
  assert.equal(await mgr.replay(), 0, 'a re-entrant replay ran');
  mgr.replaying = false;
  await mgr.close();
});

await check('the real offline queue satisfies what replay requires of it', async () => {
  // The queue registry.js:168-182 actually gets, not a fake: drain/size are
  // undeclared additions to the transport contract and this pins them.
  const outbox = createOfflineQueue({ storageKey: 'ki-outbox-test' });
  assert.equal(typeof outbox.drain, 'function');
  assert.equal(typeof outbox.size, 'function');
  const good = lan();
  const mgr = manager([good, outbox]);
  await mgr.connect();
  await outbox.send('a');
  await outbox.send('b');
  assert.equal(outbox.size(), 2);
  assert.equal(await mgr.replay(), 2);
  assert.deepEqual(good.log.sent, ['a', 'b']);
  assert.equal(outbox.size(), 0);
  await mgr.close();
});

await check('replay refuses to run when the offline queue is itself the active path', async () => {
  const outbox = fakeOfflineQueue();
  const mgr = manager([outbox]);
  await mgr.connect();
  assert.equal(mgr.activeName(), 'offline');
  await outbox.send('a');
  assert.equal(await mgr.replay(), 0, 'replayed the outbox into itself');
  await mgr.close();
});

/* --------------------------------------------------- routing and teardown */

console.log('routing and teardown');

await check('inbound envelopes reach onMessage; signals reach onSignal', async () => {
  const messages = [];
  const signals = [];
  const a = lan();
  const mgr = manager([a], { onMessage: (m) => messages.push(m), onSignal: (s) => signals.push(s) });
  await mgr.connect();
  a.receive('sealed-1');
  a.emit('signal', { sdp: 'offer' });
  assert.deepEqual(messages, ['sealed-1']);
  assert.deepEqual(signals, [{ sdp: 'offer' }]);
  await mgr.close();
});

await check('a listener that throws does not take the transport down', async () => {
  const a = lan();
  const mgr = manager([a], {
    onMessage: () => {
      throw new Error('bad listener');
    },
  });
  await mgr.connect();
  assert.doesNotThrow(() => a.receive('sealed-1'));
  assert.equal(a.status, STATUS.READY);
  await mgr.close();
});

await check('status events name the transport and whether it is the active one', async () => {
  const events = [];
  const a = lan();
  const b = relay();
  const mgr = manager([a, b], { onStatus: (e) => events.push(e) });
  await mgr.connect();
  const ready = events.filter((e) => e.name === 'lan' && e.status === STATUS.READY);
  assert.ok(ready.some((e) => e.active === true), 'the chosen transport never reported as active');
  await mgr.close();
});

await check('stats() reports the active path, the warm ones, and every probe', async () => {
  const direct = rtc({ openFails: true });
  const mgr = manager([lan(), direct, relay()], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  const s = mgr.stats();
  assert.equal(s.active, 'lan');
  assert.ok(s.warm.includes('webrtc'));
  assert.equal(s.probes.length, 3);
  assert.deepEqual(
    s.candidates.map((c) => c.name),
    ['lan', 'webrtc', 'relay'],
  );
  await mgr.close();
});

await check('close() closes only what was opened, and forgets everything', async () => {
  const a = lan();
  const never = relay({ available: false });
  const mgr = manager([a, never], { session: { role: 'client' } });
  await mgr.connect();
  await settle();
  await mgr.close();
  assert.equal(a.log.closes, 1);
  assert.equal(never.log.closes, 0, 'closed a transport that was never opened');
  assert.equal(mgr.activeName(), null);
  assert.deepEqual(mgr.warmNames(), []);
});

await check('a close that throws does not stop the rest coming down', async () => {
  const direct = rtc({ carries: true });
  direct.close = async () => {
    throw new Error('close refused');
  };
  const cloud = relay();
  const mgr = manager([lan({ available: false }), direct, cloud], { session: { role: 'host' } });
  await mgr.connect();
  await settle();
  assert.equal(mgr.activeName(), 'webrtc');
  assert.ok(mgr.warmNames().includes('relay'), 'test setup: the relay must be open');
  await mgr.close();
  assert.equal(cloud.log.closes, 1, 'one bad close stranded the others');
  assert.equal(mgr.activeName(), null);
});

if (FAIL.length) {
  console.error(`transport registry tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`transport registry tests: ${PASS.length} passed`);
}
