/**
 * Test-estate integrator audit — surfaces wiring gaps before the gate runs.
 *
 * Slice agents write tests; the integrator wires manifest.mjs, test-estate.mjs,
 * and package.json. This module is the checklist: one call reports every orphan
 * the three guards would catch, with dry-run suggestions for the fix.
 *
 * Interface:
 *   gateManifestProblems(root, gateTests, gateExcluded)
 *   suiteWiringProblems(root, options)
 *   auditTestIntegration(root, options)
 *   suggestIntegrationFixes(audit)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { GATE_SCRIPT_TESTS, GATE_EXCLUDED_TESTS } from '../ci/manifest.mjs';
import { TEST_ESTATE, TEST_ESTATE_EXCLUDED, TEST_RUNNERS } from '../ci/test-estate.mjs';
import { readTestEstateWorld, testEstateProblems } from './test-estate.mjs';

/** Same exemptions as test/scripts/suite-wiring.test.mjs — keep in sync. */
export const SUITE_WIRING_NOT_WIRED = Object.freeze({
  'test/app/audit-mobile.mjs': 'hand-run audit tool, prints findings rather than asserting',
  'test/app/audit-overlap.mjs': 'hand-run audit tool, prints findings rather than asserting',
  'test/app/audit-visual.mjs': 'hand-run audit tool, prints findings rather than asserting',
  'test/app/browser.mjs': 'shared browser harness imported by the functional modules',
});

export const SUITE_WIRING_DIRS = ['test/builder', 'test/app'];

/**
 * @returns {string[]} test/scripts files in neither GATE_SCRIPT_TESTS nor GATE_EXCLUDED_TESTS
 */
export function gateManifestProblems(root, gateTests = GATE_SCRIPT_TESTS, gateExcluded = GATE_EXCLUDED_TESTS) {
  const testDir = join(root, 'test/scripts');
  const onDisk = readdirSync(testDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `test/scripts/${f}`);
  const problems = [];
  for (const rel of onDisk) {
    if (!gateTests.includes(rel) && !(rel in gateExcluded)) {
      problems.push(`${rel} is in neither GATE_SCRIPT_TESTS nor GATE_EXCLUDED_TESTS`);
    }
  }
  for (const rel of gateTests) {
    if (!rel.startsWith('test/scripts/')) {
      problems.push(`${rel} in GATE_SCRIPT_TESTS is not under test/scripts/`);
    } else if (!onDisk.includes(rel)) {
      problems.push(`${rel} listed in GATE_SCRIPT_TESTS but missing on disk`);
    }
  }
  return problems;
}

/**
 * @returns {string[]} builder/app suites not referenced by any npm script or NOT_WIRED
 */
export function suiteWiringProblems(
  root,
  {
    dirs = SUITE_WIRING_DIRS,
    notWired = SUITE_WIRING_NOT_WIRED,
  } = {},
) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const allScripts = [
    Object.values(pkg.scripts).join(' && '),
    readFileSync(join(root, 'test/app/modules.json'), 'utf8'),
  ].join('\n');
  const problems = [];
  for (const dir of dirs) {
    const suites = readdirSync(join(root, dir))
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => `${dir}/${f}`);
    for (const rel of suites) {
      if (!allScripts.includes(rel) && !(rel in notWired)) {
        problems.push(`${rel} is in no npm script — add to test:builder, test:unit, or NOT_WIRED`);
      }
    }
  }
  return problems;
}

/**
 * @returns {{ estate: string[], gate: string[], wiring: string[], clean: boolean }}
 */
export function auditTestIntegration(
  root,
  {
    estate = TEST_ESTATE,
    excluded = TEST_ESTATE_EXCLUDED,
    runners = TEST_RUNNERS,
    gateTests = GATE_SCRIPT_TESTS,
    gateExcluded = GATE_EXCLUDED_TESTS,
  } = {},
) {
  const world = readTestEstateWorld(root, { estate, excluded, runners, gateTests });
  const estateProblems = testEstateProblems(world);
  const gateProblems = gateManifestProblems(root, gateTests, gateExcluded);
  const wiringProblems = suiteWiringProblems(root);
  return {
    estate: estateProblems,
    gate: gateProblems,
    wiring: wiringProblems,
    clean: estateProblems.length === 0 && gateProblems.length === 0 && wiringProblems.length === 0,
  };
}

/**
 * @returns {string[]} human-readable fix hints (dry-run only — never writes files)
 */
export function suggestIntegrationFixes({ estate, gate, wiring }) {
  const hints = [];
  for (const problem of gate) {
    const match = problem.match(/^(test\/scripts\/[^\s]+)/);
    if (match && problem.includes('neither GATE_SCRIPT_TESTS')) {
      hints.push(`Add ${match[1]} to scripts/ci/manifest.mjs GATE_SCRIPT_TESTS and scripts/ci/test-estate.mjs ['ci-gate']`);
    } else if (match && problem.includes('missing on disk')) {
      hints.push(`Remove ${match[1]} from scripts/ci/manifest.mjs GATE_SCRIPT_TESTS`);
    } else {
      hints.push(`Gate: ${problem}`);
    }
  }
  for (const problem of wiring) {
    const match = problem.match(/^(test\/(?:builder|app)\/[^\s]+)/);
    if (match) {
      const rel = match[1];
      const script = rel.startsWith('test/builder/') ? 'test:builder' : 'test:unit';
      hints.push(`Append "node ${rel}" to package.json "${script}" and add '${rel}': ['${script}'] to scripts/ci/test-estate.mjs`);
    } else {
      hints.push(`Wiring: ${problem}`);
    }
  }
  for (const problem of estate) {
    if (problem.includes('is in neither TEST_ESTATE')) {
      const match = problem.match(/^(test\/[^\s]+)/);
      if (match) {
        const rel = match[1];
        if (rel.startsWith('test/scripts/')) {
          hints.push(`Add ${rel} to scripts/ci/test-estate.mjs ['ci-gate'] and scripts/ci/manifest.mjs GATE_SCRIPT_TESTS`);
        } else if (rel.startsWith('test/builder/')) {
          hints.push(`Add ${rel} to scripts/ci/test-estate.mjs ['test:builder'] and package.json test:builder`);
        } else if (rel.startsWith('test/app/')) {
          hints.push(`Add ${rel} to scripts/ci/test-estate.mjs ['test:unit'] and package.json test:unit`);
        }
      }
    } else if (problem.includes('claims runner') && problem.includes('but nothing invokes')) {
      hints.push(`Estate claim not backed: ${problem} — wire the file in package.json or manifest.mjs`);
    } else {
      hints.push(`Estate: ${problem}`);
    }
  }
  return hints;
}
