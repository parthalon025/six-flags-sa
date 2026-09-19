#!/usr/bin/env node
/**
 * Build catalog parks workflow — app build gate parity with build-venue.yml (#401).
 *
 *   node test/scripts/build-top100-workflow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/build-top100.yml'), 'utf8');

const lintStep = workflow.match(
  /- name: Lint and test[\s\S]*?(?=\n      - name:|\n$)/,
)?.[0];
assert.ok(lintStep, 'lint and test step exists in build-top100.yml');
assert.match(lintStep, /npm run lint/, 'lint runs in the gate step');
assert.match(lintStep, /npm run test:unit/, 'unit tests run in the gate step');

const appBuildStep = workflow.match(
  /- name: Make sure the app still builds with it[\s\S]*?(?=\n      - name:|\n$)/,
)?.[0];
assert.ok(appBuildStep, 'app build step exists in build-top100.yml');
assert.match(
  appBuildStep,
  /npm run build -w @party-tracker\/app/,
  'app build runs the party-tracker workspace',
);
assert.doesNotMatch(
  appBuildStep,
  /if:/,
  'app build runs regardless of allow_uncertified',
);

const certifyIdx = workflow.indexOf('- name: Certify gate');
const appBuildIdx = workflow.indexOf('- name: Make sure the app still builds with it');
assert.ok(certifyIdx >= 0 && appBuildIdx > certifyIdx, 'app build follows certify gate');

const playwrightIdx = workflow.indexOf('playwright install chromium');
const catalogBuildIdx = workflow.indexOf('- name: Build catalog parks');
assert.ok(
  playwrightIdx >= 0 && catalogBuildIdx > playwrightIdx,
  'Playwright installs before catalog build (research stage uses browser by default, #410)',
);

console.log('ok build-top100-workflow app build gate');
