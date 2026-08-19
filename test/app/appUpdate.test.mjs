#!/usr/bin/env node
/**
 * App update watcher: the seam that decides whether a `controllerchange`
 * event means "a new worker just took over, reload" versus "this is a
 * fresh install's first-ever claim, do nothing."
 *
 *   node test/app/appUpdate.test.mjs
 */
import assert from 'node:assert/strict';

import { onControllerChange } from '../../apps/party-tracker/lib/appUpdate.js';

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

/**
 * Minimal in-memory sessionStorage stand-in.
 */
function fakeSessionStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/**
 * Minimal in-memory navigator.serviceWorker stand-in that lets the test
 * fire a `controllerchange` event and inspect what got registered.
 */
function fakeServiceWorker({ controller = null } = {}) {
  const listeners = new Set();
  return {
    controller,
    addEventListener: (type, handler) => {
      if (type === 'controllerchange') listeners.add(handler);
    },
    removeEventListener: (type, handler) => {
      if (type === 'controllerchange') listeners.delete(handler);
    },
    fireControllerChange: () => {
      for (const handler of [...listeners]) handler();
    },
  };
}

/** Swap globalThis.navigator/sessionStorage for the duration of fn, then restore. */
function withGlobals({ navigator, sessionStorage }, fn) {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const prevSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigator });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: sessionStorage });
  try {
    return fn();
  } finally {
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
    else delete globalThis.navigator;
    if (prevSession) Object.defineProperty(globalThis, 'sessionStorage', prevSession);
    else delete globalThis.sessionStorage;
  }
}

console.log('\n--- app update watcher ---');

check('does not reload on a first-install controllerchange (no prior controller)', () => {
  const sw = fakeServiceWorker({ controller: null });
  const session = fakeSessionStorage();
  withGlobals({ navigator: { serviceWorker: sw }, sessionStorage: session }, () => {
    let reloads = 0;
    onControllerChange(() => {
      reloads += 1;
    });
    // Browser claims the page for the very first time — controller flips
    // from null to a worker, firing controllerchange with nothing to "update".
    sw.controller = {};
    sw.fireControllerChange();
    assert.equal(reloads, 0, 'first-install claim must not trigger a reload');
    assert.equal(session.getItem('tracker-update-reload'), null, 'no reload guard should be set');
  });
});

check('reloads exactly once on a genuine update controllerchange (controller already existed)', () => {
  const sw = fakeServiceWorker({ controller: {} });
  const session = fakeSessionStorage();
  withGlobals({ navigator: { serviceWorker: sw }, sessionStorage: session }, () => {
    let reloads = 0;
    onControllerChange(() => {
      reloads += 1;
    });
    // A new worker takes over an already-controlled page — a real update.
    sw.fireControllerChange();
    assert.equal(reloads, 1, 'genuine update must reload exactly once');
    // Firing again (defensive) must not cause a second reload.
    sw.fireControllerChange();
    assert.equal(reloads, 1, 'a second controllerchange must not reload again');
  });
});

check('the pre-existing session reload guard still fires immediately on watch-start', () => {
  const sw = fakeServiceWorker({ controller: null });
  const session = fakeSessionStorage();
  session.setItem('tracker-update-reload', '1');
  withGlobals({ navigator: { serviceWorker: sw }, sessionStorage: session }, () => {
    let reloads = 0;
    onControllerChange(() => {
      reloads += 1;
    });
    assert.equal(reloads, 1, 'an already-set reload guard must still reload once on watch-start');
    assert.equal(session.getItem('tracker-update-reload'), null, 'the guard must be cleared after use');
  });
});

if (FAIL.length) {
  console.error(`app update tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`app update tests: ${PASS.length} passed`);
}
