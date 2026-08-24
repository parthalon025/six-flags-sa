#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { frameBounds } from '@party-tracker/shared/mapCamera.js';
import { overlayGeoJson } from '../../apps/party-tracker/lib/overlayGeo.js';
import { worldGeoJson } from '../../apps/party-tracker/lib/worldGeo.js';
import {
  LABEL_DY,
  PIN_LABEL_SIZE,
  PLACE_LABEL_SIZE,
  ZONE_LABEL_SIZE,
  markLabelStyle,
  layoutOverlayLabels,
  overlayChrome,
  overlayMarks,
} from '../../apps/party-tracker/lib/overlayMarks.js';

const overlay = {
  places: {
    features: [
      { id: 'beast', geometry: { coordinates: [-84.26, 39.34] }, properties: { id: 'beast', name: 'The Beast' } },
    ],
  },
  members: {
    features: [
      { id: 'phone-a', geometry: { coordinates: [-84.27, 39.35] }, properties: { id: 'phone-a', name: 'Sam', self: true } },
    ],
  },
  pins: {
    features: [
      { id: 'meet', geometry: { coordinates: [-84.25, 39.33] }, properties: { id: 'meet', kind: 'meet', label: 'Carousel' } },
    ],
  },
};

const marks = overlayMarks(overlay, ({ lng, lat }) => ({ x: lng * -1, y: lat }));
assert.equal(marks.length, 3);
assert.equal(marks.find((m) => m.kind === 'place').className, 'poiMarker');
assert.equal(marks.find((m) => m.kind === 'place').name, 'The Beast');
assert.equal(marks.find((m) => m.kind === 'place').label, undefined, 'overlayMarks does not decide names');
assert.equal(marks.find((m) => m.self).className, 'memMarker');
assert.equal(marks.find((m) => m.self).id, 'phone-a');
assert.equal(marks.find((m) => m.self).label, undefined);
assert.equal(marks.find((m) => m.kind === 'meet').className, 'meetPin');
assert.equal(marks.find((m) => m.kind === 'meet').label, undefined);
{
  const laid = layoutOverlayLabels(marks, null);
  assert.equal(laid.find((m) => m.kind === 'place').label, false, 'places stay unnamed until layout says so');
  assert.equal(laid.find((m) => m.self).label, true, 'Members keep their name without a zoom pass');
  assert.equal(laid.find((m) => m.kind === 'meet').label, true);
}
assert.deepEqual(
  overlayMarks(overlay, () => null),
  [],
  'a project that cannot place a point drops the mark rather than inventing 0,0',
);

{
  const overlay = {
    route: {
      features: [{
        geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34], [-84.25, 39.33]] },
        properties: { mode: 'path' },
      }],
    },
  };
  const project = ({ lng, lat }) => ({ x: lng * -1, y: lat });
  const chrome = overlayChrome(overlay, project, {
    alternatives: [{ index: 1, points: [[39.35, -84.27], [39.34, -84.26]] }],
    routeDone: [[39.35, -84.27], [39.345, -84.265]],
    puck: { lat: 39.35, lng: -84.27, course: 90 },
    rotation: 90,
  });
  assert.equal(chrome.paths.find((p) => p.className === 'routeLine').d.startsWith('M'), true);
  assert.equal(chrome.paths.some((p) => p.className === 'routeDone'), true);
  assert.equal(chrome.paths.some((p) => p.className === 'altLine'), true);
  /* Same wrap as test/app/functional.mjs "the map turns so the route runs up
     the screen": rotate 0 is straight ahead; rotate 180 is ~180° off. */
  const offAhead = (deg) => Math.abs(((deg + 540) % 360) - 180);
  assert.ok(offAhead(chrome.cone.rotate) <= 12, `course-up cone is ${chrome.cone.rotate}°, want ~0`);
  const noCourse = overlayChrome(overlay, project, {
    puck: { lat: 39.35, lng: -84.27 },
    rotation: 217,
  });
  assert.ok(offAhead(noCourse.cone.rotate) <= 12, `no-course cone is ${noCourse.cone.rotate}°, want ~0`);
  const compassWins = overlayChrome(overlay, project, {
    puck: { lat: 39.35, lng: -84.27, course: 200 },
    heading: 0,
    rotation: 0,
  });
  assert.ok(offAhead(compassWins.cone.rotate) <= 12, `compass cone is ${compassWins.cone.rotate}°, want ~0`);
  const direct = overlayChrome({
    route: { features: [{ geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34]] }, properties: { mode: 'direct' } }] },
  }, project);
  assert.equal(direct.paths[0].className, 'routeLine direct');
  const two = overlayChrome({
    route: {
      features: [
        { id: 'a', geometry: { coordinates: [[-84.27, 39.35], [-84.26, 39.34]] }, properties: { id: 'a' } },
        { id: 'b', geometry: { coordinates: [[-84.26, 39.34], [-84.25, 39.33]] }, properties: { id: 'b' } },
      ],
    },
  }, project);
  assert.deepEqual(two.paths.map((p) => p.id), ['a', 'b']);
}

{
  const place = (id, name, category, x, y) => ({
    kind: 'place',
    className: 'poiMarker',
    id,
    name,
    category,
    self: false,
    label: false,
    x,
    y,
  });
  const named = (marks) => marks.filter((m) => m.label).map((m) => m.id);

  // Park-wide: Zones and rides print; restrooms stay quiet. Two far-apart
  // coasters both fit. A Zone sits on its land, not under a pin.
  const overview = layoutOverlayLabels(
    [
      place('goliath', 'Goliath', 'coaster', 40, 40),
      place('poltergeist', 'Poltergeist', 'coaster', 200, 80),
      place('restrooms', 'Restrooms', 'restroom', 80, 90),
      { kind: 'member', className: 'memMarker', id: 'me', name: 'Sam', self: true, x: 120, y: 200 },
      { kind: 'zone', className: 'landMarker', id: 'zone:Rockville', name: 'Rockville', x: 350, y: 40 },
    ],
    { zoom: 13.2, latitude: 29.6, width: 390, height: 654 },
  );
  assert.deepEqual(named(overview).sort(), ['goliath', 'me', 'poltergeist', 'zone:Rockville']);
  assert.equal(overview.find((m) => m.id === 'goliath').pin, true);
  assert.equal(overview.find((m) => m.id === 'restrooms').pin, false, 'amenity discs wait for zoom');
  // sizeAtZoom(11, planZoom(1/mpp)) at z13.2 / 29.6°. Worked: mpp ≈ 7.239,
  // 1/mpp ≈ 0.138 → planZoom 2/12, scale max(0.74, 0.745) = 0.745, 11 × 0.745.
  assert.equal(overview.find((m) => m.id === 'goliath').radius, 8.195);
  assert.equal(overview.find((m) => m.id === 'restrooms').radius, 6.258);

  // Walking zoom: two coasters far apart both print. Two restrooms on the
  // same pixel do not — rank and collision drop the second.
  const close = layoutOverlayLabels(
    [
      place('goliath', 'Goliath', 'coaster', 40, 80),
      place('batman', 'BATMAN', 'coaster', 300, 400),
      place('wc-1', 'Restrooms', 'restroom', 180, 220),
      place('wc-2', 'Restrooms', 'restroom', 182, 221),
    ],
    { zoom: 17.8, latitude: 29.6, width: 390, height: 654 },
  );
  assert.deepEqual(named(close).sort(), ['batman', 'goliath', 'wc-1']);

  // A Go target prints even at park-wide zoom; a selected Place never does —
  // its name lives in the sheet.
  const promoted = layoutOverlayLabels(
    [
      place('goliath', 'Goliath', 'coaster', 40, 40),
      place('wc-1', 'Restrooms', 'restroom', 80, 90),
    ],
    { zoom: 13.2, latitude: 29.6, width: 390, height: 654, navId: 'wc-1', selectedId: 'goliath' },
  );
  assert.deepEqual(named(promoted), ['wc-1']);

  // Hysteresis: a name already shown survives a little below its enter line.
  const enterFood = layoutOverlayLabels(
    [place('nachos', 'Aztek The Ultimate Nachos', 'food', 100, 100)],
    { zoom: 16.6, latitude: 29.6, width: 390, height: 654 },
  );
  assert.equal(enterFood[0].label, true);
  const held = layoutOverlayLabels(
    [place('nachos', 'Aztek The Ultimate Nachos', 'food', 100, 100)],
    { zoom: 16.48, latitude: 29.6, width: 390, height: 654, shownIds: ['nachos'] },
  );
  assert.equal(held[0].label, true);
  const fresh = layoutOverlayLabels(
    [place('nachos', 'Aztek The Ultimate Nachos', 'food', 100, 100)],
    { zoom: 16.48, latitude: 29.6, width: 390, height: 654 },
  );
  assert.equal(fresh[0].label, false);
}

{
  const pois = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/six-flags-fiesta-texas.pois.json', import.meta.url)),
  );
  const bounds = { north: 29.60751, south: 29.59224, east: -98.60144, west: -98.61789 };
  const viewport = { width: 390, height: 654 };
  const framed = frameBounds(bounds, viewport);
  const overlay = overlayGeoJson({ pois }, { now: 1 });
  const project = ({ lng, lat }) => ({
    x: ((lng - bounds.west) / (bounds.east - bounds.west)) * viewport.width,
    y: ((bounds.north - lat) / (bounds.north - bounds.south)) * viewport.height,
  });
  const map = JSON.parse(
    readFileSync(new URL('../../apps/party-tracker/public/venues/six-flags-fiesta-texas.map.json', import.meta.url)),
  );
  const laid = overlayChrome(overlay, project, {
    layout: { zoom: framed.zoom, latitude: framed.center.lat, ...viewport },
    lands: worldGeoJson(map).lands,
  }).marks;
  const placeNames = laid.filter((m) => m.kind === 'place' && m.label);
  const zoneNames = laid.filter((m) => m.kind === 'zone' && m.label).map((m) => m.name);
  const restrooms = placeNames.filter((m) => m.category === 'restroom');
  const rides = placeNames.filter((m) => m.category === 'coaster' || m.category === 'ride');
  assert.ok(zoneNames.length >= 1, `zones printed ${zoneNames.join(', ')}`);
  assert.ok(zoneNames.includes('Rockville') || zoneNames.includes('DC Universe'), `a named land printed: ${zoneNames.join(', ')}`);
  assert.ok(rides.length >= 6, `ride names are the destination layer, got ${rides.length}: ${rides.map((m) => m.name).join(', ')}`);
  assert.equal(restrooms.length, 0, 'restrooms stay quiet at park-wide zoom');
  const amenityPins = laid.filter((m) => m.kind === 'place' && m.pin && m.category !== 'coaster' && m.category !== 'ride');
  const ridePins = laid.filter((m) => m.kind === 'place' && m.pin && (m.category === 'coaster' || m.category === 'ride'));
  assert.equal(amenityPins.length, 0, 'amenity discs stay off at park-wide zoom');
  assert.equal(ridePins.length, rides.length, 'a ride disc is a named ride, not every ride');
  assert.ok(placeNames.length < laid.filter((m) => m.kind === 'place').length, 'not every Place is named');
  assert.ok(laid.filter((m) => m.kind === 'place').length > 80, 'markers themselves still land');
}

{
  const painted = readFileSync(new URL('../../apps/party-tracker/components/ParkMapGl.jsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../../apps/party-tracker/app/globals.css', import.meta.url), 'utf8');
  assert.match(painted, /markLabelStyle/, 'the SVG reads the same kind style the grid claimed');
  assert.match(painted, /PoiMarker/, 'Place pins are the same glyphs the legend draws, not empty discs');
  assert.match(painted, /mark\.radius/, 'marker size is the zoom-scaled radius the layout claimed');
  assert.doesNotMatch(painted, /radius \?\? 8/, 'layout always set a radius; a fallback would hide a missing one');
  assert.match(painted, /drawsPin/, 'a Zone is a name on the land, not another black disc');
  assert.equal(markLabelStyle('zone').className, 'landLabel');
  assert.equal(markLabelStyle('zone').drawsPin, false);
  assert.equal(markLabelStyle('zone').dy, 0);
  assert.equal(markLabelStyle('place').dy, LABEL_DY);
  assert.match(painted, /--map-place-label.: `\$\{PLACE_LABEL_SIZE\}px`/, 'the SVG reads the same size the grid claimed');
  assert.match(painted, /--map-pin-label.: `\$\{PIN_LABEL_SIZE\}px`/);
  assert.match(painted, /--map-zone-label.: `\$\{ZONE_LABEL_SIZE\}px`/);
  assert.equal(PLACE_LABEL_SIZE, 16);
  assert.equal(PIN_LABEL_SIZE, 15);
  assert.equal(ZONE_LABEL_SIZE, 18);
  // Apple / Google: districts outrank POI names (tracked caps, no pin);
  // destinations outrank amenities. Colour rides the same palette as the pin.
  assert.ok(markLabelStyle('zone').size > markLabelStyle('place', 'coaster').size);
  assert.equal(markLabelStyle('place', 'coaster').size, 16);
  assert.equal(markLabelStyle('place', 'ride').size, 15);
  assert.equal(markLabelStyle('place', 'restroom').size, 14);
  assert.equal(markLabelStyle('place', 'shop').size, 13);
  assert.match(painted, /labelInk/, 'a Place name wears the category ink the pin already uses');
  assert.match(painted, /markLabelStyle\(mark\.kind,\s*mark\.category\)/, 'the painter asks the same style the grid claimed, including category');
  const iconR = 8;
  const gap = LABEL_DY - PLACE_LABEL_SIZE * 0.55 - iconR;
  assert.ok(gap >= 4, `label gap ${gap}px undercuts the disc`);
  const fallbackPx = (rule) => Number(rule.match(/font-size:\s*var\(--[^,]+,\s*([\d.]+)px\)/)?.[1]);
  const poi = css.match(/\.poiLabel\s*\{[^}]+\}/);
  const mem = css.match(/\.memName\s*\{[^}]+\}/);
  const land = css.match(/\.landLabel\s*\{[^}]+\}/);
  assert.equal(fallbackPx(poi?.[0] || ''), PLACE_LABEL_SIZE);
  assert.equal(fallbackPx(mem?.[0] || ''), PIN_LABEL_SIZE);
  assert.equal(fallbackPx(land?.[0] || ''), ZONE_LABEL_SIZE);
  assert.match(land?.[0] || '', /fill:\s*var\(--labelFill\)/, 'Zone names stay inked, not transparent');
  // pinDrop ends on `transform: none` with fill-mode both — if the same element
  // also carries the map position as an SVG transform attribute, the filled
  // frame can reset the pin to the origin. Position on the parent, animation
  // on the child, same split spotPin already uses.
  assert.match(
    painted,
    /translate\(\$\{mark\.x\},\$\{mark\.y\}\)[\s\S]*className=\{mark\.className\}/,
    'meetPin position and pinDrop animation must not share one <g>',
  );
  assert.doesNotMatch(
    css.match(/\.meetPin\s*\{[^}]+\}/)?.[0] || '',
    /transform-box/,
    'meetPin inner group carries no transform — no fill-box reference box needed',
  );
}

{
  const overlay = {
    places: {
      features: [{
        geometry: { coordinates: [-84.26, 39.34] },
        properties: { id: 'beast', name: 'The Beast' },
      }],
    },
  };
  const [mark] = overlayMarks(overlay, () => ({ x: 10.4, y: 20.6 }));
  assert.equal(mark.x, 10);
  assert.equal(mark.y, 21);
}

{
  // A closed square must not weight the repeated first corner twice.
  const lands = {
    features: [{
      properties: { name: 'Midway' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] },
    }],
  };
  const [zone] = overlayMarks({}, ({ lng, lat }) => ({ x: lng, y: lat }), { lands });
  assert.equal(zone.name, 'Midway');
  assert.equal(zone.x, 5);
  assert.equal(zone.y, 5);
}

console.log('overlay-marks: ok');
