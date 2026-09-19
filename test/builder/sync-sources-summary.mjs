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

const tokenGapOnly = {
  'cedar-point': {
    'mapillary-api': { ok: true, meta: { gap: true } },
  },
  'kings-island': {
    'mapillary-api': { ok: true, meta: { gap: true } },
  },
};

const tokenGapWithRealFetch = {
  'cedar-point': {
    'mapillary-api': { ok: true, meta: { gap: true } },
    'parks-api': { ok: true },
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

{
  const { exitCode, markdown } = summarizeSyncResults(tokenGapOnly);
  assert.equal(exitCode, 0, 'token-gap skip is graceful, not unusable');
  assert.match(markdown, /mapillary-api.*skipped \(no token\)/i);
  assert.doesNotMatch(markdown, /mapillary-api.*\bok\b/i);
}

{
  const { exitCode, markdown } = summarizeSyncResults(tokenGapWithRealFetch);
  assert.equal(exitCode, 0, 'mixed skip and ok stays usable');
  assert.match(markdown, /mapillary-api.*skipped \(no token\)/i);
  assert.match(markdown, /parks-api.*\bok\b/i);
}

console.log('ok sync-sources-summary');
