#!/usr/bin/env node
/* The startup performance contract for the map screen.
 *
 * Half of this suite used to assert the SVG world viewer's own structure — the
 * static-world memo boundary, viewport culling and its quantised cull cell,
 * the low-zoom path-casing skip. Slice h18 retired that renderer
 * (`components/ParkMapSvg.jsx` is gone, ADR-0019 clause 3), and those rows
 * went with the file they described: the ported path draws through MapLibre,
 * where culling, collision and LOD are the engine's and are asserted through
 * the map view seam (`test/app/map-view.test.mjs`) instead of by reading a
 * component's source.
 *
 * What is left is the half that was never about the renderer: page.js must not
 * do non-critical startup work before the map is on screen. That is still a
 * source-shape assertion because the thing it guards — *when* a piece of
 * startup work runs — does not show up in any value a unit test can read back.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(
  new URL('../../apps/party-tracker/app/page.js', import.meta.url),
  'utf8',
);

assert.match(
  page,
  /const \[uiReady, setUiReady\] = useState\(false\)/,
  'page should gate non-critical startup work',
);
assert.match(
  page,
  /requestIdleCallback/,
  'page should prefer browser idle time for deferred startup work',
);
assert.match(
  page,
  /useWeather\(venue\?\.center \?\? null, uiReady\)/,
  'weather polling should wait for the idle gate',
);
assert.match(
  page,
  /if \(!uiReady\) return undefined;\s*if \('serviceWorker' in navigator\)/,
  'service-worker notification wiring should wait for the idle gate',
);
assert.match(
  page,
  /if \(!uiReady\) return;\s*try \{\s*const saved = JSON\.parse\(localStorage\.getItem\(PUSH_PREFS_KEY\)/,
  'push preference and permission wiring should wait for the idle gate',
);

/* And the renderer that carried the retired rows is really gone, rather than
   still on disk with nothing importing it. */
assert.throws(
  () => readFileSync(new URL('../../apps/party-tracker/components/ParkMapSvg.jsx', import.meta.url)),
  /ENOENT/,
  'the SVG world viewer retired with slice h18',
);

console.log('map performance contract: ok');
