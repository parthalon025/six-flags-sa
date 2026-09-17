#!/usr/bin/env node
/**
 * Emit canon lane plan as GitHub Actions outputs (test-app.yml select job).
 *
 *   node scripts/ci/lane-plan.mjs --base origin/main
 */
import { appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { laneGithubOutputs } from '../lib/ci-lane-plan.mjs';
import { gitChangedFiles } from '../lib/local-ci-pass.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function parseBase(argv) {
  const idx = argv.indexOf('--base');
  return idx >= 0 ? argv[idx + 1] : 'origin/main';
}

/** @param {string} baseRef @param {{ cwd?: string, headRef?: string }} [opts] */
export function lanePlanGithubOutputs(baseRef, { cwd = root, headRef = 'HEAD' } = {}) {
  const { files } = gitChangedFiles(baseRef, headRef, cwd);
  return laneGithubOutputs(files);
}

function main(argv = process.argv.slice(2)) {
  const baseRef = parseBase(argv);
  const outs = lanePlanGithubOutputs(baseRef, { cwd: root });
  const lines = Object.entries(outs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) main();
