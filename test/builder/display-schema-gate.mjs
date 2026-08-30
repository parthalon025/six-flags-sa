#!/usr/bin/env node
/**
 * display-schema.json certification gate (ticket 18).
 *
 *   node test/builder/display-schema-gate.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  landToneErrors,
  loadDisplaySchema,
  validateDisplaySpec,
} from '../../packages/venue-builder/lib/display-schema-gate.mjs';

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

/* -- landTones: the retired shape is a failure, not a silent downgrade (#31) -- */

assert.deepEqual(landToneErrors(undefined), [], 'a spec with no Zone tones is not a shape error');
assert.deepEqual(
  landToneErrors({ 'Coney Mall': { day: { fill: '#F1EAE4', stroke: '#2A231D', label: '#1C140C' } } }),
  [],
  'the per-role shape passes',
);

// What pixel-tycoon's pack carried: a bare hex per mode, from before 5e2cebc.
const retired = landToneErrors({ 'Coney Mall': { day: '#F1EAE4', night: '#2A231D' } });
assert.equal(retired.length, 2, 'every mode on the retired shape is reported');
assert.match(retired[0], /retired flat shape/);
assert.match(retired[0], /venues:display/, 'the failure says how to fix it');
assert.equal(validateDisplaySpec({ ...kiSpec, landTones: { z: { day: '#FFFFFF' } } }).ok, false);

assert.match(landToneErrors({ z: { day: { fill: '#FFFFFF', stroke: '#000000' } } })[0], /\.label: not a #rrggbb hex/);
assert.match(landToneErrors({ z: { dusk: { fill: '#FFFFFF' } } })[0], /not a mode a Skin paints/);
assert.match(landToneErrors({ z: 'blue' })[0], /must be keyed by mode/);

/* Every spec that ships, builder-side and published. A shape gate that only
   ever reads one hand-picked fixture is how the last one got past. */
const specRoots = [
  'packages/venue-builder/data/venues',
  'apps/party-tracker/public/venues',
];
let swept = 0;
for (const root of specRoots) {
  if (!existsSync(root)) continue;
  for (const venue of readdirSync(root)) {
    const dir = path.join(root, venue, 'display');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.visual.json')) continue;
      const at = path.join(dir, file);
      const result = validateDisplaySpec(JSON.parse(readFileSync(at, 'utf8')));
      assert.equal(result.ok, true, `${at}: ${(result.errors || []).join('; ')}`);
      swept += 1;
    }
  }
}
assert.ok(swept >= 7, `only ${swept} committed visual specs were swept — did the tree move?`);

console.log(`display-schema-gate: ok (${swept} committed visual specs)`);
