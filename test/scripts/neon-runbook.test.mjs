#!/usr/bin/env node
/**
 * Neon runbook (#440) — docs seam: guide page exists, is linked, covers pool tuning.
 *
 *   node test/scripts/neon-runbook.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '../..');
const runbook = join(root, 'docs/guide/neon.md');
const guideIndex = join(root, 'docs/guide/index.md');

const text = readFileSync(runbook, 'utf8');
const index = readFileSync(guideIndex, 'utf8');

assert.match(index, /neon\.md/, 'guide index links to neon runbook');

const required = [
  'PG_POOL_MAX',
  'pooled endpoint',
  'connection exhaustion',
  '/api/ready',
  'pingPostgres',
  '@neondatabase/serverless',
  'docker compose',
];

for (const phrase of required) {
  assert.match(text, new RegExp(phrase, 'i'), `runbook mentions ${phrase}`);
}

assert.match(text, /default.*4|4.*default/i, 'documents PG_POOL_MAX default of 4');

console.log('neon-runbook.test.mjs: ok');
