#!/usr/bin/env node
/**
 * lib/venue/store.js — one door to a World's Places.
 *
 * The store is the only way to get a World's Places, and what it hands out is
 * always Overlay-painted. That used to be untrue: app/page.js painted the
 * Overlay and drilled the result outward as props while the store kept the
 * shipped list, so HeightPanel's eligibility tally answered from the shipped
 * height rule while the map beside it drew the height a Member had just
 * contributed. Two screens, one phone, two answers about whether a child
 * could ride.
 *
 * So these checks go through the real store interface — selectVenue, then
 * setOverlay, then the snapshot a screen reads — rather than calling
 * applyOverlayToPlaces and asserting on a shape assembled by hand. Hand
 * assembly is exactly what the bug was: it proves the painter works, not that
 * the screen is looking at the painted array.
 *
 *   node test/app/venue-store.test.mjs
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

/* The store writes the last-opened venue on every load ("nearest or last").
   Bare node has no localStorage, and a store that threw on boot would take
   the app down, so the real one is guarded — this stub is here so the guard
   is not what these checks are exercising. */
const cells = new Map();
globalThis.localStorage = {
  getItem: (k) => (cells.has(k) ? cells.get(k) : null),
  setItem: (k, v) => cells.set(k, String(v)),
  removeItem: (k) => cells.delete(k),
};

const MANIFEST = {
  default: 'p',
  venues: [
    {
      id: 'p',
      name: 'Test Park',
      map: '/venues/p.map.json',
      pois: '/venues/p.pois.json',
      gaps: '/venues/p.gaps.json',
      bounds: { north: 1, south: -1, east: 1, west: -1 },
      center: { lat: 0, lng: 0 },
    },
  ],
};

/* Orion ships a height rule of 48in. Every check below is about which number
   a screen sees after a Member contributes a different one. */
const SHIPPED_POIS = [
  { i: 'orion', n: 'Orion', c: 'coaster', lat: 0.1, lng: 0.1, h: { min: 48 } },
  { i: 'loo', n: 'Midway restroom', c: 'restroom', lat: 0.2, lng: 0.2 },
];

const BODIES = {
  '/venues/manifest.json': MANIFEST,
  '/venues/p.map.json': { meta: { id: 'p' }, layers: {} },
  '/venues/p.pois.json': SHIPPED_POIS,
  '/venues/p.gaps.json': { gaps: [{ type: 'height', target: 'orion' }] },
};

let failNext = null;
globalThis.fetch = async (url) => {
  if (failNext && url === failNext) throw new Error('offline');
  const body = BODIES[url];
  if (!body) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
};

const {
  getSnapshot,
  selectVenue,
  setOverlay,
  subscribe,
} = await import('../../apps/party-tracker/lib/venue/store.js');
const store = await import('../../apps/party-tracker/lib/venue/store.js');
const {
  applyContribution,
  contributionFromGapSubmit,
  emptyOverlay,
} = await import('../../apps/party-tracker/lib/overlay.js');

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

/** The Places a screen would render — read the way usePois() reads them. */
const places = () => getSnapshot().pois;
const orion = () => places().find((p) => p.i === 'orion');

const heightOverlay = (inches, id = 'c1', now = 1000) =>
  applyContribution(
    emptyOverlay(),
    contributionFromGapSubmit({
      id,
      type: 'height',
      placeId: 'orion',
      authorId: 'mom',
      authorName: 'Mom',
      payload: { heightIn: inches },
      now,
    }),
  );

/* ----------------------------------------------------------------------- */

await check('a loaded World hands out numbered, shipped Places', async () => {
  await selectVenue('p');
  assert.equal(getSnapshot().status, 'ready');
  assert.equal(orion().h.min, 48);
  assert.equal(orion().overlay, undefined, 'nothing is painted before a Contribution');
  assert.ok(orion().id, 'withIds still runs — ride reports are addressed by id');
});

await check("a screen's Places carry this phone's Contribution", async () => {
  setOverlay(heightOverlay(42));
  /* This is the assertion the bug failed: HeightPanel reads exactly this
     array, and it now says 42 — the same number the map draws. */
  assert.equal(orion().h.min, 42);
  assert.equal(orion().overlay, true);
});

await check('there is no second door to unpainted Places', async () => {
  const snapshot = getSnapshot();
  for (const [key, value] of Object.entries(snapshot)) {
    if (!Array.isArray(value)) continue;
    const hit = value.find((row) => row && row.i === 'orion');
    if (hit) assert.equal(hit.h.min, 42, `snapshot.${key} answers with the shipped rule`);
  }
  for (const name of Object.keys(store)) {
    assert.ok(
      !/^(shippedPois|rawPois|unpaintedPois)$/.test(name),
      `store exports ${name} — an escape hatch back to unpainted Places`,
    );
  }
});

await check('Overlay drawables that are not Places ship with them', async () => {
  let overlay = heightOverlay(42);
  overlay = applyContribution(
    overlay,
    contributionFromGapSubmit({
      id: 'c2', type: 'queue', placeId: 'orion', lat: 0.11, lng: 0.11, now: 2000,
    }),
  );
  setOverlay(overlay);
  assert.ok(getSnapshot().overlayPins.some((pin) => pin.kind === 'queue'));
  assert.equal(orion().e[0].lat, 0.11, 'the queue entrance lands on the Place too');
  assert.equal(orion().h.min, 42, 'and the height Contribution is still drawn');
});

await check('the latest Contribution per Place wins, through the store', async () => {
  setOverlay(heightOverlay(36, 'c3', 3000));
  assert.equal(orion().h.min, 36);
});

await check('a blank Overlay over a blank one publishes nothing', async () => {
  /* The guard that keeps the app hydratable: a phone with no Contributions
     still pushes an Overlay on mount, emptyOverlay() is a fresh object every
     time, and republishing Places with the same contents and a new identity
     mid-hydration makes React throw away the server HTML. */
  setOverlay(emptyOverlay());
  const before = places();
  let emitted = 0;
  const off = subscribe(() => { emitted += 1; });
  setOverlay(emptyOverlay());
  off();
  assert.equal(emitted, 0);
  assert.equal(places(), before, 'the Places array keeps its identity');
});

await check('going blank after a Contribution does repaint', async () => {
  setOverlay(heightOverlay(50, 'c9', 9000));
  assert.equal(orion().h.min, 50);
  /* A Member leaves a Party and the Host's Contributions go with them. The
     shipped rule has to come back, so blankness must not be a dead end. */
  setOverlay(emptyOverlay());
  assert.equal(orion().h.min, 48);
  assert.equal(orion().overlay, undefined);
});

await check('an unchanged Overlay does not repaint', async () => {
  const overlay = heightOverlay(36, 'c3', 3000);
  setOverlay(overlay);
  const before = places();
  let emitted = 0;
  const off = subscribe(() => { emitted += 1; });
  setOverlay(overlay);
  off();
  assert.equal(emitted, 0, 'a party heartbeat must not re-render every map pin');
  assert.equal(places(), before, 'and the Places array keeps its identity');
});

await check('a failed venue swap rolls back to painted Places, not shipped ones', async () => {
  setOverlay(heightOverlay(42, 'c4', 4000));
  assert.equal(orion().h.min, 42);
  failNext = '/venues/p.map.json';
  const venue = await selectVenue('p', { refresh: true });
  failNext = null;
  assert.equal(venue.id, 'p');
  assert.equal(getSnapshot().status, 'ready', 'rollback restores a usable World');
  /* The rollback keeps the shipped Places and repaints. If it had restored a
     painted array captured before the fetch, a Contribution made while the
     fetch was in flight would silently disappear off the map. */
  assert.equal(orion().h.min, 42, 'the Contribution survived the rollback');
  assert.equal(orion().overlay, true);
});

await check('a Contribution that lands during a load is painted onto the new World', async () => {
  setOverlay(heightOverlay(40, 'c5', 5000));
  await selectVenue('p', { refresh: true });
  assert.equal(orion().h.min, 40, 'the fresh download is painted with the live Overlay');
});

/* ----------------------------------------------------------------------- */

console.log(`\nvenue-store: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  for (const f of FAIL) console.log('  -', f);
  process.exit(1);
}
