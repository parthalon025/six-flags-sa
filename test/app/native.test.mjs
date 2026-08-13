#!/usr/bin/env node
/**
 * Native shell adapter (Capacitor) with web fallbacks.
 *
 *   node test/app/native.test.mjs
 */
import assert from 'node:assert/strict';
import {
  _resetPluginsForTests,
  _setPluginsForTests,
  clearWatch,
  connectionQuality,
  getCurrentPosition,
  haptic,
  isNativePlatform,
  readBattery,
  shareInvite,
  watchPosition,
} from '../../apps/party-tracker/lib/native.js';

function reset() {
  _resetPluginsForTests();
}

reset();
assert.equal(isNativePlatform(), false);

_setPluginsForTests({
  Capacitor: { isNativePlatform: () => true },
});
assert.equal(isNativePlatform(), true);

{
  const calls = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Haptics: { impact: async (opts) => calls.push(opts) },
  });
  await haptic(12);
  assert.deepEqual(calls, [{ style: 'Light' }]);
}

{
  const vibes = [];
  _setPluginsForTests(null);
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { vibrate: (p) => vibes.push(p) },
  });
  await haptic(8);
  assert.deepEqual(vibes, [8]);
  if (prev) Object.defineProperty(globalThis, 'navigator', prev);
  else delete globalThis.navigator;
}

{
  const shares = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Share: {
      share: async (opts) => {
        shares.push(opts);
      },
    },
  });
  const result = await shareInvite({ code: 'ABCD', url: 'https://parkbound.kurat0r.ai/join#x' });
  assert.equal(result, 'shared');
  assert.equal(shares[0].text, 'Party code ABCD');
  assert.equal(shares[0].url, 'https://parkbound.kurat0r.ai/join#x');
}

{
  const writes = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Share: {
      share: async () => {
        const err = new Error('dismissed');
        err.name = 'AbortError';
        throw err;
      },
    },
    Clipboard: { write: async (opts) => writes.push(opts) },
  });
  const result = await shareInvite({ code: 'ABCD', url: 'https://example/join' });
  assert.equal(result, 'copied');
  assert.deepEqual(writes, [{ string: 'https://example/join' }]);
}

{
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Device: {
      getBatteryInfo: async () => ({ batteryLevel: 0.42, isCharging: true }),
    },
  });
  assert.deepEqual(await readBattery(), { level: 0.42, charging: true });
}

{
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Network: { getStatus: async () => ({ connected: false, connectionType: 'none' }) },
  });
  assert.equal(await connectionQuality(), 0);
}

{
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Network: { getStatus: async () => ({ connected: true, connectionType: 'wifi' }) },
  });
  assert.equal(await connectionQuality(), 1);
}

{
  const watches = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    Geolocation: {
      watchPosition: async (opts, cb) => {
        watches.push(opts);
        cb({ coords: { latitude: 1, longitude: 2, accuracy: 5 } });
        return 'native-watch';
      },
      clearWatch: async ({ id }) => {
        watches.push(['clear', id]);
      },
      getCurrentPosition: async () => ({ coords: { latitude: 3, longitude: 4, accuracy: 8 } }),
    },
  });
  const fixes = [];
  const handle = await watchPosition((pos) => fixes.push(pos), () => {}, { enableHighAccuracy: true });
  assert.equal(handle.native, true);
  assert.equal(handle.id, 'native-watch');
  assert.equal(fixes[0].coords.latitude, 1);
  await clearWatch(handle);
  assert.deepEqual(watches[1], ['clear', 'native-watch']);
  const cur = await getCurrentPosition({ enableHighAccuracy: true });
  assert.equal(cur.coords.latitude, 3);
}

{
  // The PWA and Playwright have no native bridge. Importing @capacitor/core
  // still runs initCapacitorGlobal, which overwrites window.Capacitor and
  // pulls the plugin graph into the web client — UI suites then lose Search
  // places. Skip the import unless the shell already injected a native bridge.
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const prevCap = Object.getOwnPropertyDescriptor(globalThis, 'Capacitor');
  const sentinel = { isNativePlatform: () => false, sentinel: true };
  globalThis.window = globalThis;
  globalThis.Capacitor = sentinel;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      geolocation: {
        watchPosition(ok) {
          ok({ coords: { latitude: 9, longitude: 8, accuracy: 3 } });
          return 1;
        },
        clearWatch() {},
        getCurrentPosition(ok) {
          ok({ coords: { latitude: 9, longitude: 8, accuracy: 3 } });
        },
      },
      vibrate() {},
    },
  });
  _resetPluginsForTests();
  try {
    assert.equal(isNativePlatform(), false);
    await watchPosition(() => {}, () => {}, {});
    await haptic(8);
    await getCurrentPosition({});
    assert.equal(globalThis.Capacitor, sentinel, 'web path must not import @capacitor/core');
  } finally {
    _resetPluginsForTests();
    if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow);
    else delete globalThis.window;
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
    else delete globalThis.navigator;
    if (prevCap) Object.defineProperty(globalThis, 'Capacitor', prevCap);
    else delete globalThis.Capacitor;
  }
}

reset();
console.log('native.test.mjs ok');
