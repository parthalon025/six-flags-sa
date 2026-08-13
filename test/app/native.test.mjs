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
  listenInviteUrls,
  readBattery,
  registerPush,
  shareInvite,
  shouldRegisterPush,
  watchPosition,
} from '../../apps/party-tracker/lib/native.js';

function reset() {
  _resetPluginsForTests();
}

reset();
assert.equal(isNativePlatform(), false);
assert.equal(shouldRegisterPush(null), false);
assert.equal(shouldRegisterPush({}), false);
assert.equal(shouldRegisterPush({ active: false, partyId: 'p1' }), false);
assert.equal(shouldRegisterPush({ active: true, partyId: 'p1' }), true);

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
  const removed = [];
  const fixes = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    BackgroundGeolocation: {
      addWatcher: async (opts, cb) => {
        cb({ latitude: 29.6, longitude: -98.6, accuracy: 12, bearing: 90, speed: 0.4, time: 1 });
        return 'bg-watch';
      },
      removeWatcher: async ({ id }) => {
        removed.push(id);
      },
    },
    Geolocation: {
      watchPosition: async () => {
        throw new Error('foreground watch must not run when background Location is available');
      },
    },
  });
  const handle = await watchPosition((pos) => fixes.push(pos), () => {}, { background: true });
  assert.equal(handle.native, true);
  assert.equal(handle.background, true);
  assert.equal(handle.id, 'bg-watch');
  assert.equal(fixes[0].coords.latitude, 29.6);
  assert.equal(fixes[0].coords.heading, 90);
  await clearWatch(handle);
  assert.deepEqual(removed, ['bg-watch']);
}

{
  const tokens = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    PushNotifications: {
      requestPermissions: async () => ({ receive: 'granted' }),
      register: async () => {},
      addListener: async (event, cb) => {
        if (event === 'registration') cb({ value: 'apns-or-fcm-token' });
        return { remove: async () => {} };
      },
    },
  });
  const result = await registerPush({ onToken: (t) => tokens.push(t) });
  assert.equal(result, 'native');
  assert.deepEqual(tokens, ['apns-or-fcm-token']);
}

{
  const opened = [];
  _setPluginsForTests({
    Capacitor: { isNativePlatform: () => true },
    App: {
      getLaunchUrl: async () => ({ url: 'https://parkbound.kurat0r.ai/join#abc' }),
      addListener: async (event, cb) => {
        if (event === 'appUrlOpen') cb({ url: 'https://parkbound.kurat0r.ai/join#def' });
        return { remove: async () => {} };
      },
    },
  });
  await listenInviteUrls((url) => opened.push(url));
  assert.deepEqual(opened, [
    'https://parkbound.kurat0r.ai/join#abc',
    'https://parkbound.kurat0r.ai/join#def',
  ]);
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
