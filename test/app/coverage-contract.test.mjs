#!/usr/bin/env node
/**
 * The gate over the critical-path contract (#24).
 *
 * Synthetic contracts prove each refusal; the shipped contract is then run
 * through the same function, so this suite fails when a row starts claiming
 * coverage that does not exist — which is the failure the ticket was filed for.
 */
import assert from 'node:assert/strict';
import {
  contextFingerprint,
  coverageFailures,
  loadContract,
} from './coverage-contract.mjs';

const SUITES = { functional: 'test/app/functional.mjs', grandma: 'test/app/grandma.mjs' };
const source = (rel) =>
  ({
    'test/app/functional.mjs': "await check('verdicts respond to height', async () => {});",
    'test/app/grandma.mjs': 'the toilet leg of the run',
  })[rel] ?? (() => { throw new Error(`no such suite file ${rel}`); })();

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${err.message}`);
  }
}

console.log('\ncoverage-contract\n');

check('a row whose check is in its suite passes', () => {
  const contract = {
    suites: SUITES,
    paths: [{ id: 'heights', suite: 'functional', check: 'verdicts respond to height' }],
  };
  assert.deepEqual(coverageFailures(contract, source), []);
});

check('a shipped row naming a check nothing runs is refused, and says so', () => {
  const contract = {
    suites: SUITES,
    paths: [
      { id: 'clerk-profile-oauth', suite: 'functional', check: 'Profile gate shows Sign in and Guest' },
    ],
  };
  const [reason, ...rest] = coverageFailures(contract, source);
  assert.equal(rest.length, 0);
  assert.match(reason, /^paths\/clerk-profile-oauth: /);
  assert.match(reason, /test\/app\/functional\.mjs contains no check/);
  assert.match(reason, /claims coverage that does not exist/);
});

check('check_includes is matched as a substring, against its own suite', () => {
  const ok = { suites: SUITES, paths: [{ id: 'g', suite: 'grandma', check_includes: 'toilet' }] };
  assert.deepEqual(coverageFailures(ok, source), []);
  const bad = { suites: SUITES, paths: [{ id: 'g', suite: 'grandma', check_includes: 'carousel' }] };
  assert.match(coverageFailures(bad, source)[0], /contains no check_includes/);
});

check('a row is checked against the suite it names, not the first one', () => {
  const contract = {
    suites: SUITES,
    // The string exists — in functional.mjs, which is not the suite claimed.
    paths: [{ id: 'misfiled', suite: 'grandma', check: 'verdicts respond to height' }],
  };
  assert.match(coverageFailures(contract, source)[0], /grandma\.mjs contains no check/);
});

check('a suite the map does not resolve is named plainly, not silently skipped', () => {
  const contract = {
    suites: SUITES,
    paths: [{ id: 'visual-row', suite: 'visual', check: 'anything' }],
  };
  const reason = coverageFailures(contract, source)[0];
  assert.match(reason, /suite "visual" is not in the suites map/);
});

check('a row naming neither check nor check_includes is refused', () => {
  const contract = { suites: SUITES, paths: [{ id: 'bare', suite: 'functional' }] };
  assert.match(coverageFailures(contract, source)[0], /names neither check nor check_includes/);
});

check('an upcoming TODO placeholder is a row admitting it is not covered', () => {
  const contract = {
    suites: SUITES,
    upcoming: [{ id: 'later', suite: 'functional', check: 'TODO name the check when the slice lands' }],
  };
  assert.deepEqual(coverageFailures(contract, source), []);
});

check('an upcoming row carrying a real check is held to the same rule', () => {
  const contract = {
    suites: SUITES,
    upcoming: [{ id: 'later', suite: 'functional', check: 'a check nobody wrote' }],
  };
  assert.match(coverageFailures(contract, source)[0], /^upcoming\/later: /);
});

check('an unreadable suite file is reported, not swallowed', () => {
  const contract = {
    suites: { ...SUITES, gone: 'test/app/deleted.mjs' },
    paths: [{ id: 'orphan', suite: 'gone', check: 'anything' }],
  };
  assert.match(coverageFailures(contract, source)[0], /is unreadable/);
});

check('every row in the shipped contract names a check that exists', () => {
  const failures = coverageFailures(loadContract());
  assert.deepEqual(failures, [], failures.join('\n    '));
});

check('the shipped contract carries a reproducible context fingerprint', () => {
  const contract = loadContract();
  assert.equal(
    contextFingerprint(contract),
    contract.context.sha256,
    'restamp with: node test/app/coverage-contract.mjs --stamp',
  );
});

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
if (failed) process.exit(1);
