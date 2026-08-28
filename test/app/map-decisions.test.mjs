#!/usr/bin/env node
/**
 * The map's drawn decisions, held to.
 *
 * Every row in `test/app/map-decisions.json` is a decision someone asked for
 * and then watched come back. This suite is the half that runs without a
 * browser: the style `bandedWorldStyle()` builds, over the venues that ship,
 * checked against every enforced row.
 *
 * The other half is in `functional.mjs` — the same registry, the same checker,
 * against the style a real MapLibre is drawing on a real phone. Neither is
 * enough on its own: this one cannot see a renderer that overrides paint, and
 * that one cannot see the venues it does not open.
 *
 * A decision that is not in the registry is a decision nothing stops from
 * reverting. When one is made, add the row here first.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { bandedWorldStyle, worldCaseLayer, worldLayer } from '../../apps/party-tracker/lib/mapViewStyle.js';
import { worldGeoJson } from '../../apps/party-tracker/lib/worldGeo.js';
import { mapPaint } from '../../apps/party-tracker/lib/world.js';
import {
  AREA_LAYER_IDS,
  checkMapDecisions,
  lineWidthAt,
  loadMapDecisions,
} from './lib/map-decisions.mjs';

const VENUES = new URL('../../apps/party-tracker/public/venues/', import.meta.url);
const registry = loadMapDecisions();

/* The registry itself, before anything is checked against it. A row with no
   rule and no question is a decision that was written down and then quietly
   stopped being enforced — the exact failure the file exists to prevent. */
for (const decision of registry.decisions) {
  assert.ok(decision.id, 'every decision carries an id');
  assert.ok(decision.asked, `${decision.id} records what was actually asked for`);
  assert.ok(decision.why, `${decision.id} records why`);
  if (decision.status === 'enforced') {
    assert.ok(decision.rule, `${decision.id} is enforced, so it names a rule`);
    assert.ok(registry.rules[decision.rule], `${decision.id} names rule \`${decision.rule}\`, which the registry documents`);
  } else {
    assert.equal(decision.status, 'pending', `${decision.id} is enforced or pending, nothing else`);
    assert.ok(decision.question, `${decision.id} is pending, so it records the question that blocks it`);
    assert.ok(decision.covers_layers?.length, `${decision.id} is pending, so it names the layers it would cover`);
  }
}

/* Enforced and pending together account for every area layer the World can
   carry. This is the assertion that makes the registry keep up with the code:
   add a polygon layer to WORLD_LAYERS and this fails until a decision claims
   it, rather than the layer shipping as an outline and nobody noticing. */
{
  const { failures } = checkMapDecisions(bandedWorldStyle({
    world: {
      id: 'coverage',
      bounds: { west: -1, south: -1, east: 1, north: 1 },
      geometry: worldGeoJson({ park: [{ r: [[0, 0], [0, 1], [1, 1]] }] }),
    },
  }));
  const orphans = failures.filter((f) => /no decision in map-decisions.json accounts for/.test(f));
  assert.deepEqual(orphans, [], orphans.join('\n'));
}

/* Every venue that ships, under the palette it ships with. A decision that
   holds at Kings Island and not at Cedar Point is not a decision that holds —
   and it is how the coaster weight was lost the first time, on the venue
   nobody opened. */
const maps = readdirSync(VENUES).filter((f) => f.endsWith('.map.json'));
assert.ok(maps.length >= 3, `expected the shipped venues, found ${maps.length}`);

let sawCoaster = 0;
let sawParking = 0;
for (const file of maps) {
  const map = JSON.parse(readFileSync(new URL(file, VENUES), 'utf8'));
  const geometry = worldGeoJson(map);
  const venue = file.replace('.map.json', '');
  for (const skin of ['trail', 'park-midnight', 'pixel-tycoon']) {
    const style = bandedWorldStyle({
      world: { id: venue, bounds: map.meta.bounds, geometry },
      palette: mapPaint(skin),
    });
    const { failures, checked } = checkMapDecisions(style, { decisions: registry });
    assert.deepEqual(failures, [], `${venue} under ${skin}:\n  ${failures.join('\n  ')}`);
    if (checked.includes('coaster')) sawCoaster += 1;
    if (checked.includes('parking')) sawParking += 1;
  }
}

/* The run has to have looked at the two layers this was asked about. Rules
   skip a layer a venue does not have, so a suite that checked only water
   parks would be green and prove nothing about coaster track. */
assert.ok(sawCoaster > 0, 'no shipped venue drew coaster track, so nothing checked the coaster decisions');
assert.ok(sawParking > 0, 'no shipped venue drew a parking lot, so nothing checked the parking decision');

/* The two decisions the registry was opened for, spelled out — so a reader of
   this file sees what the rules above are actually asserting, and so a rule
   quietly weakened to fit a regression still trips here. */
{
  const map = JSON.parse(readFileSync(new URL('kings-island.map.json', VENUES), 'utf8'));
  const style = bandedWorldStyle({
    world: { id: 'kings-island', bounds: map.meta.bounds, geometry: worldGeoJson(map) },
    palette: mapPaint('trail'),
  });
  const layer = (id) => style.layers.find((l) => l.id === worldLayer(id));

  // "roller coasters displayed more visual and thicker on the map"
  const coaster = layer('coaster');
  const path = layer('path');
  assert.equal(coaster.type, 'line');
  for (const zoom of [13, 14, 16, 18, 20]) {
    const track = lineWidthAt(coaster.paint['line-width'], zoom);
    const midway = lineWidthAt(path.paint['line-width'], zoom);
    assert.ok(track >= 3, `coaster track is ${track}px at z${zoom} — thinner than the 3px floor`);
    assert.ok(
      track > midway * 1.25,
      `coaster track (${track}px at z${zoom}) has to outweigh the midway (${midway}px), not match it`,
    );
  }
  assert.equal(coaster.layout['line-cap'], 'round', 'track is a rail, not a run of dashes with square ends');

  // "parking lots ... use shapes over just lines"
  assert.equal(layer('parking').type, 'fill', 'a parking lot is an area, drawn as one');
  assert.ok(layer('parking').paint['fill-color'], 'and it is filled, not merely outlined');

  // "walkways ... use shapes and smooth bends"
  const midway = layer('path');
  assert.equal(midway.layout['line-cap'], 'round', 'a walkway does not end square at every segment break');
  assert.equal(midway.layout['line-join'], 'round', 'a walkway curves at its bends rather than spiking');
  assert.ok(
    lineWidthAt(midway.paint['line-width'], 16) >= 2.4,
    'a walkway is a shape with width, not a hairline',
  );
  const casing = style.layers.find((l) => l.id === worldCaseLayer('path'));
  assert.ok(casing, 'and it keeps the casing that gives it an edge against the lawn');
  assert.equal(casing.layout['line-join'], 'round', 'the casing bends with the walkway, not against it');
  for (const id of ['service', 'slide', 'coaster', 'boundary']) {
    const way = layer(id);
    if (!way) continue;
    assert.equal(way.layout?.['line-join'], 'round', `${id} bends smoothly`);
  }

  // The general form, which is the part that survives the next new layer.
  for (const id of AREA_LAYER_IDS) {
    const built = layer(id);
    if (!built) continue;
    /* An area layer is either a shape, or the outline of a shape that is
       itself drawn below it — which is what `boundary` is over `park`. Both
       are accounted for in the registry; anything else is an area the map
       draws as a bare line. */
    const asEdgeOf = registry.decisions.find(
      (d) => d.rule === 'area-edge-drawn-as-outline' && d.params.layer === id,
    );
    if (asEdgeOf) {
      assert.equal(
        layer(asEdgeOf.params.shapeBeneath).type,
        'fill',
        `${id} is drawn as an outline only because ${asEdgeOf.params.shapeBeneath} is the shape under it`,
      );
      continue;
    }
    assert.equal(built.type, 'fill', `${id} is an area in truth and must be drawn as one`);
  }
}

/* Pending rows are printed, not swallowed. A decision waiting on an answer is
   still a decision, and a run that never mentions it is how it gets forgotten. */
for (const decision of registry.decisions.filter((d) => d.status === 'pending')) {
  console.log(`  PENDING ${decision.id} — "${decision.asked}"`);
  console.log(`          ${decision.question}`);
}

console.log('map-decisions.test: ok');
