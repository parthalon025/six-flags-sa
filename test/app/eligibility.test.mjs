#!/usr/bin/env node
/**
 * Eligibility engine: judge/fold/fromFacts over the height rule, at the
 * public seam (fold's at/explain). Expected verdicts and boundaries are
 * reasoned from the domain rules independently of the implementation.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { fold, fromFacts, peopleFor } = await import('../../apps/party-tracker/lib/eligibility.js');
const { applyContribution, contributionFromGapSubmit, emptyOverlay, applyOverlayToPlaces } =
  await import('../../apps/party-tracker/lib/overlay.js');

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

const person = (height, withAdult) => ({ id: 'p1', name: 'Rider', height, withAdult });
const ride = (h, c = 'coaster') => ({ i: 'r1', n: 'Ride', c, lat: 1, lng: 2, h });

console.log('\n--- eligibility ---');

check('tall enough with only a minimum is eligible', () => {
  const view = fold([person(52)], [ride({ min: 48 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'eligible');
  assert.equal(cell.blocks, false);
});

check('under the minimum is not, and blocks', () => {
  const view = fold([person(40)], [ride({ min: 48 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'not');
  assert.equal(cell.blocks, true);
});

check('over the maximum is not, and blocks', () => {
  const view = fold([person(80)], [ride({ max: 76 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'not');
  assert.equal(cell.blocks, true);
});

check('under the alone line with an adult along is companion, does not block', () => {
  const view = fold([person(50, true)], [ride({ alone: 54 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'companion');
  assert.equal(cell.blocks, false);
});

check('withAdult unset defaults to accompanied — same as explicit true', () => {
  const view = fold([person(50)], [ride({ alone: 54 })]);
  assert.equal(view.at('r1').kind, 'companion');
});

check('under the alone line with no adult along is not, and blocks', () => {
  const view = fold([person(50, false)], [ride({ alone: 54 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'not');
  assert.equal(cell.blocks, true);
});

check('over the advisory line (nothing else in the way) is advisory, does not block', () => {
  const view = fold([person(74)], [ride({ advisory: 70 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'advisory');
  assert.equal(cell.blocks, false);
});

check('boundary: exactly at the minimum is eligible, not not', () => {
  const view = fold([person(48)], [ride({ min: 48 })]);
  assert.equal(view.at('r1').kind, 'eligible');
});

check('boundary: one inch under the minimum is not', () => {
  const view = fold([person(47)], [ride({ min: 48 })]);
  assert.equal(view.at('r1').kind, 'not');
});

check('missing member height is not height-constrained — eligible, not unknown', () => {
  const view = fold([person(null)], [ride({ min: 48 })]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'eligible');
  assert.equal(cell.blocks, false);
});

check('unset height (undefined field) is likewise eligible', () => {
  const view = fold([{ id: 'p1', name: 'Rider' }], [ride({ min: 48 })]);
  assert.equal(view.at('r1').kind, 'eligible');
});

check('a ride with no height rule at all is a visible Unknown, not silent, and does not block', () => {
  const view = fold([person(52)], [ride(null)]);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'unknown');
  assert.equal(cell.blocks, false);
  const rows = view.explain('r1');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].reasons[0] && rows[0].reasons[0].length > 0, 'expected a short reason');
});

check('a no-rule ride with nobody to judge stays genuinely silent', () => {
  const view = fold([], [ride(null)]);
  const cell = view.at('r1');
  assert.equal(cell.kind, null);
  assert.equal(cell.blocks, false);
  assert.deepEqual(view.explain('r1'), []);
});

check('a non-ride place with no height rule stays silent even with people present', () => {
  const view = fold([person(52)], [ride(null, 'food')]);
  const cell = view.at('r1');
  assert.equal(cell.kind, null);
  assert.equal(cell.blocks, false);
});

check('a ride with a real rule (not no-rule) still judges normally, never unknown', () => {
  const view = fold([person(52)], [ride({ min: 48 })]);
  assert.notEqual(view.at('r1').kind, 'unknown');
});

check('fold picks the most restrictive of several people for at()', () => {
  const people = [person(80), person(40)];
  const view = fold(people, [ride({ min: 48 })]);
  assert.equal(view.at('r1').kind, 'not');
});

check('explain lists every person, most restrictive first', () => {
  const people = [person(80), person(40)];
  const view = fold(people, [ride({ min: 48 })]);
  const rows = view.explain('r1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].kind, 'not');
  assert.equal(rows[1].kind, 'eligible');
});

check('fromFacts wraps peopleFor + fold for solo facts', () => {
  const view = fromFacts({ solo: { height: 40 } }, [ride({ min: 48 })]);
  assert.equal(view.at('r1').kind, 'not');
  assert.equal(peopleFor({ solo: { height: 40 } }).length, 1);
});

console.log('\n--- eligibility over painted Overlay ---');

/* The shape Eligibility folds over in the app is not the shipped rule — it is
 * whatever `applyOverlayToPlaces` painted. Build these places by running the
 * real Overlay path (Contribution → drawn fact → painted Place), never by
 * hand: a hand-written post-Overlay rule is a guess about the seam, and the
 * guess is exactly what let a Contribution erase the ride-alone line. */
const painted = (h, payload, { c = 'coaster' } = {}) => {
  const overlay = applyContribution(
    emptyOverlay(),
    contributionFromGapSubmit({
      id: 'c1',
      type: 'height',
      placeId: 'r1',
      authorId: 'dad',
      authorName: 'Dad',
      payload,
      now: 1000,
    }),
  );
  return applyOverlayToPlaces([ride(h, c)], overlay).places;
};

check('a height Contribution keeps the ride-alone line — Companion survives', () => {
  const places = painted({ min: 42, alone: 48 }, { heightIn: 42 });
  const view = fold([person(44)], places);
  const cell = view.at('r1');
  assert.equal(cell.kind, 'companion');
  assert.equal(cell.blocks, false);
});

check('the Contribution still updates the minimum it actually learned', () => {
  const places = painted({ min: 42, alone: 48 }, { heightIn: 44 });
  assert.equal(places[0].h.min, 44);
  assert.equal(fold([person(43)], places).at('r1').kind, 'not');
});

check('"no minimum" clears only the minimum — the ride-alone line stands', () => {
  const places = painted({ min: 42, alone: 48 }, { heightIn: 0 });
  assert.equal(places[0].h.min, 'none');
  assert.equal(fold([person(40)], places).at('r1').kind, 'companion');
});

check('a height Contribution keeps max and advisory', () => {
  const places = painted({ min: 36, max: 76, advisory: 70 }, { heightIn: 40 });
  assert.equal(fold([person(80)], places).at('r1').kind, 'not');
  assert.equal(fold([person(74)], places).at('r1').kind, 'advisory');
});

check('a height payload with no inches leaves the shipped rule untouched', () => {
  const places = painted({ min: 42, alone: 48 }, { note: 'sign was covered' });
  assert.deepEqual(places[0].h, { min: 42, alone: 48 });
  assert.equal(places[0].overlay, undefined);
  assert.equal(fold([person(44)], places).at('r1').kind, 'companion');
});

check('a null height answer is absent, not "no minimum" — the shipped rule stands', () => {
  const places = painted({ min: 42, alone: 48 }, { heightIn: null });
  assert.equal(places[0].h.min, 42);
  assert.equal(fold([person(40)], places).at('r1').kind, 'not');
});

check('fromFacts over painted Places: a Party child still needs an adult along', () => {
  const places = painted({ min: 42, alone: 48 }, { heightIn: 42 });
  const facts = {
    party: {
      selfId: 'mom',
      members: [
        { id: 'mom', name: 'Mom', height: 66 },
        { id: 'kid', name: 'Kid', height: 44 },
      ],
    },
  };
  const view = fromFacts(facts, places);
  assert.equal(view.at('r1').kind, 'companion');
  const rows = view.explain('r1');
  assert.equal(rows[0].name, 'Kid');
  assert.ok(
    rows[0].reasons.some((r) => r.includes('adult')),
    'expected the Companion reason to name an adult riding along',
  );
});

if (FAIL.length) {
  console.error(`eligibility tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`eligibility tests: ${PASS.length} passed`);
}
