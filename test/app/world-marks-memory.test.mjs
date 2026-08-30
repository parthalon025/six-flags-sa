#!/usr/bin/env node
/**
 * lib/worldMarks.js — memory backend.
 *
 * world-marks.test.mjs forces the Redis path (the #384 fix's whole point);
 * this file is the memory-backend counterpart, run in a separate process so
 * `usingRedis` reads false at import time. Mainly a pin on the mutateVenueWorld
 * refactor that made the memory path route through saveVenueWorld rather than
 * writing `mem.byVenue` directly a second time.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

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
const worldMarks = await import(`${APP}lib/worldMarks.js`);

assert.equal(store.usingRedis, false, 'this file needs the memory path');

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

console.log('\n--- worldMarks: memory backend ---');

await check('a Mark posted lands in the venue World and is readable back', async () => {
  const world = await worldMarks.postVenueMark('kings-island-mem', {
    id: 'm1', type: 'beacon', placeId: null, lat: 1, lng: 1, authorId: 'p1', authorPartyId: 'party-1', now: 1,
  });
  assert.equal(world.marks.length, 1);
  const reloaded = await worldMarks.loadVenueWorld('kings-island-mem');
  assert.equal(reloaded.marks[0].id, 'm1');
});

await check('two sequential Marks against the same venue both land', async () => {
  await worldMarks.postVenueMark('cedar-point-mem', {
    id: 'a', type: 'sign', placeId: null, lat: 1, lng: 1, authorId: 'p1', authorPartyId: null, phrase: 'Rest here', now: 1,
  });
  await worldMarks.postVenueMark('cedar-point-mem', {
    id: 'b', type: 'sign', placeId: null, lat: 2, lng: 2, authorId: 'p2', authorPartyId: null, phrase: 'Nice view', now: 2,
  });
  const world = await worldMarks.loadVenueWorld('cedar-point-mem');
  assert.deepEqual(world.marks.map((m) => m.id).sort(), ['a', 'b']);
});

await check('a Thanks lands on the Mark it targets', async () => {
  await worldMarks.postVenueMark('big-kahunas-mem', {
    id: 'target', type: 'beacon', placeId: null, lat: 1, lng: 1, authorId: 'p1', authorPartyId: 'party-1', now: 1,
  });
  await worldMarks.postVenueThanks('big-kahunas-mem', { profileId: 'p2', partyId: 'party-2', targetId: 'target', now: 2 });
  const world = await worldMarks.loadVenueWorld('big-kahunas-mem');
  assert.equal(world.thanks.length, 1);
  assert.deepEqual(world.marks.find((m) => m.id === 'target').evidenceParties.sort(), ['party-1', 'party-2']);
});

if (FAIL.length) {
  console.error(`world-marks memory tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`world-marks memory tests: ${PASS.length} passed`);
}
