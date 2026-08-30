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

await check('finder credit: Title rides the name; opt-out reads as a fellow guest', () => {
  const titled = contributionFromGapSubmit({
    id: 'c9', type: 'height', placeId: 'orion', authorId: 'alice',
    authorName: 'Alice', authorTitle: 'Scout',
    payload: { heightIn: 48 }, now: 1000,
  });
  assert.equal(completionLine(titled), 'Alice · Scout confirmed 48"');

  // Visitor (no Title yet): name only, no dangling separator.
  const untitled = contributionFromGapSubmit({
    id: 'c10', type: 'queue', placeId: 'orion', authorId: 'bob', authorName: 'Bob',
    payload: {}, now: 1000,
  });
  assert.equal(untitled.authorTitle, null);
  assert.equal(completionLine(untitled), 'Bob pinned the queue');

  // Opted out on Me: the find still lands, anonymously — and a Title must
  // never leak through on an anonymous find.
  const anon = contributionFromGapSubmit({
    id: 'c11', type: 'height', placeId: 'orion', authorId: 'alice',
    authorName: 'a fellow guest', authorTitle: null,
    payload: { heightIn: 44 }, now: 2000,
  });
  assert.equal(completionLine(anon), 'a fellow guest confirmed 44"');
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

// #589 — Overlay is per-World: a Contribution made at one park must not be
// painted onto the next one just because both are loaded on the same phone.
await check('a Contribution scoped to another World does not paint this one', () => {
  const cedarPoint = { id: 'cedar-point', bounds: { north: 41.49, south: 41.47, east: -82.68, west: -82.70 } };
  let overlay = emptyOverlay();
  // Authored at Kings Island (its own lat/lng and venueId), while the phone
  // now has Cedar Point loaded.
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'ki-restroom', type: 'restroom', venueId: 'kings-island',
    payload: { name: 'Ohio restroom' }, lat: 39.34, lng: -84.26, now: 1,
  }));
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'ki-path', type: 'path', venueId: 'kings-island', lat: 39.34, lng: -84.26, now: 2,
  }));
  const painted = applyOverlayToPlaces(
    [{ i: 'top-thrill', n: 'Top Thrill 2', c: 'coaster', lat: 41.48, lng: -82.69 }],
    overlay,
    cedarPoint,
  );
  assert.ok(!painted.places.some((p) => p.n === 'Ohio restroom'), 'the other World’s restroom must not appear');
  assert.ok(!painted.pins.some((p) => p.kind === 'path'), 'the other World’s path pin must not appear');
  assert.equal(painted.places.length, 1, 'only the shipped Cedar Point Place remains');
});

await check('a Contribution scoped to the loaded World still paints', () => {
  const cedarPoint = { id: 'cedar-point', bounds: { north: 41.49, south: 41.47, east: -82.68, west: -82.70 } };
  let overlay = emptyOverlay();
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'cp-restroom', type: 'restroom', venueId: 'cedar-point',
    payload: { name: 'Frontier restroom' }, lat: 41.48, lng: -82.69, now: 1,
  }));
  const painted = applyOverlayToPlaces([], overlay, cedarPoint);
  assert.ok(painted.places.some((p) => p.n === 'Frontier restroom'));
});

await check('pre-migration Overlay with no venueId falls back to bounds', () => {
  const cedarPoint = { id: 'cedar-point', bounds: { north: 41.49, south: 41.47, east: -82.68, west: -82.70 } };
  let overlay = emptyOverlay();
  // Old data recorded before #589: no venueId, and coordinates far outside
  // the loaded World's bounds.
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'legacy-gate', type: 'gate', payload: { name: 'Old gate' }, lat: 39.34, lng: -84.26, now: 1,
  }));
  const painted = applyOverlayToPlaces([], overlay, cedarPoint);
  assert.ok(!painted.places.some((p) => p.n === 'Old gate'), 'out-of-bounds legacy fact stays out');
});

await check('no venue argument keeps prior unscoped behaviour', () => {
  // Existing callers that never pass a venue (or tests that don't care about
  // World scoping) must see the same painting as before this fix.
  let overlay = emptyOverlay();
  overlay = applyContribution(overlay, contributionFromGapSubmit({
    id: 'anywhere-food', type: 'food', payload: { name: 'Funnel cakes' }, lat: 1, lng: 2, now: 1,
  }));
  const painted = applyOverlayToPlaces([], overlay);
  assert.ok(painted.places.some((p) => p.n === 'Funnel cakes'));
});

if (FAIL.length) {
  console.error(`overlay tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`overlay tests: ${PASS.length} passed`);
}
