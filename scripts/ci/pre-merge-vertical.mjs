/**
 * Pre-merge vertical validation — static checks + browser vertical when the diff warrants it.
 *
 * Interface:
 *   gitChangedFiles(baseRef, cwd)
 *   needsBrowserVertical(files, manifest)
 *   runPreMergeVertical({ baseRef, skipBrowser, cwd })
 *
 * CLI:
 *   node scripts/ci/pre-merge-vertical.mjs [--base origin/main] [--skip-browser] [--no-stamp]
 *   npm run test:pre-merge-vertical
 */
import { spawn, spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadModulesManifest,
  selectModulesFromFiles,
} from '../../test/app/lib/module-select.mjs';
import {
  startProductionServer,
  waitForHealth,
} from './party-tracker-ui.mjs';
import {
  buildLocalCiContext,
  readLocalCiPass,
  shouldSkipLocalPreMerge,
  writeLocalCiPass,
} from '../lib/local-ci-pass.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export const STATIC_NPM_STEPS = [
  ['run', 'test:ci-gate'],
  ['run', 'test:unit'],
  ['run', 'build', '-w', '@party-tracker/app'],
];

export function gitChangedFiles(baseRef = 'origin/main', cwd = root) {
  try {
    const mergeBase = execFileSync('git', ['merge-base', 'HEAD', baseRef], {
      cwd,
      encoding: 'utf8',
    }).trim();
    const out = execFileSync('git', ['diff', '--name-only', `${mergeBase}...HEAD`], {
      cwd,
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return null;
  }
}

export function needsBrowserVertical(files, manifest = loadModulesManifest()) {
  if (files == null) return true;
  if (!files.length) return false;
  const sel = selectModulesFromFiles(files, manifest);
  return sel.modules.length > 0;
}

export function runNpmStep(args, cwd = root) {
  const r = spawnSync('npm', args, { cwd, stdio: 'inherit' });
  return r.status ?? 1;
}

function runValidateUiChanged(baseRef, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npm',
      ['run', 'test:validate-ui:changed', '--', '--base', baseRef, '--no-health'],
      { cwd, stdio: 'inherit', env: process.env },
    );
    child.on('error', reject);
    child.on('close', (code) => {
      if (code) reject(new Error(`test:validate-ui:changed exited ${code}`));
      else resolve();
    });
  });
}

export async function runPreMergeVertical({
  baseRef = 'origin/main',
  skipBrowser = false,
  noStamp = false,
  cwd = root,
} = {}) {
  const context = buildLocalCiContext({ baseRef, cwd });
  const existing = readLocalCiPass(cwd);
  if (shouldSkipLocalPreMerge(existing, context, { skipBrowser })) {
    console.log('pre-merge-vertical: local CI pass stamp covers this tree — skipping');
    return 0;
  }

  for (const args of STATIC_NPM_STEPS) {
    console.log(`\npre-merge-vertical: npm ${args.join(' ')}`);
    const code = runNpmStep(args, cwd);
    if (code !== 0) return code;
  }

  if (skipBrowser) {
    console.log('pre-merge-vertical: browser vertical skipped (--skip-browser)');
    if (!noStamp) {
      writeLocalCiPass({ context, browserVertical: false }, cwd);
    }
    return 0;
  }

  const files = gitChangedFiles(baseRef, cwd);
  if (!needsBrowserVertical(files)) {
    console.log('pre-merge-vertical: no UI modules for diff — browser vertical skipped');
    if (!noStamp) {
      writeLocalCiPass({ context, browserVertical: false }, cwd);
    }
    return 0;
  }

  console.log('\npre-merge-vertical: starting app for browser vertical');
  startProductionServer({ root: cwd });
  await waitForHealth();
  await runValidateUiChanged(baseRef, cwd);
  if (!noStamp) {
    writeLocalCiPass({ context, browserVertical: true }, cwd);
  }
  return 0;
}

async function main(argv = process.argv.slice(2)) {
  const baseIdx = argv.indexOf('--base');
  const baseRef = baseIdx >= 0 ? argv[baseIdx + 1] : 'origin/main';
  const skipBrowser = argv.includes('--skip-browser');
  const noStamp = argv.includes('--no-stamp');
  const code = await runPreMergeVertical({ baseRef, skipBrowser, noStamp });
  if (code !== 0) process.exit(code);
  console.log('\npre-merge-vertical: ok');
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
