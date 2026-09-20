#!/usr/bin/env node
/**
 * Official research draft PR helpers (#410).
 *
 *   node test/scripts/official-research-pr.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  composeOfficialResearchPrBody,
  officialCacheAddPattern,
  officialResearchBranchName,
  officialResearchCommitMessage,
} from '../../scripts/lib/official-research-pr.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

assert.equal(officialResearchBranchName(12345), 'sync/official-research-12345');

const pattern = officialCacheAddPattern('/data/venues');
assert.equal(pattern, '/data/venues/*/official-cache.json');

const msg = officialResearchCommitMessage('run-99');
assert.equal(msg.title, 'Sync official site research caches');
assert.match(msg.body, /run-99/);

const body = composeOfficialResearchPrBody({
  serverUrl: 'https://github.com',
  repository: 'org/repo',
  runId: 42,
  summaryMarkdown: '## Official site research\n\nAll ok.',
});
assert.match(body, /actions\/runs\/42/);
assert.match(body, /## Official site research/);

const workflow = readFileSync(join(root, '.github/workflows/sync-official-research.yml'), 'utf8');
assert.match(workflow, /node scripts\/official-research-pr\.mjs/, 'workflow delegates PR open to script');

console.log('ok official-research-pr');
