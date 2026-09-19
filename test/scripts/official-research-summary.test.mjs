#!/usr/bin/env node
/**
 * Official site research summary — fleet JSON from venues:research --json.
 *
 *   node test/scripts/official-research-summary.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { summarizeOfficialResearchResults } from '../../scripts/lib/official-research-summary.mjs';

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

const fetchOnlyFleet = [
  {
    venue: { id: 'cedar-point', name: 'Cedar Point' },
    official: {
      siteCount: 12,
      matched: 8,
      errors: [],
      pages: [{ via: 'fetch' }],
      fetched: '2026-09-18',
    },
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

{
  const { exitCode, markdown } = summarizeOfficialResearchResults(fetchOnlyFleet);
  assert.equal(exitCode, 0, 'fetch-only fleet is still usable');
  assert.match(markdown, /fetch only/i);
  assert.match(markdown, /browser.*not used|no venue used playwright/i);
  assert.doesNotMatch(markdown, /Playwright browser fetch was used/i);
}

{
  const dir = mkdtempSync(join(tmpdir(), 'official-research-'));
  const badReport = join(dir, 'bad.json');
  writeFileSync(badReport, 'not-json');
  const result = spawnSync(
    process.execPath,
    ['scripts/official-research-summary.mjs', badReport],
    { cwd: join(import.meta.dirname, '../..'), encoding: 'utf8' },
  );
  assert.equal(result.status, 1, 'invalid report exits 1');
  assert.match(result.stdout, /could not parse research report/i);
}

console.log('ok official-research-summary');
