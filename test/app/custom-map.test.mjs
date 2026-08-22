#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CUSTOM_MAPS,
  CUSTOM_MAP_RENDERERS,
  assertCustomMap,
  customMapCamera,
  hidesBaseLayer,
  resolveCustomMap,
  showsBaseMap,
  worldImageRect,
} from '../../apps/party-tracker/lib/customMap.js';
import { localMetres } from '../../apps/party-tracker/lib/geo.js';
import { PREVIEW_SKINS } from '../../apps/party-tracker/lib/bandedWorldPreview.js';

assert.equal(resolveCustomMap('postcard'), null);
assert.equal(resolveCustomMap('day'), null);
assert.equal(resolveCustomMap('night'), null);
assert.equal(resolveCustomMap(null), null);

/* Slice h14 — ADR-0019 clause 6: "Iso retires from the map path. pixel-tycoon
   converts to top-down banded art with the iso flavor painted into the sprites
   ... plus a camera preset." So the Skin that carried the live iso painter now
   consumes a baked world like every other, hides nothing, and takes the same
   mercator camera. Its distinctness has to come from the kit and the camera
   preset instead, which is exactly the risk ADR-0021 clause 6 sends it first
   to find. */
const tycoon = resolveCustomMap('pixel-tycoon');
assert.equal(tycoon.id, 'pixel-tycoon');
assert.equal(tycoon.placement, 'overlay');
assert.equal(customMapCamera(tycoon), 'mercator');
assert.equal(tycoon.renderer, 'baked');
assert.equal(tycoon.world.projection, 'top-down');
assert.equal(tycoon.template, undefined, 'no iso template survives the conversion');
assert.equal(showsBaseMap(tycoon), true);
assert.equal(hidesBaseLayer(tycoon, 'building'), false, 'a baked Skin hides no base layer');
assert.equal(hidesBaseLayer(tycoon, 'coaster'), false);
assert.equal(hidesBaseLayer(tycoon, 'path'), false);
assert.equal(hidesBaseLayer(tycoon, 'park'), false);

/* The retirement is in the vocabulary, not only in the one declaration that
   used it. ADR-0021 reaffirms the rejection of "a true-iso path kept for
   pixel-tycoon" — if painted-iso plus a camera preset cannot carry the
   feeling, the answers are a kit redesign or retiring the Skin, "not two
   renderers forever". A schema that still accepted `iso` would let the second
   renderer back in as data, with no code change to notice. */
assert.deepEqual(CUSTOM_MAP_RENDERERS, ['baked'], 'baked is the only renderer on the map path');
assert.throws(() => assertCustomMap({ id: 'x', renderer: 'iso' }), /iso/, 'an iso renderer is refused');
assert.throws(() => assertCustomMap({ id: 'x', camera: 'iso' }), /iso/, 'an iso camera is refused');
assert.throws(() => assertCustomMap({ id: 'x', renderer: 'raymarched' }), /raymarched/);
assert.doesNotThrow(() => assertCustomMap({ id: 'x', renderer: 'baked', camera: 'mercator' }));
for (const spec of Object.values(CUSTOM_MAPS)) assert.doesNotThrow(() => assertCustomMap(spec), spec.id);

/* Reference Skins consume their baked worlds (ADR-0016): top-down plate on
   the mercator camera, drawn from the display pack under the live overlay.
   The builder ledger must bind each one to the kit that bakes its world,
   and a baked Skin hides no base layers — the base map stays whole when the
   image cannot load. */
const ledger = JSON.parse(
  fs.readFileSync(new URL('../../packages/venue-builder/data/display/skins.json', import.meta.url)),
).skins;
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

/* The first ship is three Skins (ADR-0021 clause 6), and each has to be a
   thing the app can actually paint: a custom map that resolves, a baked
   renderer, and a kit on disk for the Visual factory to bake it from. */
assert.equal(PREVIEW_SKINS.length, 3, 'one World x three contrasting Skins');
assert.equal(PREVIEW_SKINS[0], 'pixel-tycoon', 'pixel-tycoon goes first');
for (const skin of PREVIEW_SKINS) {
  const map = resolveCustomMap(skin);
  assert.ok(map, `${skin} resolves to a custom map`);
  assert.equal(map.renderer, 'baked', `${skin} paints a baked world`);
  assert.ok(
    fs.existsSync(new URL(`../../packages/venue-builder/data/display/kits/${skin}.json`, import.meta.url)),
    `${skin} has no kit for the Visual factory to bake`,
  );
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

/* Placement math for the baked <image>: worldImageRect feeds the renderer's
   own scale(1,-1) group nested in mapWorld's y-up scale(z,-z). The flips
   cancel, so image coords ARE screen coords (×z): the rect's top-left must
   land exactly where the outer transform puts the truth bounds' north-west
   corner, and bottom-right on the south-east corner. A transposed or
   mirrored implementation (y from the south edge, x from the east) fails
   these equalities — the regression the double-flip invites. */
{
  const { bounds } = sidecar;
  const origin = [0, 0];
  const [xW, yN] = localMetres(bounds.north, bounds.west, origin);
  const [xE, yS] = localMetres(bounds.south, bounds.east, origin);
  const outer = ([x, y]) => [x, -y]; // mapWorld's scale(z,-z) at z=1
  const rect = worldImageRect(bounds, origin);
  assert.ok(rect, 'sane bounds produce a rect');
  assert.deepEqual([rect.x, rect.y], outer([xW, yN]), 'top-left pins the NW truth corner');
  assert.deepEqual(
    [rect.x + rect.width, rect.y + rect.height],
    outer([xE, yS]),
    'bottom-right pins the SE truth corner',
  );
  assert.ok(rect.width > 0 && rect.height > 0, 'the world spans');
  assert.ok(rect.y < rect.y + rect.height, 'north is above south on a y-down screen');

  // A shifted venue origin translates the rect, never rescales it.
  const shifted = worldImageRect(bounds, [1000, 2000]);
  assert.ok(Math.abs(shifted.width - rect.width) < 1e-9);
  assert.ok(Math.abs(shifted.height - rect.height) < 1e-9);
  assert.ok(Math.abs(shifted.x - (rect.x - 1000)) < 1e-9);
  assert.ok(Math.abs(shifted.y - (rect.y + 2000)) < 1e-9);

  // Degenerate or transposed sidecars draw nothing, never a misplaced plate.
  assert.equal(worldImageRect(null), null);
  assert.equal(
    worldImageRect({ west: bounds.east, east: bounds.west, south: bounds.south, north: bounds.north }),
    null,
    'transposed east/west is refused',
  );
  assert.equal(
    worldImageRect({ west: bounds.west, east: bounds.east, south: bounds.north, north: bounds.south }),
    null,
    'transposed north/south is refused',
  );
  assert.equal(worldImageRect({ west: 0, east: 1, south: 0, north: Number.NaN }), null);
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
