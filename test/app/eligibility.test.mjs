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

if (FAIL.length) {
  console.error(`eligibility tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`eligibility tests: ${PASS.length} passed`);
}
