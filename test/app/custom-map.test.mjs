#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  customMapCamera,
  hidesBaseLayer,
  resolveCustomMap,
  showsBaseMap,
} from '../../apps/party-tracker/lib/customMap.js';
import { ISO_MAP_TEMPLATES } from '../../packages/shared/isoWorld.js';

assert.equal(resolveCustomMap('postcard'), null);
assert.equal(resolveCustomMap('day'), null);
assert.equal(resolveCustomMap('night'), null);
assert.equal(resolveCustomMap(null), null);

const tycoon = resolveCustomMap('pixel-tycoon');
assert.equal(tycoon.id, 'pixel-tycoon');
assert.equal(tycoon.placement, 'overlay');
assert.equal(customMapCamera(tycoon), 'iso');
assert.equal(tycoon.renderer, 'iso');
assert.equal(tycoon.template, 'rct-classic');
assert.equal(showsBaseMap(tycoon), true);
assert.equal(hidesBaseLayer(tycoon, 'building'), true);
assert.equal(hidesBaseLayer(tycoon, 'coaster'), true);
assert.equal(hidesBaseLayer(tycoon, 'path'), false);
assert.equal(hidesBaseLayer(tycoon, 'park'), false);

/* Reference Skins ride the shared iso renderer with their own templates.
   The display ledger's isoTemplate must agree with the app-side resolution,
   and both must name a registered recipe — the field has one consumer. */
const ledger = JSON.parse(
  fs.readFileSync(new URL('../../packages/venue-builder/data/display/skins.json', import.meta.url)),
).skins;
for (const [skin, template] of [
  ['layered-atlas', 'frisco-fields'],
  ['watercolor-quest', 'watercolor-quest'],
]) {
  const map = resolveCustomMap(skin);
  assert.equal(map.renderer, 'iso');
  assert.equal(map.template, template);
  assert.equal(customMapCamera(map), 'iso');
  assert.equal(hidesBaseLayer(map, 'building'), true);
  assert.ok(ISO_MAP_TEMPLATES[template], `${template} is a registered iso recipe`);
  assert.equal(ledger[skin].isoTemplate, template, `${skin} ledger names the app's template`);
}

assert.equal(showsBaseMap(null), true);
assert.equal(hidesBaseLayer(null, 'building'), false);
assert.equal(customMapCamera(null), 'mercator');

const plate = { id: 'hand-plate', placement: 'replace', camera: 'mercator' };
assert.equal(showsBaseMap(plate), false);
assert.equal(hidesBaseLayer(plate, 'path'), true);
assert.equal(hidesBaseLayer(plate, 'building'), true);
assert.equal(customMapCamera(plate), 'mercator');

const tint = { id: 'mist', placement: 'overlay' };
assert.equal(showsBaseMap(tint), true);
assert.equal(hidesBaseLayer(tint, 'building'), false);
assert.equal(customMapCamera(tint), 'mercator');

console.log('custom-map.test: ok');
