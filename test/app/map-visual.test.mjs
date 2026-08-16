#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  autoPalette,
  categoriesForGate,
  fogMapStyle,
  markerDeclutterPriority,
  resolvePalette,
  rosterHasDeviceLess,
  SHIP_SKIN_IDS,
} from '../../apps/party-tracker/lib/mapVisual.js';
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

console.log('map-visual.test: ok');
