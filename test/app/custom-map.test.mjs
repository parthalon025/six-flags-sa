#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  customMapCamera,
  hidesBaseLayer,
  resolveCustomMap,
  showsBaseMap,
} from '../../apps/party-tracker/lib/customMap.js';

assert.equal(resolveCustomMap('postcard'), null);
assert.equal(resolveCustomMap('day'), null);
assert.equal(resolveCustomMap('night'), null);
assert.equal(resolveCustomMap(null), null);

const tycoon = resolveCustomMap('pixel-tycoon');
assert.equal(tycoon.id, 'pixel-tycoon');
assert.equal(tycoon.placement, 'overlay');
assert.equal(customMapCamera(tycoon), 'iso');
assert.equal(showsBaseMap(tycoon), true);
assert.equal(hidesBaseLayer(tycoon, 'building'), true);
assert.equal(hidesBaseLayer(tycoon, 'coaster'), true);
assert.equal(hidesBaseLayer(tycoon, 'path'), false);
assert.equal(hidesBaseLayer(tycoon, 'park'), false);

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
