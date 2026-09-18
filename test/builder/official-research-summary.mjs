#!/usr/bin/env node
/**
 * Official site research summary — fleet JSON from venues:research --json.
 *
 *   node test/builder/official-research-summary.mjs
 */
import assert from 'node:assert/strict';
import { summarizeOfficialResearchResults } from '../../packages/venue-builder/lib/official-research-summary.mjs';

const cedarOk = [
  {
    venue: { id: 'cedar-point', name: 'Cedar Point' },
    official: {
      siteCount: 72,
      matched: 40,
      errors: [],
      pages: [{ via: 'browser' }],
      fetched: '2026-09-18',
    },
  },
];

const oneVenueFails = [
  {
    venue: { id: 'cedar-point', name: 'Cedar Point' },
    official: { siteCount: 72, matched: 40, errors: [], pages: [{ via: 'browser' }], fetched: '2026-09-18' },
  },
  {
    venue: { id: 'empty-park', name: 'Empty Park' },
    official: { siteCount: 0, matched: 0, errors: ['timeout'], pages: [], fetched: null },
  },
];

const everyVenueFails = [
  {
    venue: { id: 'cedar-point', name: 'Cedar Point' },
    official: { siteCount: 0, matched: 0, errors: ['down'], pages: [], fetched: null },
  },
];

{
  const { exitCode, markdown } = summarizeOfficialResearchResults(cedarOk);
  assert.equal(exitCode, 0, 'venue with listings exits 0');
  assert.match(markdown, /cedar-point.*ok/i);
  assert.match(markdown, /browser/i);
}

{
  const { exitCode, markdown } = summarizeOfficialResearchResults(oneVenueFails);
  assert.equal(exitCode, 0, 'partial venue failure still usable');
  assert.match(markdown, /cedar-point.*ok/i);
  assert.match(markdown, /empty-park.*fail/i);
}

{
  const { exitCode, markdown } = summarizeOfficialResearchResults(everyVenueFails);
  assert.equal(exitCode, 1, 'every venue failed');
  assert.match(markdown, /unusable/i);
}

{
  const { exitCode } = summarizeOfficialResearchResults([]);
  assert.equal(exitCode, 1, 'empty fleet is unusable');
}

console.log('ok official-research-summary');
