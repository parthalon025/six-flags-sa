#!/usr/bin/env node
/**
 * Test-estate accounting — every suite under test/ is run by something named,
 * or excluded for a written reason.
 *
 * The completeness half is the same shape as ci-module.test.mjs, widened from
 * test/scripts to the whole tree. The half that matters more is the evidence:
 * a run list is only worth having if it cannot lie, so each claimed runner is
 * checked against package.json, the gate manifest and the workflow rather than
 * being taken at its word.
 *
 *   node test/scripts/test-estate.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_SCRIPT_TESTS } from '../../scripts/ci/manifest.mjs';
import { TEST_ESTATE, TEST_ESTATE_EXCLUDED, TEST_RUNNERS } from '../../scripts/ci/test-estate.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_REL = '.github/workflows/test-app.yml';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
const workflow = readFileSync(join(ROOT, WORKFLOW_REL), 'utf8');

function testFilesOnDisk(dir = join(ROOT, 'test')) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFilesOnDisk(abs));
    else if (entry.name.endsWith('.mjs')) out.push(relative(ROOT, abs).replace(/\\/g, '/'));
  }
  return out.sort();
}

/** The body of one workflow job: from its `  <name>:` line to the next job. */
function jobBody(name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) return null;
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** npm scripts a workflow job shells out to, resolved to their commands. */
function commandsInJob(body) {
  const commands = [body];
  for (const m of body.matchAll(/npm run ([\w:-]+)/g)) {
    if (pkg[m[1]]) commands.push(pkg[m[1]]);
  }
  return commands;
}

const onDisk = testFilesOnDisk();
const listed = Object.keys(TEST_ESTATE);
const excluded = Object.keys(TEST_ESTATE_EXCLUDED);

// 1. Completeness — a suite in neither list is a suite nobody is accountable for.
for (const rel of onDisk) {
  assert.ok(
    rel in TEST_ESTATE || rel in TEST_ESTATE_EXCLUDED,
    `${rel} is in neither TEST_ESTATE nor TEST_ESTATE_EXCLUDED (scripts/ci/test-estate.mjs) — name the job that runs it, or write down why nothing does`,
  );
}

// 2. Both lists describe files that are really there.
for (const rel of [...listed, ...excluded]) {
  assert.ok(onDisk.includes(rel), `${rel} is listed in the test estate but missing on disk`);
}

// 3. Never both.
for (const rel of excluded) {
  assert.ok(!(rel in TEST_ESTATE), `${rel} is both run and excluded`);
}

// 4. Excluded entries carry a reason, and every listed file names a real runner.
for (const [rel, reason] of Object.entries(TEST_ESTATE_EXCLUDED)) {
  assert.equal(typeof reason, 'string', `${rel} needs a written reason`);
  assert.ok(reason.trim(), `${rel} needs a written reason`);
}
for (const [rel, runners] of Object.entries(TEST_ESTATE)) {
  assert.ok(Array.isArray(runners) && runners.length, `${rel} names no runner`);
  for (const id of runners) {
    assert.ok(id in TEST_RUNNERS, `${rel} names unknown runner "${id}"`);
  }
}

// 5. Every declared runner is used — an unused one is a job that no longer runs.
{
  const used = new Set(Object.values(TEST_ESTATE).flat());
  for (const id of Object.keys(TEST_RUNNERS)) {
    assert.ok(used.has(id), `runner "${id}" is declared but runs nothing`);
  }
}

// 6. The evidence. Each claim is checked where the run really lives, so the
//    run list cannot drift away from package.json or the workflow.
for (const [rel, runners] of Object.entries(TEST_ESTATE)) {
  for (const id of runners) {
    const runner = TEST_RUNNERS[id];
    const proofs = [];

    if (runner.npmScript) {
      assert.ok(pkg[runner.npmScript], `runner "${id}" names missing npm script ${runner.npmScript}`);
      if (pkg[runner.npmScript].includes(rel)) proofs.push(`npm run ${runner.npmScript}`);
    }
    if (runner.gateManifest && GATE_SCRIPT_TESTS.includes(rel)) {
      proofs.push('GATE_SCRIPT_TESTS');
    }
    if (runner.job) {
      const body = jobBody(runner.job);
      assert.ok(body, `runner "${id}" names job "${runner.job}", which ${WORKFLOW_REL} does not declare`);
      if (commandsInJob(body).some((c) => c.includes(rel))) proofs.push(`job ${runner.job}`);
    }
    if (runner.spawnedFrom) {
      const src = readFileSync(join(ROOT, runner.spawnedFrom), 'utf8');
      if (src.includes(rel.split('/').pop())) proofs.push(runner.spawnedFrom);
    }

    assert.ok(
      proofs.length,
      `${rel} claims runner "${id}" but nothing proves it: ${runner.label}`,
    );
  }
}

// 7. The tools kept out of CI are kept runnable: each one a person is expected
//    to run by hand has the npm script its reason names.
for (const [rel, reason] of Object.entries(TEST_ESTATE_EXCLUDED)) {
  for (const m of reason.matchAll(/npm run ([\w:-]+)/g)) {
    assert.ok(pkg[m[1]], `${rel} tells a human to run "npm run ${m[1]}", which package.json does not define`);
    assert.ok(
      pkg[m[1]].includes(rel),
      `${rel} tells a human to run "npm run ${m[1]}", which runs something else`,
    );
  }
}

console.log(
  `test-estate: ${listed.length} run by a named job, ${excluded.length} excluded with a reason, ${onDisk.length} on disk`,
);
