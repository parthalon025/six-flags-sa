#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { zoomSweep, MIN_FPS_FLOOR } from '../../scripts/lib/map-perf-gate.mjs';

const parkMap = readFileSync(
  new URL('../../apps/party-tracker/components/ParkMapGl.jsx', import.meta.url),
  'utf8',
);
const vertical = readFileSync(
  new URL('../../scripts/ci/pre-merge-vertical.mjs', import.meta.url),
  'utf8',
);

assert.match(parkMap, /data-testid="park-map-gl"/, 'the shipped map exposes a test hook');
assert.match(parkMap, /__parkMapFps/, 'the shipped map records a frame trace the sweep can read');
assert.match(parkMap, /world\.center/, 'opening camera prefers the venue centre over the bbox centre');
assert.match(vertical, /runLiveZoomSweep|zoomSweep\(/, 'the vertical runs the live zoom sweep');

const missing = await zoomSweep({ minFps: MIN_FPS_FLOOR, throttle: 4 });
assert.equal(missing.ok, false, 'a sweep without a page is not a passing floor');
assert.equal(missing.reason, 'no-page');

const noSamples = await zoomSweep({
  minFps: MIN_FPS_FLOOR,
  throttle: 4,
  page: { evaluate: async () => null },
});
assert.equal(noSamples.ok, false, 'a page with no frame samples fails');
assert.equal(noSamples.reason, 'no-samples');

const low = await zoomSweep({
  minFps: MIN_FPS_FLOOR,
  throttle: 4,
  page: {
    evaluate: async (fn) => {
      globalThis.__parkMapFps = [12, 14, 10];
      return fn();
    },
  },
});
assert.equal(low.ok, false);
assert.ok(low.fps < MIN_FPS_FLOOR);

const high = await zoomSweep({
  minFps: MIN_FPS_FLOOR,
  throttle: 4,
  page: {
    evaluate: async (fn) => {
      globalThis.__parkMapFps = [40, 42, 38];
      return fn();
    },
  },
});
assert.equal(high.ok, true);
assert.ok(high.fps >= MIN_FPS_FLOOR);

let throttleRate = null;
let eased = false;
const throttled = await zoomSweep({
  minFps: MIN_FPS_FLOOR,
  throttle: 4,
  page: {
    context: () => ({
      newCDPSession: async () => ({
        send: async (method, params) => {
          if (method === 'Emulation.setCPUThrottlingRate') throttleRate = params.rate;
        },
      }),
    }),
    evaluate: async (fn) => {
      globalThis.__parkMapLibre = {
        getZoom: () => 14,
        easeTo: () => { eased = true; },
        once: (_ev, cb) => cb(),
      };
      globalThis.__parkMapFps = [40, 42, 38];
      return fn();
    },
  },
});
assert.equal(throttleRate, 4, 'CDP throttle is applied before samples are read');
assert.equal(eased, true, 'the sweep moves the live camera, not only averages idle rAF');
assert.equal(throttled.throttled, true);
assert.equal(throttled.ok, true);

const closedCdp = await zoomSweep({
  minFps: MIN_FPS_FLOOR,
  throttle: 4,
  page: {
    context: () => ({
      newCDPSession: async () => ({
        send: async () => {
          throw new Error('Target page, context or browser has been closed');
        },
      }),
    }),
    evaluate: async (fn) => {
      globalThis.__parkMapFps = [40, 42, 38];
      return fn();
    },
  },
});
assert.equal(closedCdp.ok, true, 'a closed CDP session must not throw the vertical');
assert.equal(closedCdp.throttled, false);

const live = readFileSync(
  new URL('../../scripts/lib/map-perf-gate.mjs', import.meta.url),
  'utf8',
);
assert.match(live, /openPhone/, 'the live driver uses the phone harness, not a bare goto');
assert.match(live, /mapMissing/, 'the missing-world stub is not treated as a drawn map');
assert.match(
  live,
  /return await zoomSweep\(/,
  'the live driver awaits the sweep so finally cannot close Chromium first',
);

console.log('map-performance-contract: ok');
