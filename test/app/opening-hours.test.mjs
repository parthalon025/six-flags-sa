#!/usr/bin/env node
import assert from 'node:assert/strict';

const {
  validateOpeningHoursRaw,
  parseOpeningHours,
  openingHoursForPoi,
} = await import('../../packages/shared/openingHours.js');

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

check('missing hours stays absent', () => {
  assert.equal(openingHoursForPoi({ n: 'Cafe', c: 'food' }), null);
});

check('24/7 becomes an honest always-open line', () => {
  const h = openingHoursForPoi({ n: 'Gate', c: 'gate', oh: '24/7' });
  assert.equal(h.detail, 'Open 24 hours');
  assert.equal(h.planLine, 'Open 24h');
});

check('a show Place labels showtimes on detail and Plan', () => {
  const h = openingHoursForPoi({
    n: 'Theater',
    c: 'show',
    oh: 'Jun-Aug Sa-Su 14:00-16:00',
  });
  assert.match(h.detail, /^Showtimes: Jun-Aug Sa-Su 14:00-16:00$/);
  assert.match(h.planLine, /^Showtimes · /);
});

check('invalid opening_hours fails validation', () => {
  assert.equal(validateOpeningHoursRaw('   ').value, null);
  assert.equal(validateOpeningHoursRaw(42).ok, false);
});

check('parse keeps the raw OSM string for complex rules', () => {
  const p = parseOpeningHours('Mo-Fr 10:00-18:00');
  assert.deepEqual(p, { kind: 'osm', raw: 'Mo-Fr 10:00-18:00' });
});

console.log(`\n${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
