#!/usr/bin/env node
/**
 * lib/serverStore.js — the cloud fallback's storage, memory backend.
 *
 * 494 lines, no test imported it. Two backends are chosen at import time; with
 * no Upstash credentials in the environment this file exercises the
 * module-level Map, which is the one `npm run dev`, a VPS and the self-hosted
 * /server all actually run on.
 *
 * The headline is `readParty` (serverStore.js:166-194): a READ that writes.
 * It prunes expired members through the reducer's `evict` and writes the
 * pruned state back, so the version number moves as a side effect of looking.
 * That is deliberate and justified in the comment above it — the alternative
 * is a version that depends on when you happened to read — but it is exactly
 * the kind of thing a reshape breaks without noticing, so it is pinned here.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

// Chosen at import time, so the environment has to be clean before the import.
for (const name of [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
]) {
  delete process.env[name];
}

const APP = '../../apps/party-tracker/';
const store = await import(`${APP}lib/serverStore.js`);
const { createParty, createMember, MEMBER_TTL_MS, PARTY_TTL_MS } = await import(
  `${APP}lib/core/state.js`
);

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

/** A party whose members were last seen `agesMs` ago. */
function partyWith(members, { id = 'p1', code = 'ABC234', agesMs = {} } = {}) {
  const now = Date.now();
  const party = createParty({ id, name: 'Trip', leader: 'm-ana', now });
  party.code = code;
  for (const [memberId, extra] of Object.entries(members)) {
    party.members[memberId] = {
      ...createMember({ id: memberId, name: memberId, now }),
      lastSeen: now - (agesMs[memberId] ?? 0),
      ...extra,
    };
  }
  return party;
}

const idc = (() => {
  let n = 0;
  return () => `p-${(n += 1)}-${Math.random().toString(16).slice(2, 8)}`;
})();

console.log('the memory backend');

await check('this run really is on the Map, not on Redis', () => {
  assert.equal(store.usingRedis, false, 'the test env has Upstash credentials set');
});

/* ------------------------------------------------------------ read/write */

console.log('readParty');

await check('a party written comes back unchanged when nothing has expired', async () => {
  const id = idc();
  const party = partyWith({ 'm-ana': {}, 'm-ben': {} }, { id, code: 'AAA222' });
  await store.writeParty(id, party);
  const read = await store.readParty(id);
  assert.equal(read.version, party.version, 'a read moved the version with nothing to evict');
  assert.deepEqual(Object.keys(read.members).sort(), ['m-ana', 'm-ben']);
  assert.equal(read, party, 'an untouched read copied the record');
});

await check('a read evicts a member past the TTL and bumps the version doing it', async () => {
  // serverStore.js:166-194 — the pruned state is written back rather than
  // recomputed per read, so the version does not depend on when you looked.
  const id = idc();
  const party = partyWith(
    { 'm-ana': {}, 'm-gone': {} },
    { id, code: 'AAA223', agesMs: { 'm-gone': MEMBER_TTL_MS + 60_000 } },
  );
  const startVersion = party.version;
  await store.writeParty(id, party);

  const read = await store.readParty(id);
  assert.deepEqual(Object.keys(read.members), ['m-ana'], 'the stale member survived the read');
  assert.equal(read.version, startVersion + 1, 'evicting did not move the version');
});

await check('the eviction is written back, so the next read is idempotent', async () => {
  const id = idc();
  await store.writeParty(
    id,
    partyWith(
      { 'm-ana': {}, 'm-gone': {} },
      { id, code: 'AAA224', agesMs: { 'm-gone': MEMBER_TTL_MS + 60_000 } },
    ),
  );
  const first = await store.readParty(id);
  const second = await store.readParty(id);
  const third = await store.readParty(id);
  assert.equal(second.version, first.version, 'a second read moved the version again');
  assert.equal(third.version, first.version, 'the version depends on how often you look');
  assert.deepEqual(Object.keys(third.members), ['m-ana']);
});

await check('two stale members are evicted in one version bump, not two', async () => {
  const id = idc();
  const party = partyWith(
    { 'm-ana': {}, 'm-x': {}, 'm-y': {} },
    { id, code: 'AAA225', agesMs: { 'm-x': MEMBER_TTL_MS + 1, 'm-y': MEMBER_TTL_MS + 2 } },
  );
  await store.writeParty(id, party);
  const read = await store.readParty(id);
  assert.deepEqual(Object.keys(read.members), ['m-ana']);
  assert.equal(read.version, party.version + 1, 'one sweep produced more than one version');
});

await check('a device-less member is never evicted, however long since it was seen', async () => {
  // A seat in the party with no phone attached has no `lastSeen` to refresh
  // (state.js:531-538), so evicting on age would delete every child.
  const id = idc();
  await store.writeParty(
    id,
    partyWith(
      { 'm-ana': {}, 'm-kid': { deviceLess: true } },
      { id, code: 'AAA226', agesMs: { 'm-kid': MEMBER_TTL_MS * 10 } },
    ),
  );
  const read = await store.readParty(id);
  assert.ok(read.members['m-kid'], 'a device-less seat was evicted for being quiet');
});

await check('reading a party that does not exist is null, not a throw', async () => {
  assert.equal(await store.readParty('nope-nope'), null);
});

await check('a party past the whole-party TTL is deleted on read', async () => {
  const id = idc();
  const party = partyWith({ 'm-ana': {} }, { id, code: 'AAA227' });
  party.createdAt = Date.now() - PARTY_TTL_MS - 60_000;
  await store.writeParty(id, party);
  assert.equal(await store.readParty(id), null, 'an expired party was served');
  assert.equal(await store.resolveCode('AAA227'), null, 'its code still resolves');
});

/* -------------------------------------------------------------- the code */

console.log('codes');

await check('writeParty refreshes the code index alongside the party', async () => {
  const id = idc();
  await store.writeParty(id, partyWith({ 'm-ana': {} }, { id, code: 'BBB222' }));
  assert.equal(await store.resolveCode('BBB222'), id);
  assert.equal(await store.resolveCode('bbb-222'), id, 'a pasted code did not normalise');
  assert.equal(await store.resolveCode(' bbb 222 '), id);
});

await check('normalizeCode drops the characters the alphabet does not contain', () => {
  assert.equal(store.normalizeCode('abc234'), 'ABC234');
  assert.equal(store.normalizeCode('ABC-234'), 'ABC234');
  // No I, O, 0 or 1: the code is read aloud and typed in by hand.
  assert.equal(store.normalizeCode('AIOB01C2'), 'ABC2');
  assert.equal(store.normalizeCode('ABC234EXTRA'), 'ABC234');
  assert.equal(store.normalizeCode(null), '');
  assert.equal(store.normalizeCode(undefined), '');
});

await check('an unknown or empty code resolves to null', async () => {
  assert.equal(await store.resolveCode('ZZZ999'), null);
  assert.equal(await store.resolveCode(''), null);
  assert.equal(await store.resolveCode('!!!'), null);
});

await check('allocateParty reserves a code nobody else holds', async () => {
  const a = await store.allocateParty();
  const b = await store.allocateParty();
  assert.notEqual(a.partyId, b.partyId);
  assert.notEqual(a.code, b.code);
  assert.equal(a.code.length, 6);
  assert.ok(a.token.length > 0, 'no token was minted');
  // The code is reserved at allocation, before any party is written.
  assert.equal(await store.resolveCode(a.code), a.partyId);
});

await check('deleteParty takes the party, its code and its mailbox together', async () => {
  const id = idc();
  await store.writeParty(id, partyWith({ 'm-ana': {} }, { id, code: 'CCC222' }));
  await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: 'x' });
  assert.equal(await store.mailboxExists(id), true);

  assert.equal(await store.deleteParty(id), true);
  assert.equal(await store.readParty(id), null);
  assert.equal(await store.resolveCode('CCC222'), null);
  assert.equal(await store.mailboxExists(id), false);
  // Deleting twice is not an error, and reports that there was nothing to do.
  assert.equal(await store.deleteParty(id), false);
});

await check('partyExists answers without paying for the eviction write-back', async () => {
  const id = idc();
  const party = partyWith(
    { 'm-ana': {}, 'm-gone': {} },
    { id, code: 'CCC223', agesMs: { 'm-gone': MEMBER_TTL_MS + 1 } },
  );
  await store.writeParty(id, party);
  const versionBefore = party.version;
  assert.equal(await store.partyExists(id), true);
  // The stale member is still there: EXISTS must not have run a sweep.
  const raw = await store.readParty(id);
  assert.equal(
    raw.version,
    versionBefore + 1,
    'partyExists performed the eviction that readParty is supposed to',
  );
  assert.equal(await store.partyExists('nope-nope'), false);
});

/* ------------------------------------------------------------- mailbox -- */

console.log('mailbox');

await check('messages come back newer than the cursor, in order, with a high-water mark', async () => {
  const id = idc();
  const first = await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: '1' });
  const second = await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: '2' });
  const third = await store.appendMailbox(id, { from: 'b', to: 'a', kind: 'env', data: '3' });
  assert.deepEqual([first, second, third], [1, 2, 3], 'seq is not a dense counter');

  const all = await store.readMailbox(id, 0);
  assert.deepEqual(all.messages.map((m) => m.data), ['1', '2', '3']);
  assert.equal(all.seq, 3);

  const tail = await store.readMailbox(id, 2);
  assert.deepEqual(tail.messages.map((m) => m.data), ['3'], 'the cursor was not exclusive');
  assert.equal(tail.seq, 3, 'the high-water mark moved with the cursor');

  const caughtUp = await store.readMailbox(id, 3);
  assert.deepEqual(caughtUp.messages, [], 'a caught-up poller still transferred messages');
  assert.equal(caughtUp.seq, 3);
});

await check('an unknown mailbox reads empty at seq 0', async () => {
  assert.deepEqual(await store.readMailbox('nope-nope', 0), { messages: [], seq: 0 });
});

await check('the payload is carried opaquely — nothing reads or reshapes it', async () => {
  const id = idc();
  const data = { sealed: 'AAAA', nested: [1, { deep: true }] };
  await store.appendMailbox(id, { from: 'a', to: 'b', kind: 'env', data });
  const { messages } = await store.readMailbox(id, 0);
  assert.deepEqual(messages[0].data, data);
  assert.equal(messages[0].from, 'a');
  assert.equal(messages[0].to, 'b');
  assert.equal(messages[0].kind, 'env');
  assert.ok(Number.isFinite(messages[0].ts));
});

await check('a message older than the mailbox TTL is dropped on read', async () => {
  const id = idc();
  await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: 'old' });
  await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: 'new' });
  const { messages } = await store.readMailbox(id, 0);
  messages[0].ts = Date.now() - store.MAILBOX_TTL_MS - 1000; // the stored object

  const after = await store.readMailbox(id, 0);
  assert.deepEqual(after.messages.map((m) => m.data), ['new'], 'an expired message was served');
  assert.equal(after.seq, 2, 'the high-water mark fell back when a message expired');
});

await check('a negative or nonsense cursor reads from the beginning', async () => {
  const id = idc();
  await store.appendMailbox(id, { from: 'a', to: '*', kind: 'env', data: '1' });
  for (const since of [-5, Number.NaN, undefined, null]) {
    const { messages } = await store.readMailbox(id, since);
    assert.equal(messages.length, 1, `cursor ${String(since)} lost a message`);
  }
});

/* ------------------------------------------------------- subscriptions -- */

console.log('subscriptions');

await check('a subscription is stored per endpoint and read back by party', async () => {
  const id = idc();
  assert.equal(await store.subscriptionsExist(id), false);
  await store.addSubscription(id, 'm-ana', { endpoint: 'https://push/1', keys: { a: 1 } });
  await store.addSubscription(id, 'm-ben', { endpoint: 'https://push/2', keys: { a: 2 } });
  assert.equal(await store.subscriptionsExist(id), true);

  const subs = await store.readSubscriptions(id);
  assert.equal(subs.length, 2);
  assert.deepEqual(subs.map((s) => s.memberId).sort(), ['m-ana', 'm-ben']);

  await store.removeSubscription(id, 'https://push/1');
  const left = await store.readSubscriptions(id);
  assert.deepEqual(left.map((s) => s.memberId), ['m-ben']);
});

await check('re-subscribing the same endpoint replaces rather than duplicates', async () => {
  const id = idc();
  await store.addSubscription(id, 'm-ana', { endpoint: 'https://push/same', keys: { a: 1 } });
  await store.addSubscription(id, 'm-ana', { endpoint: 'https://push/same', keys: { a: 9 } });
  const subs = await store.readSubscriptions(id);
  assert.equal(subs.length, 1, 'the same endpoint was stored twice');
});

/* ------------------------------------------------------------- metrics -- */

console.log('metrics');

await check('the counters move with the work, and reads are counted separately', async () => {
  const before = store.metrics();
  const id = idc();
  await store.writeParty(id, partyWith({ 'm-ana': {} }, { id, code: 'DDD222' }));
  await store.readParty(id);
  const after = store.metrics();
  assert.ok(after.party_reads > before.party_reads, 'reads are not counted');
  assert.ok(after.party_writes > before.party_writes, 'writes are not counted');
});

await check('an eviction is counted as members_evicted, once per member', async () => {
  const before = store.metrics().members_evicted;
  const id = idc();
  await store.writeParty(
    id,
    partyWith(
      { 'm-ana': {}, 'm-x': {}, 'm-y': {} },
      { id, code: 'DDD223', agesMs: { 'm-x': MEMBER_TTL_MS + 1, 'm-y': MEMBER_TTL_MS + 1 } },
    ),
  );
  await store.readParty(id);
  assert.equal(store.metrics().members_evicted, before + 2);
});

if (FAIL.length) {
  console.error(`server store tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`server store tests: ${PASS.length} passed`);
}
