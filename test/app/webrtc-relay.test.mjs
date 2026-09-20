#!/usr/bin/env node
/**
 * Issue #353 — prove WebRTC carries traffic over the mailbox-signaled relay path.
 *
 * Seams: createWebRTC (host beacon + channel lifecycle) and TransportManager
 * (failover to cloud-relay, promotion when carries() becomes true, roster
 * delivery on the direct path).
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const APP = '../../apps/party-tracker/';
const { createWebRTC } = await import(`${APP}lib/transport/webrtc.js`);
const { createCloudRelay } = await import(`${APP}lib/transport/cloudRelay.js`);
const { createOfflineQueue } = await import(`${APP}lib/transport/offlineQueue.js`);
const { createTransportManager } = await import(`${APP}lib/transport/registry.js`);
const { STATUS } = await import(`${APP}lib/transport/types.js`);
const { PING, SNAPSHOT } = await import(`${APP}lib/core/protocol.js`);
const { installMailboxFetch, installBrowserGlobals } = await import('./lib/mockMailbox.mjs');
const { installMockRtc, setRtcContext, setRtcOpenDelay, resetRtcHub } = await import('./lib/mockRtc.mjs');

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

/** Hand-crank setTimeout without waiting on wall clock. */
function captureTimeouts() {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  let now = 0;
  let nextId = 1;
  /** @type {Map<number, { at: number, fn: Function, cancelled: boolean }>} */
  const timers = new Map();

  globalThis.setTimeout = (fn, ms = 0) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn, cancelled: false });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const t = timers.get(id);
    if (t) t.cancelled = true;
  };

  const fireDue = () => {
    for (const [id, t] of [...timers.entries()]) {
      if (t.cancelled || t.at > now) continue;
      timers.delete(id);
      try {
        t.fn();
      } catch {
        /* timer rejections are observed through the transport open promise */
      }
    }
  };

  return {
    advance(ms) {
      now += ms;
      fireDue();
    },
    restore() {
      Object.assign(globalThis, real);
    },
  };
};

const REAL_SET_TIMEOUT = globalThis.setTimeout;
const settle = async (turns = 6) => {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => REAL_SET_TIMEOUT(r, 0));
};

/** Advance fake timers in steps so mailbox polls and ICE can interleave. */
const pumpClock = async (clocks, ms, steps = 12) => {
  const step = ms / steps;
  for (let i = 0; i < steps; i += 1) {
    clocks.advance(step);
    await settle(4);
  }
};

const partyId = () => `p-${Math.random().toString(16).slice(2, 10)}`;

console.log('webrtc over mailbox (#353)');

await check('host with zero peers sends beacons without error and keeps signaling alive', async () => {
  const id = partyId();
  const hostId = 'm-host';
  const browser = installBrowserGlobals();
  const mailbox = await installMailboxFetch();
  const rtc = installMockRtc();
  const clocks = captureTimeouts();

  setRtcContext({ partyId: id, peerId: hostId, role: 'host' });
  const transport = createWebRTC({ base: mailbox.base, role: 'host' });
  const received = [];
  transport.on('message', (m) => received.push(m));

  await transport.open({ session: { partyId: id, selfId: hostId, hostId: hostId, role: 'host' } });
  assert.equal(transport.status, STATUS.READY);

  const beacon = { kind: PING, version: 1 };
  await transport.send(beacon);
  assert.deepEqual(received, [], 'host does not loop its own beacon back');

  // A joiner offer still reaches the host — signaling was not torn down.
  setRtcContext({ partyId: id, peerId: 'm-join', role: 'client' });
  const joiner = createWebRTC({ base: mailbox.base, role: 'client' });
  const joinOpen = joiner.open({ session: { partyId: id, selfId: 'm-join', hostId, role: 'client' } });
  const joinDone = joinOpen.catch(() => {});
  await settle(8);
  await pumpClock(clocks, 4500);
  await joinDone;

  assert.ok(
    mailbox.posts.some((p) => p.kind === 'signal' && p.from === 'm-join'),
    'joiner signaling reached the mailbox',
  );

  await transport.close();
  await joiner.close();
  clocks.restore();
  rtc.restore();
  mailbox.restore();
  browser.restore();
  resetRtcHub(id);
});

await check('joiner fails over to relay then promotes when the direct channel opens', async () => {
  const id = partyId();
  const hostId = 'm-host';
  const clientId = 'm-client';
  const browser = installBrowserGlobals();
  const mailbox = await installMailboxFetch();
  const rtc = installMockRtc();
  const clocks = captureTimeouts();
  setRtcOpenDelay(id, 5000);

  const sessionHost = { partyId: id, selfId: hostId, hostId, role: 'host' };
  const sessionClient = { partyId: id, selfId: clientId, hostId, role: 'client' };

  setRtcContext({ partyId: id, peerId: hostId, role: 'host' });
  const hostRtc = createWebRTC({ base: mailbox.base, role: 'host' });
  const hostRelay = createCloudRelay({ base: mailbox.base });
  const hostMgr = createTransportManager({
    transports: [hostRtc, hostRelay, createOfflineQueue({ storageKey: `out-${id}-h` })],
    session: sessionHost,
  });
  await hostMgr.connect();
  await pumpClock(clocks, 100);

  setRtcContext({ partyId: id, peerId: clientId, role: 'client' });
  const clientRtc = createWebRTC({ base: mailbox.base, role: 'client' });
  const clientRelay = createCloudRelay({ base: mailbox.base });
  const clientMgr = createTransportManager({
    transports: [clientRtc, clientRelay, createOfflineQueue({ storageKey: `out-${id}-c` })],
    session: sessionClient,
  });

  const connectPromise = clientMgr.connect();
  const connectDone = connectPromise.catch(() => null);
  await settle(8);
  await pumpClock(clocks, 300);
  await pumpClock(clocks, 4500);
  await connectDone;

  assert.equal(clientMgr.activeName(), 'cloud-relay', 'join proceeded on relay after open timeout');
  assert.ok(clientMgr.warmNames().includes('webrtc'), 'negotiation stayed warm');

  await pumpClock(clocks, 2500);
  assert.equal(clientMgr.activeName(), 'webrtc', 'manager moved traffic to the direct channel');
  assert.equal(clientRtc.carries(), true);

  await hostMgr.close();
  await clientMgr.close();
  clocks.restore();
  rtc.restore();
  mailbox.restore();
  browser.restore();
  resetRtcHub(id);
});

await check('roster snapshot converges over the direct channel once promoted', async () => {
  const id = partyId();
  const hostId = 'm-host';
  const clientId = 'm-client';
  const browser = installBrowserGlobals();
  const mailbox = await installMailboxFetch();
  const rtc = installMockRtc();
  const clocks = captureTimeouts();
  setRtcOpenDelay(id, 5000);

  const roster = { members: { [hostId]: { name: 'Host' }, [clientId]: { name: 'Guest' } } };
  const sessionHost = { partyId: id, selfId: hostId, hostId, role: 'host' };
  const sessionClient = { partyId: id, selfId: clientId, hostId, role: 'client' };

  setRtcContext({ partyId: id, peerId: hostId, role: 'host' });
  const hostRtc = createWebRTC({ base: mailbox.base, role: 'host' });
  const hostRelay = createCloudRelay({ base: mailbox.base });
  const hostMgr = createTransportManager({
    transports: [hostRtc, hostRelay, createOfflineQueue({ storageKey: `out-${id}-h2` })],
    session: sessionHost,
  });
  await hostMgr.connect();
  await pumpClock(clocks, 100);

  const clientFrames = [];
  setRtcContext({ partyId: id, peerId: clientId, role: 'client' });
  const clientRtc = createWebRTC({ base: mailbox.base, role: 'client' });
  const clientRelay = createCloudRelay({ base: mailbox.base });
  const clientMgr = createTransportManager({
    transports: [clientRtc, clientRelay, createOfflineQueue({ storageKey: `out-${id}-c2` })],
    session: sessionClient,
    onMessage: (frame) => clientFrames.push(frame),
  });

  const connectPromise = clientMgr.connect();
  const connectDone = connectPromise.catch(() => null);
  await settle(8);
  await pumpClock(clocks, 300);
  await pumpClock(clocks, 4500);
  await connectDone;
  await pumpClock(clocks, 2500);
  assert.equal(clientMgr.activeName(), 'webrtc');

  const snap = { kind: SNAPSHOT, roster, version: 3 };
  await hostMgr.send(snap);
  await settle(8);

  assert.ok(
    clientFrames.some((f) => f.kind === SNAPSHOT && f.version === 3),
    'client received the roster snapshot on the direct path',
  );

  await hostMgr.close();
  await clientMgr.close();
  clocks.restore();
  rtc.restore();
  mailbox.restore();
  browser.restore();
  resetRtcHub(id);
});

if (FAIL.length) {
  console.error(`webrtc-relay tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`webrtc-relay tests: ${PASS.length} passed`);
}
