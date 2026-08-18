/**
 * Local CI pass stamp — record pre-merge-vertical success so reruns and GitHub
 * Actions can skip work that already passed on the same tree.
 *
 * Interface:
 *   buildLocalCiContext({ cwd, baseRef })
 *   readLocalCiPass(cwd)
 *   writeLocalCiPass(stamp, cwd)
 *   stampCoversContext(stamp, context)
 *   shouldSkipLocalPreMerge(stamp, context, { skipBrowser })
 *   shouldSkipGithubUi(stamp, context, { anyUi })
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  selectModulesFromFiles,
} from '../../test/app/lib/module-select.mjs';
import { requiredVerticals, stampCoversVerticals } from './vertical-e2e.mjs';

function needsBrowserForFiles(files, manifest) {
  if (files == null) return true;
  if (!files.length) return false;
  return selectModulesFromFiles(files, manifest).modules.length > 0;
}

// 2: stamps record which verticals ran, so a pass cannot be claimed for a
// code diff whose vertical e2e never executed.
export const LOCAL_CI_PASS_SCHEMA = 2;
export const LOCAL_CI_PASS_REL = 'scripts/ci/local-ci-pass.json';

export const STATIC_STEP_IDS = ['test:ci-gate', 'test:unit', 'build'];

function repoRootFrom(cwd) {
  return join(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function localCiPassPath(cwd = repoRootFrom()) {
  return join(cwd, LOCAL_CI_PASS_REL);
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function hashFile(path) {
  if (!existsSync(path)) return null;
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export function gitChangedFiles(baseRef = 'origin/main', cwd = repoRootFrom()) {
  try {
    const mergeBase = git(cwd, ['merge-base', 'HEAD', baseRef]);
    const out = git(cwd, ['diff', '--name-only', `${mergeBase}...HEAD`]);
    return {
      mergeBase,
      files: out
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    };
  } catch {
    return { mergeBase: null, files: null };
  }
}

export function buildLocalCiContext({
  baseRef = 'origin/main',
  cwd = repoRootFrom(),
  manifest = loadModulesManifest(),
} = {}) {
  const head = git(cwd, ['rev-parse', 'HEAD']);
  const { mergeBase, files } = gitChangedFiles(baseRef, cwd);
  const selection =
    files == null
      ? { modules: manifest.modules.map((m) => m.id), fullSuite: true }
      : selectModulesFromFiles(files, manifest);
  const modules = [...selection.modules].sort();
  const needsBrowser = files == null ? true : needsBrowserForFiles(files, manifest);

  return {
    schema: LOCAL_CI_PASS_SCHEMA,
    verticals: requiredVerticals(files),
    head,
    mergeBase,
    baseRef,
    modules,
    needsBrowser,
    staticSteps: [...STATIC_STEP_IDS],
    lockHash: hashFile(join(cwd, 'package-lock.json')),
    manifestHash: hashFile(join(cwd, 'test/app/modules.json')),
  };
}

export function readLocalCiPass(cwd = repoRootFrom()) {
  const path = localCiPassPath(cwd);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function writeLocalCiPass(
  {
    context,
    browserVertical = false,
    verticals = [],
    recordedAt = new Date().toISOString(),
  },
  cwd = repoRootFrom(),
) {
  const stamp = {
    schema: LOCAL_CI_PASS_SCHEMA,
    head: context.head,
    mergeBase: context.mergeBase,
    baseRef: context.baseRef,
    modules: context.modules,
    browserVertical,
    verticals: [...verticals].sort(),
    staticSteps: context.staticSteps,
    lockHash: context.lockHash,
    manifestHash: context.manifestHash,
    recordedAt,
  };
  const path = localCiPassPath(cwd);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(stamp, null, 2)}\n`, 'utf8');
  return stamp;
}

function sortedEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}

/** True when the stamp matches the current tree and module selection. */
export function stampCoversContext(stamp, context) {
  if (!stamp || stamp.schema !== LOCAL_CI_PASS_SCHEMA) return false;
  if (stamp.head !== context.head) return false;
  if (stamp.mergeBase !== context.mergeBase) return false;
  if (stamp.baseRef !== context.baseRef) return false;
  if (!sortedEq(stamp.modules, context.modules)) return false;
  if (!sortedEq(stamp.staticSteps, context.staticSteps)) return false;
  if (stamp.lockHash !== context.lockHash) return false;
  if (stamp.manifestHash !== context.manifestHash) return false;
  return true;
}

/** Skip a local pre-merge-vertical run when the stamp already covers this tree. */
export function shouldSkipLocalPreMerge(
  stamp,
  context,
  { skipBrowser = false } = {},
) {
  if (!stampCoversContext(stamp, context)) return false;
  if (!stampCoversVerticals(stamp, context.verticals)) return false;
  if (!context.needsBrowser || skipBrowser) return true;
  return stamp.browserVertical === true;
}

/**
 * Skip expensive GitHub UI jobs when a committed stamp proves the same tree
 * already passed browser vertical locally.
 */
export function shouldSkipGithubUi(stamp, context, { anyUi = false } = {}) {
  if (!anyUi) return false;
  if (!stampCoversContext(stamp, context)) return false;
  return stamp.browserVertical === true;
}
