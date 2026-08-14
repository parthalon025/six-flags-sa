#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const parkMap = readFileSync(
  new URL('../../apps/party-tracker/components/ParkMap.jsx', import.meta.url),
  'utf8',
);
const page = readFileSync(
  new URL('../../apps/party-tracker/app/page.js', import.meta.url),
  'utf8',
);

assert.match(
  parkMap,
  /const ParkMapStaticWorld = memo\(function ParkMapStaticWorld/,
  'static venue geometry should live behind a memo boundary',
);
assert.match(
  parkMap,
  /world\?\.path\.length\s*>\s*80/,
  'large path sets should enable viewport culling at overview zoom',
);
assert.match(
  parkMap,
  /const cullPad = lowZoom \? 1\.2 : 0\.55/,
  'overview culling should retain a larger off-screen pad',
);
assert.match(
  parkMap,
  /const cullEnabled = world\?\.path\.length > 80 \|\| \(showDetail && z >= 1\.2\)/,
  'culling should use a threshold boolean instead of raw zoom as a memo dependency',
);
assert.match(
  parkMap,
  /\}, \[cullEnabled, cullCellX, cullCellY, cullScaleBand\]\)/,
  'cull membership should stay stable within a quantized pan and zoom cell',
);
assert.match(
  parkMap,
  /\{!lowZoom && \(\s*<g className="lyr-pathcase">/,
  'path casing should be omitted at low zoom',
);

const staticWorldStart = parkMap.indexOf('const ParkMapStaticWorld = memo(');
const parkMapStart = parkMap.indexOf('function ParkMap(', staticWorldStart);
const staticWorld = parkMap.slice(staticWorldStart, parkMapStart);
for (const movingProp of ['me', 'members', 'heading', 'selected', 'route', 'puck']) {
  assert.doesNotMatch(
    staticWorld,
    new RegExp(`\\b${movingProp}\\b`),
    `static world must not depend on moving prop "${movingProp}"`,
  );
}

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

console.log('map performance contract: ok');
