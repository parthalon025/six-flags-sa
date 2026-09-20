#!/usr/bin/env node
/**
 * Scheduled external source sync workflow (#405).
 *
 *   node test/scripts/sync-sources-workflow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/sync-external-sources.yml'), 'utf8');

assert.match(workflow, /schedule:[\s\S]*cron:/, 'weekly cron schedule exists');
assert.match(workflow, /workflow_dispatch:/, 'manual dispatch exists');
assert.match(
  workflow,
  /venues:sync-sources[\s\S]*--all[\s\S]*--fetch[\s\S]*--sources[\s\S]*parks-api,queue-times,wikidata/,
  'fleet fetch sync limited to #405 caches (ParksAPI, Queue-Times, Wikidata)',
);

const prStep = workflow.match(
  /- name: Open a draft pull request[\s\S]*?(?=\n      - name:|\n$)/,
)?.[0];
assert.ok(prStep, 'draft PR step exists');
assert.match(prStep, /gh pr create --draft/, 'opens a draft PR');
assert.match(prStep, /OVERRIDE_DIR/, 'git add uses venue-builder OVERRIDE_DIR path');
assert.match(prStep, /\*-cache\.json/, 'git add targets cache sidecars');
assert.match(prStep, /git diff --cached --quiet/, 'no PR when nothing changed');

const summaryStep = workflow.match(
  /- name: Summarize sync results[\s\S]*?(?=\n      - name:)/,
)?.[0];
assert.ok(summaryStep, 'summary step exists');
assert.match(summaryStep, /sync-sources-summary/, 'uses sync summary module');

console.log('ok sync-sources-workflow');
