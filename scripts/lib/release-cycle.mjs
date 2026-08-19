/**
 * Event-driven release cycle — matches how Park Bound actually ships:
 * web on every main merge; store binaries only when native paths change + you dispatch store.yml.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from './git-env.mjs';
import { classifyStoreRelease } from './store-release-plan.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadReleaseCycleConfig(configPath) {
  const path = configPath ?? join(__dirname, 'release-cycle.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readAppVersion(repoRoot) {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'apps/party-tracker/package.json'), 'utf8'),
  );
  return pkg.version;
}

/**
 * Every git call below names its repository with `cwd: repoRoot`. An inherited
 * GIT_DIR outranks that, so under a git hook these would read the hook's
 * repository instead of the one asked for. See scripts/lib/git-env.mjs.
 *
 * Read per call, not cached at import: a caller that adjusts process.env before
 * invoking should get the environment it set, not the one that happened to be
 * live when the module first loaded.
 */
const gitEnv = () => scrubGitEnv();

export function latestStoreTag(repoRoot, prefix = 'store/') {
  try {
    const out = execFileSync(
      'git',
      ['tag', '-l', `${prefix}*`, '--sort=-v:refname'],
      { cwd: repoRoot, env: gitEnv(), encoding: 'utf8' },
    );
    const tag = out.split('\n').map((line) => line.trim()).find(Boolean);
    return tag ?? null;
  } catch {
    return null;
  }
}

function gitRefExists(repoRoot, ref) {
  try {
    execFileSync('git', ['rev-parse', '--verify', ref], {
      cwd: repoRoot,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function gitDiffNames(repoRoot, base, head = 'HEAD') {
  const out = execFileSync('git', ['diff', '--name-only', base, head], {
    cwd: repoRoot,
    env: gitEnv(),
    encoding: 'utf8',
  });
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

/** Prefer deep history when available; CI gate uses fetch-depth: 2. */
const RECENT_COMMIT_FALLBACKS = [
  'HEAD~20',
  'HEAD~10',
  'HEAD~5',
  'HEAD~1',
  'origin/main',
];

export function changedFilesSinceRef(repoRoot, ref) {
  if (!ref) {
    for (const base of RECENT_COMMIT_FALLBACKS) {
      if (gitRefExists(repoRoot, base)) {
        return gitDiffNames(repoRoot, base);
      }
    }
    return [];
  }

  try {
    return gitDiffNames(repoRoot, `${ref}...HEAD`);
  } catch {
    return gitDiffNames(repoRoot, ref);
  }
}

/**
 * @typedef {'web_continuous' | 'native_pending' | 'first_store_submit'} ReleaseMode
 */

/**
 * @param {object} [options]
 * @param {string} [options.repoRoot]
 * @param {string} [options.sinceRef] override diff base (e.g. store/2026-08)
 * @param {object} [options.config]
 */
export function buildReleaseCycleReport(options = {}) {
  const repoRoot = options.repoRoot ?? join(__dirname, '..', '..');
  const config = options.config ?? loadReleaseCycleConfig();
  const appVersion = readAppVersion(repoRoot);
  const lastStoreTag = latestStoreTag(repoRoot, config.store_tag_prefix);
  const sinceRef = options.sinceRef ?? lastStoreTag ?? 'origin/main';
  const changedFiles = changedFilesSinceRef(repoRoot, lastStoreTag ? lastStoreTag : null);
  const classification = classifyStoreRelease(changedFiles);
  const hasNativePending =
    classification.tiers.includes('native_binary') ||
    classification.recommended === 'native_binary';

  /** @type {ReleaseMode} */
  let mode = 'web_continuous';
  if (!lastStoreTag) {
    mode = 'first_store_submit';
  } else if (hasNativePending) {
    mode = 'native_pending';
  }

  return {
    appVersion,
    lastStoreTag,
    sinceRef: lastStoreTag ?? '(recent main commits)',
    mode,
    modeLabel: MODE_LABELS[mode],
    classification,
    lanes: config.lanes,
    config,
    guide: 'docs/guide/release-cycle.md',
  };
}

const MODE_LABELS = {
  web_continuous: 'Ship web — merge PRs to main (default)',
  native_pending: 'Native shell changed — upload store binary when ready',
  first_store_submit: 'Pre-launch — finish SUBMISSION.md, then TestFlight',
};

export function releaseCycleChecklist(report) {
  const { mode, appVersion, lastStoreTag, classification } = report;
  const common = [
    'Open PR from worktree/cursor branch → CI green → merge to main.',
    'Tag PR title with feat: or fix: — bump-version.yml assigns semver on merge.',
    'Do not bump package.json in the PR; main owns version stamps.',
    'Validate with npm run test:pre-merge-vertical when the diff touches app paths.',
  ];

  if (mode === 'web_continuous') {
    return [
      ...common,
      'Merged app changes deploy to Vercel production automatically (no preview unless you directed one).',
      'Store Capacitor users pick up UI/API on next open — WebView loads parkbound.kurat0r.ai.',
      'PWA installs poll /api/version — no App Store submission needed for web-only work.',
      `npm run store:release-plan — currently ${classification.label}.`,
    ];
  }

  if (mode === 'first_store_submit') {
    return [
      ...common,
      'Complete fastlane/metadata/ios/SUBMISSION.md (IAP, privacy URL, App Privacy, review phone).',
      'npm run store:screenshots && npm run store:app-preview if UI changed since last capture.',
      `Ensure App Store Connect version ${appVersion} exists before metadata upload.`,
      'Actions → Store binaries → ios → beta (TestFlight). Device-test location, push, invites.',
      'When TestFlight passes: Store binaries → production; release manually after review.',
      `After both stores are live: git tag -a store/${appVersion} -m "First store release ${appVersion}" && git push origin store/${appVersion}.`,
    ];
  }

  return [
    ...common,
    `Native paths changed since ${lastStoreTag ?? 'last tag'} — batch before uploading; web fixes already shipped via Vercel.`,
    'npm run store:release-plan — confirm native_binary tier.',
    'Update fastlane/metadata/ios/en-US/release_notes.txt for this semver.',
    'Actions → Store binaries → ios → beta; smoke TestFlight on a device.',
    'When ready: Store binaries → both → production (IOS_AUTOMATIC_RELEASE=false).',
    `After release: git tag -a store/${appVersion} -m "Store ${appVersion}" && git push origin store/${appVersion}.`,
  ];
}

export function formatReleaseCycleReport(report, checklist = releaseCycleChecklist(report)) {
  const lines = [
    `App version (main): ${report.appVersion}`,
    `Mode: ${report.modeLabel}`,
    `Last store tag: ${report.lastStoreTag ?? '(none yet)'}`,
    `Diff since: ${report.sinceRef}`,
    `Classifier: ${report.classification.label}`,
    '',
    'How you ship:',
    '  web — merge PR → bump-version → Vercel → phones update (no store review)',
    '  metadata — edit fastlane/metadata → push main (auto) or ios metadata workflow',
    '  native — only when ios/android/capacitor changed; you dispatch store.yml',
    '',
    'Checklist:',
  ];

  for (const item of checklist) {
    lines.push(`  - ${item}`);
  }

  lines.push('', `Guide: ${report.guide}`);
  lines.push('Tiers: docs/guide/store-releases.md');
  lines.push('Classify: npm run store:release-plan');
  return lines.join('\n');
}
