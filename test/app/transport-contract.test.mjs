#!/usr/bin/env node
/**
 * The transport contract: what types.js writes down versus what the manager
 * enforces.
 *
 * lib/transport/types.js:1-24 is labelled "The transport contract. Canonical."
 * It is not. The manager branches on two members the contract never mentions,
 * and the replay path requires two more that only the offline queue has:
 *
 *   member              declared in types.js   branched on in registry.js
 *   ------------------  --------------------   ---------------------------
 *   standby             no                     :279, :317, :455
 *   carries()           no                     :345, :372, :471
 *   drain()             no                     :168, :171
 *   size()              no                     :171
 *
 * A transport written to the documented contract alone is therefore treated as
 * non-standby and non-carrying — closed on the first failover instead of kept
 * warm, and never promoted when its channel comes good. The consequence for
 * WebRTC is spelled out at registry.js:19-24: "a single early failover took
 * every party to the cloud permanently".
 *
 * This file pins both halves, so the follow-up can close the gap in either
 * direction — widen the contract or narrow the manager — and know at once.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const APP = '../../apps/party-tracker/';
const { defineTransport, createEmitter, RANK, STATUS } = await import(`${APP}lib/transport/types.js`);
const { createOfflineQueue } = await import(`${APP}lib/transport/offlineQueue.js`);
const { createLocalHttp, LOCAL_PROBE_TIMEOUT_MS } = await import(`${APP}lib/transport/localHttp.js`);
const { createCloudRelay } = await import(`${APP}lib/transport/cloudRelay.js`);
const { createBluetooth } = await import(`${APP}lib/transport/bluetooth.js`);
const { createWebRTC } = await import(`${APP}lib/transport/webrtc.js`);
const { probeMailboxHealth, applyMailboxMode } = await import(`${APP}lib/transport/mailboxClient.js`);
const { normalizeBase, mayStream, markNoStream } = await import(`${APP}lib/transport/streamGate.js`);

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

/** The verbs every transport supplies; the nouns come from defineTransport. */
const stub = (over = {}) =>
  defineTransport({
    name: 'stub',
    rank: 50,
    probe: async () => ({ available: true }),
    open: async () => {},
    send: async () => {},
    close: async () => {},
    ...over,
  });

/* ----------------------------------------------------- the written half -- */

console.log('what defineTransport gives you');

await check('the nouns come free: status, counters, emitter, stats', async () => {
  const t = stub();
  assert.equal(t.name, 'stub');
  assert.equal(t.rank, 50);
  assert.equal(t.status, STATUS.IDLE);
  for (const verb of ['probe', 'open', 'send', 'close', 'on', 'stats', 'setStatus', 'deliver', 'fail']) {
    assert.equal(typeof t[verb], 'function', `${verb} is missing`);
  }
  const s = t.stats();
  assert.deepEqual(
    Object.keys(s).sort(),
    ['errors', 'lastError', 'name', 'opened', 'rank', 'received', 'sent', 'status'].sort(),
  );
});

await check('open walks IDLE -> CONNECTING -> READY and counts the open', async () => {
  const seen = [];
  const t = stub();
  t.on('status', (e) => seen.push(e.status));
  await t.open({});
  assert.deepEqual(seen, [STATUS.CONNECTING, STATUS.READY]);
  assert.equal(t.status, STATUS.READY);
  assert.equal(t.stats().opened, 1);
});

await check('an open that throws leaves the status at CONNECTING, not FAILED', async () => {
  // Load-bearing: registry.js:317 keeps a standby transport warm precisely
  // when its status is NOT FAILED — "a slow success", ICE still running.
  const t = stub({ open: async () => { throw new Error('not yet'); } });
  await assert.rejects(() => t.open({}), /not yet/);
  assert.equal(t.status, STATUS.CONNECTING, 'a failed open now reports FAILED');
  assert.equal(t.stats().opened, 0);
});

await check('send and deliver move the counters; fail records and stamps FAILED', async () => {
  const got = [];
  const t = stub();
  t.on('message', (m) => got.push(m));
  await t.send('a');
  t.deliver('b');
  assert.equal(t.stats().sent, 1);
  assert.equal(t.stats().received, 1);
  assert.deepEqual(got, ['b']);
  t.fail(new Error('radio off'));
  assert.equal(t.status, STATUS.FAILED);
  assert.equal(t.stats().errors, 1);
  assert.equal(t.stats().lastError, 'radio off');
});

await check('close stamps CLOSED and drops every listener', async () => {
  const got = [];
  const t = stub();
  t.on('message', (m) => got.push(m));
  await t.close();
  assert.equal(t.status, STATUS.CLOSED);
  t.deliver('after');
  assert.deepEqual(got, [], 'a closed transport still notifies its old listeners');
});

await check('setStatus is edge-triggered — the same status twice emits once', async () => {
  const seen = [];
  const t = stub();
  t.on('status', (e) => seen.push(e.status));
  t.setStatus(STATUS.DEGRADED, 'polling');
  t.setStatus(STATUS.DEGRADED, 'polling again');
  assert.deepEqual(seen, [STATUS.DEGRADED]);
});

await check('describe() is merged into stats, and may shadow nothing important', async () => {
  const t = stub({ describe: () => ({ peers: 2, mode: 'stream' }) });
  const s = t.stats();
  assert.equal(s.peers, 2);
  assert.equal(s.mode, 'stream');
  assert.equal(s.name, 'stub');
});

await check('createEmitter unsubscribes by return value and survives a bad listener', () => {
  const e = createEmitter();
  const got = [];
  const off = e.on('x', (v) => got.push(v));
  e.on('x', () => {
    throw new Error('bad listener');
  });
  const off2 = e.on('x', (v) => got.push(`${v}!`));
  assert.doesNotThrow(() => e.emit('x', 1));
  assert.deepEqual(got, [1, '1!'], 'a throwing listener stopped the ones after it');
  off();
  off2();
  e.emit('x', 2);
  assert.deepEqual(got, [1, '1!']);
  assert.doesNotThrow(() => e.emit('never-listened', 1));
});

/* --------------------------------------------------------------- the gap - */

console.log('the gap between written and enforced');

await check('defineTransport supplies none of the four members the manager needs', () => {
  const t = stub();
  assert.equal(t.standby, undefined, 'standby is declared now — update the contract note');
  assert.equal(t.carries, undefined, 'carries is declared now — update the contract note');
  assert.equal(t.drain, undefined);
  assert.equal(t.size, undefined);
});

await check('WebRTC bolts standby and carries on by hand, after defineTransport', () => {
  // webrtc.js:368-378. The only transport that declares itself standby, and
  // the reason the whole warm-path mechanism exists.
  const t = createWebRTC({ base: 'https://example.test', role: 'host' });
  assert.equal(t.standby, true, 'WebRTC is no longer standby — failover will close it');
  assert.equal(typeof t.carries, 'function', 'WebRTC no longer reports whether it can carry');
  assert.equal(t.carries(), false, 'a fresh peer connection claims an open channel');
  assert.equal(t.rank, RANK.WEBRTC);
});

await check('the offline queue bolts drain and size on, which replay requires', () => {
  const q = createOfflineQueue({ storageKey: 'ki-outbox-contract' });
  assert.equal(typeof q.drain, 'function');
  assert.equal(typeof q.size, 'function');
  assert.equal(typeof q.peek, 'function');
  assert.equal(q.standby, undefined, 'the outbox must never be kept warm as a standby');
});

await check('no other transport declares standby or carries', () => {
  // If one starts to, the manager will begin keeping it warm and promoting it,
  // which is a behaviour change nothing else would announce.
  const others = {
    'local-http': createLocalHttp({ base: 'https://example.test' }),
    'cloud-relay': createCloudRelay({ base: 'https://example.test' }),
    'bluetooth-le': createBluetooth(),
    offline: createOfflineQueue({ storageKey: 'ki-outbox-contract-2' }),
  };
  for (const [name, t] of Object.entries(others)) {
    assert.equal(t.standby, undefined, `${name} became standby`);
    assert.equal(t.carries, undefined, `${name} started reporting carries()`);
  }
});

/* -------------------------------------------------- the transports exist - */

console.log('every registered transport');

await check('the selection order is the rank order the runtime relies on', () => {
  assert.deepEqual(
    Object.entries(RANK).sort((a, b) => a[1] - b[1]).map(([k]) => k),
    ['LOCAL_HTTP', 'WEBRTC', 'BLUETOOTH', 'CLOUD_RELAY', 'OFFLINE'],
  );
  assert.equal(createLocalHttp({ base: '' }).rank, RANK.LOCAL_HTTP);
  assert.equal(createWebRTC({ base: '', role: 'client' }).rank, RANK.WEBRTC);
  assert.equal(createBluetooth().rank, RANK.BLUETOOTH);
  assert.equal(createCloudRelay({ base: '' }).rank, RANK.CLOUD_RELAY);
  assert.equal(createOfflineQueue({ storageKey: 'x' }).rank, RANK.OFFLINE);
});

await check('every transport factory builds without a browser present', () => {
  // partyRuntime.js:519-532 constructs all five at party start; a factory that
  // touches a browser API at construction would break every Node import.
  const built = [
    createLocalHttp({ base: 'https://example.test' }),
    createWebRTC({ base: 'https://example.test', role: 'host' }),
    createBluetooth(),
    createCloudRelay({ base: 'https://example.test' }),
    createOfflineQueue({ storageKey: 'ki-outbox-contract-3' }),
  ];
  const names = built.map((t) => t.name);
  assert.deepEqual(names, ['local-http', 'webrtc', 'bluetooth-le', 'cloud-relay', 'offline']);
  for (const t of built) assert.equal(t.status, STATUS.IDLE);
});

await check('bluetooth is honest about being unimplementable, and never available', async () => {
  // bluetooth.js — Web Bluetooth is central-only, so no browser can host over
  // BLE. It exists as a registered transport that always declines.
  const t = createBluetooth();
  const probe = await t.probe({});
  assert.equal(probe.available, false);
  assert.ok(probe.reason, 'declined with no reason for the diagnostics panel');
  assert.equal(t.stats().implemented, false);
  await assert.rejects(() => t.open({}), /cannot open/);
  await assert.rejects(() => t.send('x'), /cannot send/);
});

await check('the offline queue is always available and its open cannot fail', async () => {
  // offlineQueue.js:1-15 — if this one could fail, message loss would have a
  // hiding place.
  const q = createOfflineQueue({ storageKey: 'ki-outbox-contract-4' });
  assert.deepEqual(await q.probe({}), { available: true });
  await q.open({});
  assert.equal(q.status, STATUS.READY);
  await q.send('a');
  await q.send('b');
  assert.equal(q.size(), 2);
  assert.equal(q.peek(), 'a');
  assert.deepEqual(q.drain(), ['a', 'b']);
  assert.equal(q.size(), 0);
  // Closing must not discard the queue — that is the whole point of it.
  await q.send('c');
  await q.close();
  assert.equal(q.size(), 1, 'closing the outbox threw away an unsent envelope');
});

await check('the outbox is bounded, and drops the OLDEST when it is full', async () => {
  // In a park the newest location is the one worth keeping.
  const q = createOfflineQueue({ storageKey: 'ki-outbox-contract-5', max: 3 });
  for (const item of ['a', 'b', 'c', 'd', 'e']) await q.send(item);
  assert.equal(q.size(), 3);
  assert.deepEqual(q.drain(), ['c', 'd', 'e'], 'the newest envelopes were the ones dropped');
  assert.equal(createOfflineQueue({ storageKey: 'k', max: 3 }).stats().max, 3);
});

await check('a mailbox probe with no base declines without touching the network', async () => {
  assert.deepEqual(await probeMailboxHealth(''), { available: false, reason: 'no-base' });
  assert.deepEqual(await probeMailboxHealth(null), { available: false, reason: 'no-base' });
  assert.equal(LOCAL_PROBE_TIMEOUT_MS, 1200, 'the LAN probe cap moved');
});

await check('applyMailboxMode reports polling as DEGRADED, not healthy', () => {
  // A working-but-worse state, so the diagnostics panel can say why the roster
  // feels laggy.
  const t = stub();
  applyMailboxMode(t, 'polling');
  assert.equal(t.status, STATUS.DEGRADED);
  assert.equal(t.stats().lastError, null);
  applyMailboxMode(t, 'stream');
  assert.equal(t.status, STATUS.READY);
});

await check('applyMailboxMode never revives a closed or failed transport', () => {
  const closed = stub();
  closed.setStatus(STATUS.CLOSED);
  applyMailboxMode(closed, 'stream');
  assert.equal(closed.status, STATUS.CLOSED);

  const failed = stub();
  failed.fail(new Error('gone'));
  applyMailboxMode(failed, 'stream');
  assert.equal(failed.status, STATUS.FAILED, 'a dead transport was reported healthy again');
});

await check('the stream gate refuses this app own origin and remembers a 404 once', () => {
  // streamGate.js:10-37. The relay in app/api implements no SSE; asking anyway
  // costs a 404 per peer per page load.
  assert.equal(normalizeBase('https://x.test///'), 'https://x.test');
  assert.equal(normalizeBase(null), '');
  assert.equal(mayStream(''), false, 'a relative base is this origin too');
  assert.equal(mayStream('https://lan.test:8080'), true);
  markNoStream('https://lan.test:8080/');
  assert.equal(mayStream('https://lan.test:8080'), false, 'a known-dead stream was asked again');
});

if (FAIL.length) {
  console.error(`transport contract tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`transport contract tests: ${PASS.length} passed`);
}
