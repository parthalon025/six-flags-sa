#!/usr/bin/env node
/**
 * display-schema.json certification gate (ticket 18).
 *
 *   node test/builder/display-schema-gate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateDisplaySpec, loadDisplaySchema } from '../../packages/venue-builder/lib/display-schema-gate.mjs';

const schema = loadDisplaySchema();
assert.ok(schema.required.includes('surfaces'));

const kiSpec = JSON.parse(
  readFileSync(
    path.join('packages/venue-builder/data/venues/kings-island/display/layered-atlas.visual.json'),
    'utf8',
  ),
);
assert.equal(validateDisplaySpec(kiSpec).ok, true);

const bad = { version: 1, venue: 'x', skin: 'y' };
assert.equal(validateDisplaySpec(bad).ok, false);

console.log('display-schema-gate: ok');
