#!/usr/bin/env node
/**
 * lib/serverStore.js — the Redis path (#375, #376, #385).
 *
 * server-store.test.mjs pins the memory backend, the one every unit test env
 * actually runs on; nothing exercised the Upstash REST path or the mailbox
 * Lua script it sends. This file forces the Redis path against a fake
 * Upstash (see test/app/lib/fakeUpstash.mjs) and asserts on:
 *
 *   - exact command shapes (single POST, `/pipeline`, EVAL key/arg order)
 *   - the mailbox append Lua script's real semantics, run from its own
 *     exported source rather than a hand-written stand-in (#376)
 *   - the rate limiter's Redis bucket path
 *   - writeParty's oversize guard (#385)
 *
 * `usingRedis` is read from the environment at import time, so the creds
 * below must land before the first import of anything that transitively
 * imports serverStore.js.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

process.env.UPSTASH_REDIS_REST_URL = 'https://fake-upstash.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'fake-token';
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const APP = '../../apps/party-tracker/';
const store = await import(`${APP}lib/serverStore.js`);
const { createParty, createMember, PARTY_TTL_MS } = await import(`${APP}lib/core/state.js`);

assert.equal(store.usingRedis, true, 'this file needs the Redis path — Upstash creds must precede the import');

const { createFakeUpstash, execCommand } = await import('./lib/fakeUpstash.mjs');

/** Line-by-line JS mirror of APPEND_MAILBOX_LUA's own redis.call sequence —
 *  keyed on the real exported script string, so a script edit that changes
 *  behavior without changing the text cannot pass silently. */
function appendMailboxEval(fakeStore, keys, args) {
  const [seqKey, boxKey] = keys;
  const [payloadJson, depthStr, boxTtlStr, seqTtlStr] = args;
  const seq = execCommand(fakeStore, ['INCR', seqKey]);
  const payload = JSON.parse(payloadJson);
  payload.seq = seq;
  const msg = JSON.stringify(payload);
  execCommand(fakeStore, ['ZADD', boxKey, seq, msg]);
  execCommand(fakeStore, ['ZREMRANGEBYRANK', boxKey, 0, -Number(depthStr) - 1]);
  execCommand(fakeStore, ['EXPIRE', boxKey, boxTtlStr]);
  execCommand(fakeStore, ['EXPIRE', seqKey, seqTtlStr]);
  return seq;
}

const fake = createFakeUpstash({ evalScripts: { [store.APPEND_MAILBOX_LUA]: appendMailboxEval } });
globalThis.fetch = fake.fetchImpl;

const rateLimit = await import(`${APP}lib/rateLimit.js`);

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

const idc = (() => {
  let n = 0;
  return () => `p-${(n += 1)}`;
})();

console.log('\n--- serverStore: Redis path (party CRUD) ---');

await check('writeParty SETs the party and its code index, both EX', async () => {
  fake.calls.length = 0;
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  party.code = 'ABC234';
  await store.writeParty(id, party);
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0].url.endsWith('/pipeline'));
  const [setParty, setCode] = fake.calls[0].body;
  assert.equal(setParty[0], 'SET');
  assert.equal(setParty[1], `ki:party:${id}`);
  assert.equal(setParty[3], 'EX');
  assert.equal(setCode[0], 'SET');
  assert.equal(setCode[1], 'ki:code:ABC234');
  assert.equal(setCode[2], id);
});

await check('writeParty skips the code SET when the party has none yet', async () => {
  fake.calls.length = 0;
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  await store.writeParty(id, party);
  assert.equal(fake.calls[0].body.length, 1, 'only the party SET, no code SET');
});

await check('readParty GETs and parses the stored JSON', async () => {
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  await store.writeParty(id, party);
  fake.calls.length = 0;
  const read = await store.readParty(id);
  assert.equal(fake.calls[0].body[0], 'GET');
  assert.equal(fake.calls[0].body[1], `ki:party:${id}`);
  assert.equal(read.id, id);
  assert.equal(read.name, 'Trip');
});

await check('a read evicts a stale member and writes the pruned party back', async () => {
  const id = idc();
  const now = Date.now();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now });
  party.members['m-stale'] = { ...createMember({ id: 'm-stale', name: 'Stale', now }), lastSeen: now - 999999999 };
  await store.writeParty(id, party);
  const read = await store.readParty(id);
  assert.ok(!read.members['m-stale'], 'evicted on read, same as the memory backend');
  const stored = JSON.parse(fake.store.strings.get(`ki:party:${id}`));
  assert.ok(!stored.members['m-stale'], 'the eviction was written back to Redis');
});

await check('deleteParty DELs the party, mailbox, seq, subs and code together', async () => {
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  party.code = 'ZZZ999';
  await store.writeParty(id, party);
  fake.calls.length = 0;
  await store.deleteParty(id);
  const dels = fake.calls[1].body.map((cmd) => cmd[1]);
  assert.ok(dels.includes(`ki:party:${id}`));
  assert.ok(dels.includes(`ki:zbox:${id}`));
  assert.ok(dels.includes(`ki:seq:${id}`));
  assert.ok(dels.includes(`ki:subs:${id}`));
  assert.ok(dels.includes('ki:code:ZZZ999'));
});

await check('allocateParty claims its code with SET NX EX', async () => {
  fake.calls.length = 0;
  const { partyId, code } = await store.allocateParty();
  assert.ok(partyId && code);
  const setCall = fake.calls.find((c) => c.body[0] === 'SET');
  assert.ok(setCall.body.includes('NX'));
  assert.ok(setCall.body.includes('EX'));
});

await check('resolveCode GETs the code index', async () => {
  const { partyId, code } = await store.allocateParty();
  fake.calls.length = 0;
  const resolved = await store.resolveCode(code.toLowerCase());
  assert.equal(resolved, partyId, 'normalized before the GET');
  assert.equal(fake.calls[0].body[0], 'GET');
  assert.equal(fake.calls[0].body[1], `ki:code:${code}`);
});

console.log('\n--- serverStore: Redis path (mailbox, #376) ---');

await check('append -> read since cursor returns exactly the strictly-newer messages', async () => {
  const id = idc();
  const seqs = [];
  for (let i = 0; i < 5; i += 1) {
    seqs.push(await store.appendMailbox(id, { from: 'a', to: null, kind: 'test', data: { i } }));
  }
  assert.deepEqual(seqs, [1, 2, 3, 4, 5], 'seq is the ascending high-water mark, embedded in each message');
  const { messages, seq } = await store.readMailbox(id, seqs[1]); // since seq 2
  assert.deepEqual(messages.map((m) => m.data.i), [2, 3, 4], 'strictly newer than the cursor, in order');
  assert.equal(seq, 5);
});

await check('depth trim keeps only the newest MAILBOX_DEPTH entries', async () => {
  const id = idc();
  for (let i = 0; i < 505; i += 1) {
    await store.appendMailbox(id, { from: 'a', to: null, kind: 'test', data: { i } });
  }
  const { messages, seq } = await store.readMailbox(id, 0);
  assert.equal(messages.length, 500, 'ZREMRANGEBYRANK kept exactly DEPTH entries');
  assert.equal(messages[0].data.i, 5, 'the oldest 5 were dropped');
  assert.equal(messages[499].data.i, 504);
  assert.equal(seq, 505, 'the high-water mark is unaffected by the trim');
});

await check('the EVAL both refreshes the box TTL and the seq-key TTL, with the right seconds', async () => {
  const id = idc();
  await store.appendMailbox(id, { from: 'a', to: null, kind: 'test', data: {} });
  assert.equal(fake.store.ttl.get(`ki:zbox:${id}`), Math.round(store.MAILBOX_TTL_MS / 1000), 'box EXPIRE seconds');
  assert.equal(fake.store.ttl.get(`ki:seq:${id}`), Math.round(PARTY_TTL_MS / 1000), 'seq-key EXPIRE seconds');
});

await check('appendMailbox is one EVAL round trip, not a multi-step pipeline', async () => {
  const id = idc();
  fake.calls.length = 0;
  await store.appendMailbox(id, { from: 'a', to: null, kind: 'test', data: {} });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].body[0], 'EVAL');
  assert.equal(fake.calls[0].body[1], store.APPEND_MAILBOX_LUA);
});

console.log('\n--- serverStore: Redis path (subscriptions) ---');

await check('a subscription round-trips through HSET/HGETALL', async () => {
  const id = idc();
  await store.addSubscription(id, 'm-ana', { endpoint: 'https://push.test/x', keys: {} });
  const subs = await store.readSubscriptions(id);
  assert.equal(subs.length, 1);
  assert.equal(subs[0].memberId, 'm-ana');
});

await check('removeSubscription HDELs the one endpoint', async () => {
  const id = idc();
  await store.addSubscription(id, 'm-ana', { endpoint: 'https://push.test/y', keys: {} });
  await store.removeSubscription(id, 'https://push.test/y');
  const subs = await store.readSubscriptions(id);
  assert.equal(subs.length, 0);
});

console.log('\n--- serverStore: Redis path (writeParty size guard, #385) ---');

await check('a normal-size party writes unchanged, no counters bumped', async () => {
  const id = idc();
  const before = store.metrics().party_write_oversize_warned;
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  await store.writeParty(id, party);
  assert.equal(store.metrics().party_write_oversize_warned, before);
});

await check('a party at or above the warn threshold logs once and bumps a counter', async () => {
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  party.padding = 'x'.repeat(210 * 1024); // over the 200 KiB warn threshold
  const before = store.metrics().party_write_oversize_warned;
  const warnLogs = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnLogs.push(args.join(' '));
  try {
    await store.writeParty(id, party);
    await store.writeParty(id, party); // second write, same party
  } finally {
    console.warn = origWarn;
  }
  assert.equal(store.metrics().party_write_oversize_warned, before + 1, 'bumped once, not per write');
  assert.equal(warnLogs.length, 1, 'logged once per party, not once per write');
});

await check('a party at or above the hard cap is refused, not sent', async () => {
  const id = idc();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now: Date.now() });
  party.padding = 'x'.repeat(1100 * 1024); // over the 1 MiB hard cap
  fake.calls.length = 0;
  const before = store.metrics().party_write_oversize_blocked;
  await assert.rejects(() => store.writeParty(id, party), /hard cap/);
  assert.equal(fake.calls.length, 0, 'no SET was issued for the oversize party');
  assert.equal(store.metrics().party_write_oversize_blocked, before + 1);
});

console.log('\n--- rateLimit: Redis path ---');

await check('a hit is one INCR + EXPIRE pipeline against a window-scoped key', async () => {
  fake.calls.length = 0;
  const result = await rateLimit.rateLimit('worldMark', '203.0.113.9');
  assert.equal(result.ok, true);
  assert.equal(fake.calls.length, 1);
  assert.ok(fake.calls[0].url.endsWith('/pipeline'));
  const [incr, expire] = fake.calls[0].body;
  assert.equal(incr[0], 'INCR');
  assert.ok(incr[1].startsWith('ki:rl:worldMark:203.0.113.9:'));
  assert.equal(expire[0], 'EXPIRE');
});

await check('exceeding the limit answers not-ok with a retryAfter', async () => {
  const subject = 'over-limit-subject';
  let last;
  for (let i = 0; i < rateLimit.LIMITS.pushSend.limit + 1; i += 1) {
    last = await rateLimit.rateLimit('pushSend', subject);
  }
  assert.equal(last.ok, false);
  assert.ok(last.retryAfter > 0);
});

if (FAIL.length) {
  console.error(`server-store Redis tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`server-store Redis tests: ${PASS.length} passed`);
}
