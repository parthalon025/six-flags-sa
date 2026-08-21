/**
 * Test-estate accounting — the decision behind `scripts/ci/test-estate.mjs`.
 *
 * The list of suites is data; deciding whether that list is *true* is logic,
 * and it lives here so it can be exercised against worlds that are broken on
 * purpose rather than only against the one world that happens to be correct.
 *
 * The rule it enforces, in one line: every `.mjs` under `test/` is run by a
 * named job or excluded for a written reason, and every claimed job is one that
 * package.json, the gate manifest or the workflow can be shown to invoke.
 *
 * Interface:
 *   readTestEstateWorld(root)
 *   testEstateProblems(world)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export const WORKFLOW_REL = '.github/workflows/test-app.yml';

/** Every `.mjs` under `test/`, repo-relative, sorted. */
function testFilesUnder(root) {
  const walk = (dir) => {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(abs));
      else if (entry.name.endsWith('.mjs')) out.push(relative(root, abs).replace(/\\/g, '/'));
    }
    return out;
  };
  return walk(join(root, 'test')).sort();
}

/**
 * Everything the audit reads, gathered once. Split from the audit so a caller
 * can hand it a world that never existed on disk.
 */
export function readTestEstateWorld(root, { estate, excluded, runners, gateTests }) {
  return {
    estate,
    excluded,
    runners,
    gateTests,
    files: testFilesUnder(root),
    scripts: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts,
    workflow: readFileSync(join(root, WORKFLOW_REL), 'utf8'),
    readFile: (rel) => readFileSync(join(root, rel), 'utf8'),
  };
}

/** The body of one workflow job: its `  <name>:` line to the next job's. */
export function jobBody(workflow, name) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  if (start < 0) return null;
  const rest = workflow.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/** A job's own text plus the commands of every npm script it shells out to. */
function commandsInJob(body, scripts) {
  const out = [body];
  for (const m of body.matchAll(/npm run ([\w:-]+)/g)) {
    if (scripts[m[1]]) out.push(scripts[m[1]]);
  }
  return out;
}

/**
 * How a claim on a runner is proven. A runner may declare several channels;
 * one of them has to name the file, or the claim is not evidence of anything.
 *
 * @returns {{proofs: string[], broken: string[]}}
 */
function proveRunner(rel, runner, world) {
  const proofs = [];
  const broken = [];

  if (runner.npmScript) {
    const command = world.scripts[runner.npmScript];
    if (!command) broken.push(`names npm script "${runner.npmScript}", which package.json does not define`);
    else if (command.includes(rel)) proofs.push(`npm run ${runner.npmScript}`);
  }
  if (runner.gateManifest && world.gateTests.includes(rel)) {
    proofs.push('GATE_SCRIPT_TESTS');
  }
  if (runner.job) {
    const body = jobBody(world.workflow, runner.job);
    if (!body) broken.push(`names job "${runner.job}", which ${WORKFLOW_REL} does not declare`);
    else if (commandsInJob(body, world.scripts).some((c) => c.includes(rel))) {
      proofs.push(`job ${runner.job}`);
    }
  }
  if (runner.spawnedFrom) {
    let src = null;
    try {
      src = world.readFile(runner.spawnedFrom);
    } catch {
      broken.push(`spawns from "${runner.spawnedFrom}", which is not there any more`);
    }
    if (src !== null && src.includes(rel.split('/').pop())) proofs.push(runner.spawnedFrom);
  }
  return { proofs, broken };
}

/**
 * Everything wrong with the estate, one readable line each. Empty means the
 * run list is complete and every claim in it is backed.
 *
 * @returns {string[]}
 */
export function testEstateProblems(world) {
  const { estate, excluded, runners, files } = world;
  const problems = [];

  for (const rel of files) {
    if (!(rel in estate) && !(rel in excluded)) {
      problems.push(
        `${rel} is in neither TEST_ESTATE nor TEST_ESTATE_EXCLUDED — name the job that runs it, or write down why nothing does`,
      );
    }
  }
  for (const rel of [...Object.keys(estate), ...Object.keys(excluded)]) {
    if (!files.includes(rel)) problems.push(`${rel} is listed in the test estate but missing on disk`);
  }
  for (const rel of Object.keys(excluded)) {
    if (rel in estate) problems.push(`${rel} is both run and excluded`);
  }

  for (const [rel, reason] of Object.entries(excluded)) {
    if (typeof reason !== 'string' || !reason.trim()) {
      problems.push(`${rel} is excluded with no written reason`);
      continue;
    }
    // A tool kept out of CI still has to be runnable by the person the reason
    // sends to it, so the command it names has to exist and has to run it.
    for (const m of reason.matchAll(/npm run ([\w:-]+)/g)) {
      const command = world.scripts[m[1]];
      if (!command) problems.push(`${rel} sends a human to "npm run ${m[1]}", which package.json does not define`);
      else if (!command.includes(rel)) {
        problems.push(`${rel} sends a human to "npm run ${m[1]}", which runs something else`);
      }
    }
  }

  const used = new Set();
  for (const [rel, ids] of Object.entries(estate)) {
    if (!Array.isArray(ids) || !ids.length) {
      problems.push(`${rel} names no runner`);
      continue;
    }
    for (const id of ids) {
      used.add(id);
      const runner = runners[id];
      if (!runner) {
        problems.push(`${rel} names unknown runner "${id}"`);
        continue;
      }
      const { proofs, broken } = proveRunner(rel, runner, world);
      for (const b of broken) problems.push(`runner "${id}" ${b}`);
      if (!proofs.length) problems.push(`${rel} claims runner "${id}" but nothing invokes it there`);
    }
  }
  for (const id of Object.keys(runners)) {
    if (!used.has(id)) problems.push(`runner "${id}" is declared but runs nothing`);
  }

  return problems;
}
