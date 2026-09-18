#!/usr/bin/env node
/**
 * External source sync summary — fleet JSON from venues:sync-sources --json.
 *
 *   node test/builder/sync-sources-summary.mjs
 */
import assert from 'node:assert/strict';
import { summarizeSyncResults } from '../../packages/venue-builder/lib/sync-sources-summary.mjs';

const cedarOk = {
  'cedar-point': {
    'parks-api': { ok: true },
    'queue-times': { ok: true },
  },
};

const oneAdapterFailsEverywhere = {
  'cedar-point': {
    'parks-api': { ok: false, error: 'timeout' },
    'queue-times': { ok: true },
  },
  'kings-island': {
    'parks-api': { ok: false, error: 'timeout' },
    'queue-times': { ok: true },
  },
};

const everyAdapterFails = {
  'cedar-point': {
    'parks-api': { ok: false, error: 'down' },
    'queue-times': { ok: false, error: 'down' },
  },
};

{
  const { exitCode, markdown } = summarizeSyncResults(cedarOk);
  assert.equal(exitCode, 0, 'all ok exits 0');
  assert.match(markdown, /parks-api.*ok/i);
}

{
  const { exitCode, markdown } = summarizeSyncResults(oneAdapterFailsEverywhere);
  assert.equal(exitCode, 0, 'partial adapter failure still usable');
  assert.match(markdown, /parks-api.*fail/i);
  assert.match(markdown, /queue-times.*ok/i);
}

{
  const { exitCode, markdown } = summarizeSyncResults(everyAdapterFails);
  assert.equal(exitCode, 1, 'every adapter failed everywhere');
  assert.match(markdown, /unusable/i);
}

{
  const { exitCode } = summarizeSyncResults({});
  assert.equal(exitCode, 1, 'empty fleet is unusable');
}

console.log('ok sync-sources-summary');
