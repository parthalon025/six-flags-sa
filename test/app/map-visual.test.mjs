#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  autoPalette,
  categoriesForGate,
  fogMapStyle,
  markerDeclutterPriority,
  markerWantsLabel,
  zoneDeclutterPriority,
  resolvePalette,
  rosterHasDeviceLess,
  SHIP_SKIN_IDS,
} from '../../apps/party-tracker/lib/mapVisual.js';
import {
  LABEL_ZOOM_HYSTERESIS,
  labelWantedAtZoom,
  labelZoomFor,
} from '@party-tracker/shared/mapSymbols.js';
import { landTint } from '../../apps/party-tracker/lib/theme.js';
import { ledgerSkinFor, tonesFromSpec, zoneTonesUrl } from '../../apps/party-tracker/lib/zoneTones.js';
import { mapPaint } from '../../apps/party-tracker/lib/world.js';

assert.equal(autoPalette(Date.UTC(2026, 5, 15, 14, 0, 0)), 'day');
assert.equal(autoPalette(Date.UTC(2026, 5, 15, 21, 0, 0)), 'night');

assert.equal(resolvePalette({ paletteMode: 'auto', now: Date.UTC(2026, 5, 15, 14, 0, 0) }), 'day');
assert.equal(resolvePalette({ paletteMode: 'night', manualTheme: 'night' }), 'night');

const allPresent = new Set(['coaster', 'ride', 'gate', 'food', 'restroom', 'show', 'shop', 'parking']);
const withKids = categoriesForGate({ roster: [{ id: 'mia', device: false }], presentCategories: allPresent });
assert.ok(!withKids.has('show'));
assert.ok(withKids.has('coaster'));
assert.ok(rosterHasDeviceLess([{ id: 'x', device: false }]));

assert.equal(
  markerDeclutterPriority({ isNav: true, rank: 1 }),
  -900,
);
assert.equal(
  markerDeclutterPriority({ isPlanNext: true, rank: 1 }),
  -850,
);
assert.ok(markerDeclutterPriority({ isNav: true }) < markerDeclutterPriority({ isPlanNext: true }));

assert.ok(
  zoneDeclutterPriority({ wasShown: true, area: 10, index: 0 })
  < zoneDeclutterPriority({ wasShown: false, area: 1000, index: 0 }),
  'a Zone already on screen outranks a larger newcomer',
);
assert.ok(
  zoneDeclutterPriority({ wasShown: false, area: 1000, index: 0 })
  < zoneDeclutterPriority({ wasShown: false, area: 10, index: 1 }),
  'larger lands outrank smaller ones at the same shown state',
);

const fog = fogMapStyle(
  {
    fogMapEnabled: true,
    meters: { walkedByVenue: { ki: ['a'] }, venuePlaceCount: { ki: 4 } },
  },
  'ki',
);
assert.ok(fog && fog.saturate < 1);

assert.equal(SHIP_SKIN_IDS.includes('pixel-tycoon'), true);
assert.equal(SHIP_SKIN_IDS.includes('layered-atlas'), true);
assert.equal(SHIP_SKIN_IDS.includes('watercolor-quest'), true);

const tycoon = mapPaint('pixel-tycoon');
assert.equal(tycoon.traits.pixel, true);
assert.equal(tycoon.ground, '#4FA83A');
assert.equal(tycoon.midway, '#C8C8C0');
const land = landTint('Rivertown', 'pixel-tycoon');
assert.match(land.fill, /^hsl\(1\d{2} /);

/* A reference Skin restyles a Zone, and the colours come from that Skin's
   compiled pack rather than a table in app code. This is the phone-side half
   of the builder's "two Skins over one World paint its Zones differently":
   the same Zone, the same World, two published specs, two answers. */
{
  const { readFileSync } = await import('node:fs');
  const specOf = (skin) => JSON.parse(readFileSync(new URL(
    `../../packages/venue-builder/data/venues/kings-island/display/${skin}.visual.json`,
    import.meta.url,
  )));
  const tonesOf = (skin) => tonesFromSpec(specOf(skin));
  const atlas = tonesOf('layered-atlas');
  const watercolor = tonesOf('watercolor-quest');
  const midnight = tonesOf('park-midnight');
  for (const tones of [atlas, watercolor, midnight]) {
    assert.match(tones.Rivertown.fill, /^#[0-9A-F]{6}$/i, 'a published Zone tone is a hex');
  }
  assert.notEqual(atlas.Rivertown.fill, watercolor.Rivertown.fill, 'two Skins must not paint one Zone alike');
  assert.notEqual(atlas.Rivertown.fill, midnight.Rivertown.fill);
  assert.equal(landTint('Rivertown', 'layered-atlas', atlas).fill, atlas.Rivertown.fill);
  assert.equal(landTint('Rivertown', 'watercolor-quest', watercolor).fill, watercolor.Rivertown.fill);
  // Without the pack the app invents nothing per Skin — it falls to name-hue.
  assert.match(landTint('Rivertown', 'layered-atlas').fill, /^hsl\(/);
  // The Palettes map onto their ledger Skin ids; every other id is itself.
  assert.equal(ledgerSkinFor('day'), 'trail');
  assert.equal(ledgerSkinFor('night'), 'park-midnight');
  assert.equal(ledgerSkinFor('layered-atlas'), 'layered-atlas');
  assert.equal(zoneTonesUrl('kings-island', 'day'), '/venues/kings-island/display/trail.visual.json');
  assert.equal(zoneTonesUrl(null, 'day'), null);
}

/* markerWantsLabel is a policy layer over the shared zoom decision, not a
   fork of it: at every zoom around the enter threshold — including the band
   between enter - 0.18 and enter - 0.12 where an inlined constant once
   drifted — an unpinned marker must agree with labelWantedAtZoom exactly. */
for (const rank of [1, 2, 3, 4, 5]) {
  const enter = labelZoomFor(rank);
  const probes = [
    enter - LABEL_ZOOM_HYSTERESIS - 0.01,
    enter - LABEL_ZOOM_HYSTERESIS + 0.01,
    enter - 0.15, // inside the once-drifted band
    enter - 0.12,
    enter - 0.01,
    enter,
    enter + 0.01,
  ];
  for (const zPlan of probes) {
    for (const wasShown of [false, true]) {
      assert.equal(
        markerWantsLabel({ rank, zPlan, wasShown }),
        labelWantedAtZoom(rank, zPlan, wasShown),
        `rank ${rank} z ${zPlan.toFixed(2)} wasShown ${wasShown}`,
      );
    }
  }
}
assert.equal(
  markerWantsLabel({ rank: 3, zPlan: labelZoomFor(3) - 0.15, wasShown: true }),
  true,
  'canonical hysteresis (0.18) keeps a shown name inside the band',
);
assert.equal(markerWantsLabel({ isSelected: true, rank: 1, zPlan: 9, wasShown: true }), false);
assert.equal(markerWantsLabel({ isNav: true, rank: 5, zPlan: 0, wasShown: false }), true);
assert.equal(markerWantsLabel({ isPlanNext: true, rank: 5, zPlan: 0, wasShown: false }), true);
assert.equal(
  markerWantsLabel({ category: 'coaster', rank: 1, zPlan: 0, wasShown: false }),
  true,
  'coasters keep a name at park-wide zoom',
);
assert.equal(
  markerWantsLabel({ category: 'ride', rank: 2, zPlan: 0, wasShown: false }),
  true,
  'rides keep a name at park-wide zoom',
);
assert.equal(
  markerWantsLabel({ category: 'restroom', rank: 3, zPlan: 0, wasShown: false }),
  false,
  'restrooms still wait for zoom',
);


// The reference Skins' palette lives twice — the display ledger compiles the
// builder side, world.js paints the phone — so parity is asserted, not assumed.
{
  const { readFileSync } = await import('node:fs');
  const ledger = JSON.parse(
    readFileSync(new URL('../../packages/venue-builder/data/display/skins.json', import.meta.url)),
  ).skins;
  for (const id of ['layered-atlas', 'watercolor-quest']) {
    const colors = ledger[id].tokens.colors;
    const p = mapPaint(id);
    assert.equal(p.path.stroke, colors.path, `${id} path`);
    assert.equal(p.path.casing, colors.pathCasing, `${id} path casing`);
    assert.equal(p.ground, colors.ground, `${id} ground`);
    assert.equal(p.water.fill, colors.water, `${id} water`);
    assert.equal(p.grass.fill, colors.grass, `${id} grass`);
    assert.equal(p.building.fill, colors.building, `${id} building`);
    assert.equal(p.label.fill, colors.label, `${id} label`);
    assert.equal(p.structureEdge, colors.structureEdge, `${id} structure edge`);
    assert.equal(p.groundEdge, colors.groundEdge, `${id} ground edge`);
  }
}

console.log('map-visual.test: ok');
