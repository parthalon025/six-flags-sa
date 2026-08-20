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

/* Reference Skins consume their baked worlds (ADR-0016): top-down plate on
   the mercator camera, drawn from the display pack under the live overlay.
   The builder ledger must bind each one to the kit that bakes its world,
   and a baked Skin hides no base layers — the base map stays whole when the
   image cannot load. pixel-tycoon stays on the live iso painter (asserted
   above), so ISO_MAP_TEMPLATES keeps its consumer. */
const ledger = JSON.parse(
  fs.readFileSync(new URL('../../packages/venue-builder/data/display/skins.json', import.meta.url)),
).skins;
assert.ok(ISO_MAP_TEMPLATES[tycoon.template], `${tycoon.template} is a registered iso recipe`);
for (const skin of ['layered-atlas', 'watercolor-quest']) {
  const map = resolveCustomMap(skin);
  assert.equal(map.renderer, 'baked');
  assert.equal(customMapCamera(map), 'mercator');
  assert.equal(map.world.projection, 'top-down', `${skin} declares its fallback projection`);
  assert.equal(hidesBaseLayer(map, 'building'), false);
  assert.equal(hidesBaseLayer(map, 'coaster'), false);
  assert.equal(showsBaseMap(map), true);
  assert.equal(ledger[skin].bakeKit, skin, `${skin} ledger binds the kit that bakes its world`);
}

/* The published pack sidecar is what the app actually fetches: projection
   and bounds must be present and sane for the seeded venue. */
const sidecar = JSON.parse(
  fs.readFileSync(new URL(
    '../../apps/party-tracker/public/venues/kings-island/display/watercolor-quest.world.json',
    import.meta.url,
  )),
);
assert.equal(sidecar.projection, 'top-down');
assert.equal(sidecar.file, 'watercolor-quest.world.png');
assert.ok(sidecar.bounds.west < sidecar.bounds.east && sidecar.bounds.south < sidecar.bounds.north);

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
