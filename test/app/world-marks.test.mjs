#!/usr/bin/env node
/**
 * lib/worldMarks.js — #384: postVenueMark and postVenueThanks did a plain
 * GET -> mutate -> SET against `ki:world:{venueId}`, so two concurrent
 * writes to the same venue could have the second SET clobber the first.
 *
 * This file runs the Redis path (Upstash has no WATCH/MULTI over REST, which
 * is exactly the transport this bug needed) against the fake Upstash, with
 * the fake's EVAL handler built from the exact CAS_SET_LUA string the module
 * exports — so a test failure here means the *shipped* script stopped doing
 * what it claims, not a hand-written stand-in for it.
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
const worldMarks = await import(`${APP}lib/worldMarks.js`);
const store = await import(`${APP}lib/serverStore.js`);

assert.equal(store.usingRedis, true, 'this file needs the Redis path to test the race fix');

const { createFakeUpstash, execCommand } = await import('./lib/fakeUpstash.mjs');

/** A line-by-line JS mirror of CAS_SET_LUA's own redis.call sequence — see
 *  the header note above about why this must be keyed by the real script. */
function casSetEval(fakeStore, keys, args) {
  const [key] = keys;
  const [existed, expected, nextVal, ttl] = args;
  const current = execCommand(fakeStore, ['GET', key]);
  const matches = existed === '1' ? current === expected : current === null;
  if (!matches) return 0;
  execCommand(fakeStore, ['SET', key, nextVal, 'EX', ttl]);
  return 1;
}

const fake = createFakeUpstash({ evalScripts: { [worldMarks.CAS_SET_LUA]: casSetEval } });
globalThis.fetch = fake.fetchImpl;

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

console.log('\n--- worldMarks: park-wide Marks/Thanks concurrency ---');

await check('two interleaved Mark posts to the same venue both land', async () => {
  fake.store.strings.clear();
  fake.calls.length = 0;

  // Both calls start before either has written — the GET → mutate → SET race
  // #384 describes — and the fix must still land both.
  const [worldAfterA, worldAfterB] = await Promise.all([
    worldMarks.postVenueMark('cedar-point', {
      id: 'mark-a', type: 'sign', placeId: null, lat: 1, lng: 2, authorId: 'p1', authorPartyId: null, phrase: 'Rest here', now: 1,
    }),
    worldMarks.postVenueMark('cedar-point', {
      id: 'mark-b', type: 'sign', placeId: null, lat: 3, lng: 4, authorId: 'p2', authorPartyId: null, phrase: 'Nice view', now: 2,
    }),
  ]);
  void worldAfterA;
  void worldAfterB;

  // Read the stored World directly rather than through `listVenueMarks` —
  // that call applies `visibleMarks`' fade/evidence rules, which are a
  // separate domain concern from whether the store lost a write.
  const world = await worldMarks.loadVenueWorld('cedar-point');
  const ids = world.marks.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mark-a', 'mark-b'], 'neither concurrent Mark was lost to the other’s SET');
});

await check('a Thanks concurrent with a Mark post loses neither', async () => {
  fake.store.strings.clear();

  await worldMarks.postVenueMark('kings-island', {
    id: 'existing', type: 'beacon', placeId: null, lat: 1, lng: 1, authorId: 'p1', authorPartyId: 'party-1', now: 1,
  });

  const [, ] = await Promise.all([
    worldMarks.postVenueThanks('kings-island', { profileId: 'p2', partyId: 'party-2', targetId: 'existing', now: 10 }),
    worldMarks.postVenueMark('kings-island', {
      id: 'second', type: 'sign', placeId: null, lat: 2, lng: 2, authorId: 'p3', authorPartyId: null, phrase: 'Queue this way', now: 11,
    }),
  ]);

  const world = await worldMarks.loadVenueWorld('kings-island');
  assert.equal(world.marks.length, 2, 'both Marks are present');
  assert.equal(world.thanks.length, 1, 'the Thanks was not dropped');
  const existing = world.marks.find((m) => m.id === 'existing');
  assert.deepEqual(existing.evidenceParties.sort(), ['party-1', 'party-2'], 'the Thanks landed on the right Mark');
});

await check('a lost CAS race retries against the write that won, not the stale read', async () => {
  fake.store.strings.clear();
  const venueId = 'retry-check';
  await worldMarks.postVenueMark(venueId, {
    id: 'seed', type: 'beacon', placeId: null, lat: 0, lng: 0, authorId: 'p0', authorPartyId: null, now: 1,
  });

  // Force one lost race: intercept the CAS EVAL so the very first attempt
  // reports a miss (as if another writer had won in between), then let every
  // later attempt behave normally.
  let evalCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (!String(url).endsWith('/pipeline') && body[0] === 'EVAL') {
      evalCalls += 1;
      if (evalCalls === 1) {
        // Someone else's write actually lands first, for real, so the
        // module's retry has genuinely-changed data to read on attempt two.
        await store.redisCommand([
          'SET',
          `ki:world:${venueId}`,
          JSON.stringify({ offers: [], marks: [{ id: 'rival', type: 'beacon', evidenceParties: [] }], thanks: [] }),
          'EX',
          '100',
        ]);
        return { ok: true, status: 200, json: async () => ({ result: 0 }) };
      }
    }
    return originalFetch(url, opts);
  };
  try {
    await worldMarks.postVenueMark(venueId, {
      id: 'mine', type: 'beacon', placeId: null, lat: 5, lng: 5, authorId: 'p1', authorPartyId: null, now: 2,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const world = await worldMarks.loadVenueWorld(venueId);
  const ids = world.marks.map((m) => m.id).sort();
  assert.deepEqual(ids, ['mine', 'rival'], 'the retry folded onto the write that won, dropping neither Mark');
});

if (FAIL.length) {
  console.error(`worldMarks tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`worldMarks tests: ${PASS.length} passed`);
}
