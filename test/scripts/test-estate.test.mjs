#!/usr/bin/env node
/**
 * Test-estate accounting — every suite under test/ is run by something named,
 * or excluded for a written reason.
 *
 * Two halves. The real estate must audit clean, which is the gate. And the
 * audit must catch each way an estate can lie, which is what makes the clean
 * result worth anything — asserted against worlds broken on purpose, since the
 * real one is (hopefully) never broken.
 *
 *   node test/scripts/test-estate.test.mjs
 */
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_SCRIPT_TESTS } from '../../scripts/ci/manifest.mjs';
import { TEST_ESTATE, TEST_ESTATE_EXCLUDED, TEST_RUNNERS } from '../../scripts/ci/test-estate.mjs';
import { readTestEstateWorld, testEstateProblems } from '../../scripts/lib/test-estate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

const world = readTestEstateWorld(ROOT, {
  estate: TEST_ESTATE,
  excluded: TEST_ESTATE_EXCLUDED,
  runners: TEST_RUNNERS,
  gateTests: GATE_SCRIPT_TESTS,
});

assert.deepEqual(
  testEstateProblems(world),
  [],
  'the test estate accounts for every suite under test/',
);

/** A tiny world that audits clean, so each case below breaks exactly one thing. */
function fixture(overrides = {}) {
  return {
    estate: { 'test/a/one.mjs': ['gate'] },
    excluded: { 'test/a/two.mjs': 'plumbing imported by one.mjs, never run alone' },
    runners: { gate: { label: 'the gate job', gateManifest: true, job: 'gate' } },
    gateTests: ['test/a/one.mjs'],
    files: ['test/a/one.mjs', 'test/a/two.mjs'],
    scripts: { 'test:ci-gate': 'node scripts/ci/gate-tests.mjs' },
    workflow: '\n  gate:\n    steps:\n      - run: node test/a/one.mjs\n',
    readFile: () => '',
    ...overrides,
  };
}

assert.deepEqual(testEstateProblems(fixture()), [], 'the fixture world is clean to begin with');

/** The problem list has to name the file and say what to do, so match on both. */
const cases = [
  ['a suite in neither list', { files: ['test/a/one.mjs', 'test/a/two.mjs', 'test/a/orphan.mjs'] }, /orphan\.mjs is in neither/],
  ['a listed file that is gone', { files: ['test/a/two.mjs'] }, /one\.mjs is listed .* but missing on disk/],
  ['run and excluded at once', { excluded: { 'test/a/one.mjs': 'both' } }, /one\.mjs is both run and excluded/],
  ['an exclusion with no reason', { excluded: { 'test/a/two.mjs': '   ' } }, /two\.mjs is excluded with no written reason/],
  ['an unknown runner', { estate: { 'test/a/one.mjs': ['ghost'] } }, /names unknown runner "ghost"/],
  ['a file with no runner at all', { estate: { 'test/a/one.mjs': [] } }, /one\.mjs names no runner/],
  ['a declared runner nothing uses', { runners: { gate: { label: 'g', gateManifest: true }, idle: { label: 'i' } } }, /"idle" is declared but runs nothing/],
];

for (const [name, override, pattern] of cases) {
  const problems = testEstateProblems(fixture(override));
  assert.ok(problems.some((p) => pattern.test(p)), `${name} is caught: got ${JSON.stringify(problems)}`);
}

// The evidence half: a claim is only worth having if an unbacked one fails.
{
  // In the gate manifest, but the workflow's gate job runs something else.
  const drifted = testEstateProblems(
    fixture({ gateTests: [], workflow: '\n  gate:\n    steps:\n      - run: node test/a/other.mjs\n' }),
  );
  assert.ok(
    drifted.some((p) => /one\.mjs claims runner "gate" but nothing invokes it there/.test(p)),
    'a runner that no longer runs the file is caught',
  );

  // The job the runner names has been deleted from the workflow.
  const goneJob = testEstateProblems(fixture({ workflow: '\n  other:\n    steps: []\n' }));
  assert.ok(
    goneJob.some((p) => /names job "gate", which .* does not declare/.test(p)),
    'a runner naming a job the workflow lost is caught',
  );

  // An npm script channel that package.json no longer defines.
  const goneScript = testEstateProblems(
    fixture({ runners: { gate: { label: 'g', npmScript: 'test:missing' } } }),
  );
  assert.ok(
    goneScript.some((p) => /names npm script "test:missing"/.test(p)),
    'a runner naming a missing npm script is caught',
  );

  // A job invoking the file only through an npm script still counts.
  const viaScript = testEstateProblems(
    fixture({
      gateTests: [],
      scripts: { 'test:one': 'node test/a/one.mjs' },
      workflow: '\n  gate:\n    steps:\n      - run: npm run test:one\n',
    }),
  );
  assert.deepEqual(viaScript, [], 'a job that shells out to an npm script proves the claim');

  // A hand-run exclusion whose npm script runs a different file.
  const wrongTool = testEstateProblems(
    fixture({
      excluded: { 'test/a/two.mjs': 'hand-run: npm run test:one' },
      scripts: { 'test:ci-gate': 'x', 'test:one': 'node test/a/elsewhere.mjs' },
    }),
  );
  assert.ok(
    wrongTool.some((p) => /two\.mjs sends a human to "npm run test:one", which runs something else/.test(p)),
    'an exclusion pointing at the wrong command is caught',
  );
}

console.log(
  `test-estate: ${Object.keys(TEST_ESTATE).length} run by a named job, ` +
    `${Object.keys(TEST_ESTATE_EXCLUDED).length} excluded with a reason, ${world.files.length} on disk`,
);
