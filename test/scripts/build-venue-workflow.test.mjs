#!/usr/bin/env node
/**
 * Build-a-venue workflow — the bake step must exercise the iso tier in CI (#523).
 *
 *   node test/scripts/build-venue-workflow.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/build-venue.yml'), 'utf8');

const bakeStep = workflow.match(
  /- name: Bake the game map against its reference contract[\s\S]*?(?=\n      - name:)/,
)?.[0];
assert.ok(bakeStep, 'bake step exists in build-venue.yml');

assert.match(
  bakeStep,
  /--target iso/,
  'bake step runs an iso-target render',
);
assert.match(
  bakeStep,
  /--rotation 0/,
  'bake step pins rotation 0 for the iso gate',
);
assert.match(
  bakeStep,
  /--kit rpg-overworld[\s\S]*--target iso[\s\S]*display-pack\.mjs/,
  'iso bake runs after flat kits and before display-pack',
);

console.log('ok build-venue-workflow iso bake gate');
