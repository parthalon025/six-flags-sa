#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  autoPalette,
  categoriesForGate,
  fogMapStyle,
  markerDeclutterPriority,
  markerWantsLabel,
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
assert.match(landTint('Rivertown', 'layered-atlas').fill, /^#/);
assert.match(landTint('Rivertown', 'watercolor-quest').fill, /^#/);
assert.notEqual(
  landTint('Rivertown', 'layered-atlas').fill,
  landTint('Rivertown', 'night').fill,
  'reference atlas does not inherit dark district fills',
);

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

console.log('map-visual.test: ok');
