#!/usr/bin/env node
/**
 * Select CI / validate-ui modules from git changes (or an explicit file list).
 *
 *   node test/app/select-modules.mjs
 *   node test/app/select-modules.mjs --base origin/main
 *   node test/app/select-modules.mjs --files apps/party-tracker/lib/party/x.js
 *   node test/app/select-modules.mjs --format github   # writes $GITHUB_OUTPUT
 *   node test/app/select-modules.mjs --all
 */

import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  selectModulesFromFiles,
  toGithubOutputs,
  partitionModules,
} from './lib/module-select.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

const args = process.argv.slice(2);
const formatIdx = args.indexOf('--format');
const format = formatIdx >= 0 ? args[formatIdx + 1] || 'text' : 'text';
const baseIdx = args.indexOf('--base');
const base = baseIdx >= 0 ? args[baseIdx + 1] : process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.TEST_BASE_REF || 'origin/main';
const wantAll = args.includes('--all') || process.env.TEST_MODULES === 'all';
const filesIdx = args.indexOf('--files');

function gitDiffNames(ref) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', ref], {
      cwd: ROOT,
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      env: scrubGitEnv(),
      encoding: 'utf8',
    }).trim();
    const out = execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], {
      cwd: ROOT,
      env: scrubGitEnv(),
      encoding: 'utf8',
    });
    return out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (err) {
    console.error(`select-modules: git diff failed (${err.message}); falling back to --all`);
    return null;
  }
}

function explicitFiles() {
  if (filesIdx < 0) return null;
  const rest = [];
  for (let i = filesIdx + 1; i < args.length; i += 1) {
    if (args[i].startsWith('--')) break;
    rest.push(args[i]);
  }
  return rest;
}

const manifest = loadModulesManifest();
let selection;

if (wantAll) {
  selection = {
    modules: manifest.modules.map((m) => m.id),
    reasons: Object.fromEntries(manifest.modules.map((m) => [m.id, '--all'])),
    fullSuite: true,
  };
} else {
  const files = explicitFiles() || gitDiffNames(base);
  if (!files) {
    selection = {
      modules: manifest.modules.map((m) => m.id),
      reasons: Object.fromEntries(manifest.modules.map((m) => [m.id, 'git fallback'])),
      fullSuite: true,
    };
  } else if (!files.length) {
    // Empty diff (e.g. workflow_dispatch on same commit) — still run contract.
    selection = selectModulesFromFiles([], manifest);
  } else {
    selection = selectModulesFromFiles(files, manifest);
  }
}

const parts = partitionModules(selection.modules, manifest);

if (format === 'json') {
  console.log(JSON.stringify({ ...selection, parts }, null, 2));
} else if (format === 'github') {
  const outs = toGithubOutputs(selection, manifest);
  const lines = Object.entries(outs).map(([k, v]) => `${k}=${v}`);
  console.log(lines.join('\n'));
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
} else if (format === 'modules') {
  console.log(selection.modules.join(','));
} else {
  console.log(`select-modules: ${selection.modules.length} module(s)${selection.fullSuite ? ' (full suite)' : ''}`);
  for (const id of selection.modules) {
    console.log(`  - ${id}: ${selection.reasons[id] || ''}`);
  }
  console.log(`builder=${parts.builder} lint=${parts.lint} selector=${parts.selector} functional=${parts.functional.join(',') || '-'} grandma=${parts.grandma}`);
}

if (args.includes('--write')) {
  const outPath = path.join(HERE, '.selected-modules.json');
  writeFileSync(outPath, JSON.stringify({ ...selection, parts }, null, 2));
  console.error(`wrote ${outPath}`);
}
