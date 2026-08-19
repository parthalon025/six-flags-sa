#!/usr/bin/env node
/**
 * Thanks the finder — contribution store seam, memory mode (no DATABASE_URL).
 * The Postgres path shares the same contract; its dedupe is the table's
 * UNIQUE (contribution_id, thanker_id).
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

delete process.env.DATABASE_URL;

const { impactHelpedFor, insertContribution, thankContribution, thanksCountFor } = await import(
  '../../apps/party-tracker/lib/contributions/store.js'
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

console.log('\ncontribution thanks\n');

const finder = await insertContribution({
  authorId: 'usr_finder',
  venueId: 'kings-island',
  placeId: 'orion',
  kind: 'height',
  payload: { heightIn: 48 },
});

await check('first thanks counts for the finder and moves impact by exactly one', async () => {
  const before = await impactHelpedFor('usr_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_fan' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, true);
  assert.equal(r.thanksCount, 1);
  assert.equal(await impactHelpedFor('usr_finder'), before + 1);
});

await check('a repeat from the same thanker counts nothing and is not an error', async () => {
  const before = await impactHelpedFor('usr_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_fan' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, false);
  assert.equal(r.reason, 'repeat');
  assert.equal(r.thanksCount, 1);
  assert.equal(await impactHelpedFor('usr_finder'), before);
});

await check('a second guest counts again — impact is per thanker, not per tap', async () => {
  const before = await impactHelpedFor('usr_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_other' });
  assert.equal(r.counted, true);
  assert.equal(r.thanksCount, 2);
  assert.equal(await thanksCountFor(finder.id), 2);
  assert.equal(await impactHelpedFor('usr_finder'), before + 1);
});

await check('self-thanks never counts and never moves impact', async () => {
  const before = await impactHelpedFor('usr_finder');
  const r = await thankContribution({ contributionId: finder.id, thankerId: 'usr_finder' });
  assert.equal(r.ok, true);
  assert.equal(r.counted, false);
  assert.equal(r.reason, 'self');
  assert.equal(await impactHelpedFor('usr_finder'), before);
});

await check('unknown contribution and missing thanker are refused', async () => {
  const gone = await thankContribution({ contributionId: 'c_missing', thankerId: 'usr_fan' });
  assert.equal(gone.ok, false);
  assert.equal(gone.reason, 'not_found');
  const anon = await thankContribution({ contributionId: finder.id, thankerId: '' });
  assert.equal(anon.ok, false);
  assert.equal(anon.reason, 'thanker_required');
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) process.exit(1);
