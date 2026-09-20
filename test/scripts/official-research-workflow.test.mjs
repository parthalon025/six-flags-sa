#!/usr/bin/env node
/**
 * Scheduled official site research workflow (#410).
 *
 *   node test/scripts/official-research-workflow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/sync-official-research.yml'), 'utf8');

assert.match(workflow, /schedule:[\s\S]*cron:/, 'weekly cron schedule exists');
assert.match(workflow, /workflow_dispatch:/, 'manual dispatch exists');
assert.match(
  workflow,
  /playwright install chromium --with-deps/,
  'installs Chromium for JS-rendered listings',
);
assert.match(
  workflow,
  /venues:research[\s\S]*--all[\s\S]*--fetch[\s\S]*--browser/,
  'fleet browser research command',
);

const prStep = workflow.match(
  /- name: Open a draft pull request[\s\S]*?(?=\n      - name:|\n$)/,
)?.[0];
assert.ok(prStep, 'draft PR step exists');
assert.match(prStep, /official-research-pr\.mjs/, 'delegates PR open to scripts/official-research-pr.mjs');

const summaryStep = workflow.match(
  /- name: Summarize research results[\s\S]*?(?=\n      - name:)/,
)?.[0];
assert.ok(summaryStep, 'summary step exists');
assert.match(summaryStep, /official-research-summary/, 'uses official research summary module');

console.log('ok official-research-workflow');
