/**
 * Agent-policy diffs — wayfinder maps, ADRs, and machine-readable Matt policy JSON.
 *
 * These owe no vertical e2e lane and no matt-review stamp. A thin policy test
 * run proves the JSON still parses and workflow exports stay coherent.
 *
 * Interface:
 *   agentPolicyPathPatterns()
 *   isAgentPolicyFile(file)
 *   isAgentPolicyOnlyDiff(files)
 *   policyTestsForFiles(files)
 *   runPolicyTestsForFiles(files, cwd)
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathMatchesAny } from '../../test/app/lib/module-select.mjs';
import { listCommittedWayfinderSlugs } from './wayfinder-committed.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const STAMP_EXCLUDES = [
  'scripts/ci/matt-review-pass.json',
  'scripts/ci/local-ci-pass.json',
];

/** Repo-relative path → one gate test that proves the policy file. */
const POLICY_TEST_ROWS = [
  {
    paths: ['scripts/lib/operating-stack.json'],
    test: 'test/scripts/operating-stack.test.mjs',
  },
  {
    paths: ['scripts/lib/wayfinder-committed.json', 'scripts/lib/wayfinder-committed.mjs'],
    test: 'test/scripts/wayfinder-committed.test.mjs',
  },
];

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Patterns for committed wayfinder + agent prose + epic policy JSON. */
export function agentPolicyPathPatterns() {
  const scratch = listCommittedWayfinderSlugs().map((slug) => `.scratch/${slug}/**`);
  return [
    ...scratch,
    'docs/adr/**',
    'docs/agents/**',
    'CONTEXT.md',
    'AGENTS.md',
    'CLAUDE.md',
    'scripts/lib/operating-stack.json',
    'scripts/lib/wayfinder-committed.json',
  ];
}

export function isAgentPolicyFile(file) {
  const f = normalize(file);
  if (!f || STAMP_EXCLUDES.includes(f)) return false;
  return pathMatchesAny(f, agentPolicyPathPatterns());
}

/** True when every changed file is agent policy — no app/factories/backside vertical. */
export function isAgentPolicyOnlyDiff(files) {
  if (files == null || !files.length) return false;
  const paths = files.map(normalize).filter((f) => f && !STAMP_EXCLUDES.includes(f));
  if (!paths.length) return false;
  return paths.every(isAgentPolicyFile);
}

/** Gate tests to run for the policy files touched in this diff. */
export function policyTestsForFiles(files = []) {
  const tests = new Set();
  for (const file of files) {
    const f = normalize(file);
    for (const row of POLICY_TEST_ROWS) {
      if (pathMatchesAny(f, row.paths)) tests.add(row.test);
    }
    if (pathMatchesAny(f, agentPolicyPathPatterns().filter((p) => p.startsWith('.scratch/')))) {
      tests.add('test/scripts/wayfinder-committed.test.mjs');
    }
  }
  return [...tests].sort();
}

/** Run policy gate tests; returns exit code (0 ok). */
export function runPolicyTestsForFiles(files, cwd = root, execPath = process.execPath) {
  const tests = policyTestsForFiles(files);
  for (const rel of tests) {
    const r = spawnSync(execPath, [join(cwd, rel)], { cwd, stdio: 'inherit' });
    if (r.status !== 0) return r.status ?? 1;
  }
  return 0;
}
