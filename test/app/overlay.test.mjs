#!/usr/bin/env node
/**
 * Overlay replica: last-write drawn fact, completions list, upload seam.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const {
  applyContribution,
  applyOverlayToPlaces,
  authoredOnly,
  completionLine,
  completionsForPlace,
  contributionFromGapSubmit,
  createHttpUploadAdapter,
  createLocalUploadAdapter,
  createUploadSeam,
  emptyOverlay,
  overlayKey,
  unionOverlays,
} = await import('../../apps/party-tracker/lib/overlay.js');

const PASS = [];
const FAIL = [];
const check = (name, fn) => {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') {
      return out.then(() => {
        PASS.push(name);
        console.log('  PASS', name);
      }).catch((err) => {
        FAIL.push(`${name} :: ${err.message}`);
        console.log('  FAIL', name, '->', err.message);
      });
    }
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
  return Promise.resolve();
};

console.log('\n--- overlay ---');

await check('height Contribution draws Overlay on that Attraction', () => {
  const c = contributionFromGapSubmit({
    id: 'c1',
    type: 'height',
    placeId: 'orion',
    authorId: 'dad',
    authorName: 'Dad',
    payload: { heightIn: 48 },
    now: 1000,
  });
  const overlay = applyContribution(emptyOverlay(), c);
  assert.equal(overlay.drawn[overlayKey('height', 'orion')].payload.heightIn, 48);
  const painted = applyOverlayToPlaces([{ i: 'orion', n: 'Orion', c: 'coaster', lat: 1, lng: 2, h: null }], overlay);
  assert.equal(painted.places[0].h.min, 48);
  assert.equal(painted.places[0].overlay, true);
});

await check('last Contribution per Place + type is drawn; earlier stays as completion', () => {
  let overlay = emptyOverlay();
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'c1', type: 'height', placeId: 'orion', authorId: 'dad', authorName: 'Dad',
    payload: { heightIn: 48 }, now: 1000,
  }));
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'c2', type: 'height', placeId: 'orion', authorId: 'mom', authorName: 'Mom',
    payload: { heightIn: 42 }, now: 2000,
  }));
  assert.equal(overlay.drawn[overlayKey('height', 'orion')].payload.heightIn, 42);
  const lines = completionsForPlace(overlay, 'orion').map(completionLine);
  assert.deepEqual(lines, ['Dad confirmed 48"', 'Mom confirmed 42"']);
});

await check('same id is not double-counted', () => {
  const c = contributionFromGapSubmit({
    id: 'c1', type: 'height', placeId: 'orion', authorId: 'dad',
    payload: { heightIn: 48 }, now: 1000,
  });
  const once = applyContribution(emptyOverlay(), c);
  const twice = applyContribution(once, c);
  assert.equal(twice.completions.length, 1);
});

await check('union by Place + type last-write; leave keeps authored only', () => {
  const dad = applyContribution(emptyOverlay(), contributionFromGapSubmit({
    id: 'c1', type: 'height', placeId: 'orion', authorId: 'dad', authorName: 'Dad',
    payload: { heightIn: 48 }, now: 1000,
  }));
  const mom = applyContribution(emptyOverlay(), contributionFromGapSubmit({
    id: 'c2', type: 'queue', placeId: 'beast', authorId: 'mom', authorName: 'Mom',
    payload: { atLine: true }, lat: 39.1, lng: -84.2, now: 1500,
  }));
  const party = unionOverlays(dad, mom);
  assert.ok(party.drawn[overlayKey('height', 'orion')]);
  assert.ok(party.drawn[overlayKey('queue', 'beast')]);
  const afterLeave = authoredOnly(party, 'dad');
  assert.ok(afterLeave.drawn[overlayKey('height', 'orion')]);
  assert.equal(afterLeave.drawn[overlayKey('queue', 'beast')], undefined);
  assert.equal(afterLeave.completions.length, 1);
});

await check('every Field Research kind paints a map fact', () => {
  const kinds = [
    contributionFromGapSubmit({ id: 'h', type: 'height', placeId: 'orion', payload: { heightIn: 0 }, now: 1 }),
    contributionFromGapSubmit({ id: 'q', type: 'queue', placeId: 'orion', lat: 1, lng: 2, now: 2 }),
    contributionFromGapSubmit({ id: 'p', type: 'path', lat: 3, lng: 4, now: 3 }),
    contributionFromGapSubmit({
      id: 'r', type: 'restroom', payload: { name: 'Midway toilets' }, lat: 5, lng: 6, now: 4,
    }),
    contributionFromGapSubmit({
      id: 'f', type: 'food', payload: { name: 'Dippin Dots' }, lat: 7, lng: 8, now: 5,
    }),
    contributionFromGapSubmit({
      id: 'g', type: 'gate', payload: { name: 'Main gate' }, lat: 9, lng: 10, now: 6,
    }),
    contributionFromGapSubmit({
      id: 'c', type: 'camping', payload: { hookup: 'full' }, now: 7,
    }),
  ];
  let overlay = emptyOverlay();
  for (const c of kinds) overlay = applyContribution(overlay, c);
  const painted = applyOverlayToPlaces([
    { i: 'orion', n: 'Orion', c: 'coaster', lat: 0, lng: 0 },
    { i: 'pad-1', n: 'Site 1', c: 'campsite', lat: 0.1, lng: 0.1 },
  ], overlay);
  assert.equal(painted.places.find((p) => p.i === 'orion').h.min, 'none');
  assert.equal(painted.places.find((p) => p.i === 'orion').e[0].lat, 1);
  assert.ok(painted.pins.some((p) => p.kind === 'queue'));
  assert.ok(painted.pins.some((p) => p.kind === 'path'));
  assert.ok(painted.places.some((p) => p.c === 'restroom' && p.n === 'Midway toilets'));
  assert.ok(painted.places.some((p) => p.c === 'food'));
  assert.ok(painted.places.some((p) => p.c === 'gate'));
  assert.equal(painted.places.find((p) => p.c === 'campsite').camp.hookup, 'full');
  assert.equal(painted.venueCamping.hookup, 'full');
});

await check('live Ride report kind is not Overlay', () => {
  const overlay = applyContribution(emptyOverlay(), { id: 'x', type: 'ride_status', payload: { status: 'down' } });
  assert.deepEqual(overlay.drawn, {});
  assert.equal(overlay.completions.length, 0);
});

await check('upload seam uses local adapter; HTTP is optional', async () => {
  const local = [];
  const seam = createUploadSeam([
    createLocalUploadAdapter({ enqueue: async (c) => local.push(c) }),
  ]);
  const c = contributionFromGapSubmit({
    id: 'c1', type: 'height', placeId: 'orion', payload: { heightIn: 48 }, now: 1,
  });
  await seam.enqueue(c);
  assert.equal(local.length, 1);
  assert.equal(local[0].id, 'c1');

  const httpCalls = [];
  const http = createHttpUploadAdapter({
    fetchImpl: async (url, opts) => {
      httpCalls.push({ url, opts });
      return { ok: true };
    },
  });
  await http.enqueue(c);
  assert.equal(httpCalls.length, 1);
  assert.equal(httpCalls[0].url, '/api/contributions');
  const posted = JSON.parse(httpCalls[0].opts.body);
  assert.equal(posted.kind, 'height');
  assert.equal(posted.payload.overlayType, 'height');
});

if (FAIL.length) {
  console.error(`overlay tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`overlay tests: ${PASS.length} passed`);
}
