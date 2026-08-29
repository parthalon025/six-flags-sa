/**
 * Vertical e2e gate — every code diff must be proven through the stack it
 * ships in, and the run's *output* must be asserted, before merge.
 *
 * Three lanes (plus docs/agent policy):
 *   app      — guest-facing browser + validate-ui (module-select only)
 *   builder  — venue factory output (`test:builder`)
 *   backside — scripts, API routes, server libs, non-UI packages (`test:ci-gate`)
 *
 * Interface:
 *   VERTICALS
 *   isCodeFile(file)
 *   verticalsForFiles(files)
 *   unclassifiedCodeFiles(files)
 *   requiredVerticals(files)
 *   guestBrowserRequired(files, manifest)
 *   verticalPlan(files)
 *   stampCoversVerticals(stamp, required)
 *   verticalE2eBlockReason({ files, ran, skipBrowser })
 */
import {
  loadModulesManifest,
  pathMatchesAny,
  selectModulesFromFiles,
} from '../../test/app/lib/module-select.mjs';
import { isAgentPolicyOnlyDiff } from './agent-policy-diff.mjs';
import { isGitnexusCiNoise } from './gitnexus-only.mjs';
import { isVersionStampOnlyChange } from './version-stamp.mjs';

/**
 * Stamp files are written *by* the gates; they are never the code work being
 * proven, so they must not pull a vertical in on their own.
 */
export const STAMP_FILES = [
  'scripts/ci/local-ci-pass.json',
  'scripts/ci/matt-review-pass.json',
];

const BUILDER_PATHS = [
  'packages/venue-builder/**',
  'data/venues/**',
  'apps/party-tracker/public/venues/**',
  'test/builder/**',
];

const BACKSIDE_PATHS = [
  'scripts/**',
  'test/scripts/**',
  'test/app/coverage-contract.mjs',
  'test/app/critical-paths.json',
  'test/app/postgres-probe.test.mjs',
  '.github/workflows/**',
  '.dependency-cruiser.cjs',
  'apps/party-tracker/app/api/**',
  'apps/party-tracker/lib/**',
  'db/migrations/**',
  'packages/**',
  'package.json',
  'package-lock.json',
  'eslint.config.mjs',
  'turbo.json',
  'vercel.json',
];

/**
 * One row per shipped vertical. `command` is the run that produces the
 * evidence; `validates` names the output that run asserts on.
 */
export const VERTICALS = [
  {
    id: 'app',
    title: 'App guest browser vertical',
    command: 'npm run test:validate-ui:changed',
    validates:
      'guest-visible behaviour in a real browser against the production build — functional checks, grandma task scores, and a clean console',
    paths: [],
  },
  {
    id: 'builder',
    title: 'Venue builder vertical',
    command: 'npm run test:builder',
    validates:
      'generated venue output — world, gaps/quests and compare assertions read the built venue files, not the builder internals',
    paths: BUILDER_PATHS,
  },
  {
    id: 'backside',
    title: 'Backside vertical',
    command: 'npm run test:ci-gate',
    validates:
      'the CI, deploy and stamp decisions returned by the exported functions the workflows call',
    paths: BACKSIDE_PATHS,
  },
];

export const VERTICAL_IDS = VERTICALS.map((v) => v.id);

/** Paths that are code work: a change here has to be proven by a run. */
const CODE_PATH =
  /^(apps|packages|scripts|test)\/|^\.github\/workflows\/|^(package\.json|package-lock\.json|eslint\.config\.mjs|\.dependency-cruiser\.cjs|turbo\.json|vercel\.json)$/;

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

function candidates(files = []) {
  return files
    .map(normalize)
    .filter((f) => !STAMP_FILES.includes(f))
    .filter((f) => !isGitnexusCiNoise(f));
}

export function isCodeFile(file) {
  const f = normalize(file);
  if (STAMP_FILES.includes(f)) return false;
  return CODE_PATH.test(f);
}

function matchesBuilder(file) {
  return pathMatchesAny(file, BUILDER_PATHS);
}

function matchesBackside(file) {
  return pathMatchesAny(file, BACKSIDE_PATHS);
}

function isTestAppOnly(paths) {
  return (
    paths.length > 0
    && paths.every((f) => pathMatchesAny(f, ['test/app/**']) && !matchesBackside(f))
  );
}

export function verticalById(id) {
  return VERTICALS.find((v) => v.id === id) || null;
}

function guestLibPatterns(manifest = loadModulesManifest()) {
  const patterns = new Set();
  for (const mod of manifest.modules || []) {
    if (mod.kind === 'builder') continue;
    for (const p of mod.paths || []) {
      if (p.startsWith('apps/party-tracker/lib/')) patterns.add(p);
    }
  }
  return [...patterns];
}

function isGuestBrowserPath(file, manifest = loadModulesManifest()) {
  const f = normalize(file);
  if (!pathMatchesAny(f, ['apps/party-tracker/**', 'test/app/**'])) return false;
  if (pathMatchesAny(f, ['apps/party-tracker/app/api/**'])) return false;
  if (pathMatchesAny(f, ['packages/**'])) return false;
  if (pathMatchesAny(f, ['apps/party-tracker/lib/**'])) {
    return pathMatchesAny(f, guestLibPatterns(manifest));
  }
  return true;
}

/** Guest visual e2e — module-select guest suites only, not every app touch. */
export function guestBrowserRequired(files, manifest = loadModulesManifest()) {
  if (files == null) return true;
  const paths = candidates(files);
  if (!paths.length) return false;
  const guestPaths = paths.filter((f) => isGuestBrowserPath(f, manifest));
  if (!guestPaths.length) return false;
  const sel = selectModulesFromFiles(guestPaths, manifest);
  const guestModules = sel.modules.filter((id) => id !== 'builder');
  return guestModules.length > 0;
}

function verticalIdsForPaths(paths) {
  if (isVersionStampOnlyChange(paths)) return [];
  if (isAgentPolicyOnlyDiff(paths)) return [];
  if (isTestAppOnly(paths)) return [];

  const ids = new Set();
  for (const f of paths) {
    if (matchesBuilder(f)) {
      ids.add('builder');
    } else if (matchesBackside(f)) {
      ids.add('backside');
    }
  }
  if (guestBrowserRequired(paths)) ids.add('app');

  return VERTICAL_IDS.filter((id) => ids.has(id));
}

/** Verticals whose paths this diff touches, in VERTICALS order. */
export function verticalsForFiles(files = []) {
  return verticalIdsForPaths(candidates(files));
}

/** Code files no vertical claims — the map has a hole and cannot be trusted. */
export function unclassifiedCodeFiles(files = []) {
  const paths = candidates(files);
  if (isVersionStampOnlyChange(paths)) return [];
  if (isAgentPolicyOnlyDiff(paths)) return [];
  if (isTestAppOnly(paths)) return [];
  return paths
    .filter((f) => isCodeFile(f))
    .filter(
      (f) =>
        !matchesBuilder(f)
        && !matchesBackside(f)
        && !pathMatchesAny(f, ['apps/party-tracker/**']),
    );
}

/**
 * What this diff must run. Fails closed: an unknown diff, or code the map
 * does not claim, requires every vertical rather than none.
 */
export function requiredVerticals(files) {
  if (files == null) return [...VERTICAL_IDS];
  const paths = candidates(files);
  const unclassified = unclassifiedCodeFiles(files);
  if (unclassified.length) return [...VERTICAL_IDS];
  return verticalIdsForPaths(paths);
}

/** Known diff with no code work — docs, ADRs, agent policy; owes no vertical or static floor. */
export function noCodeWorkRequired(files) {
  if (files == null) return false;
  const paths = candidates(files);
  if (isAgentPolicyOnlyDiff(paths)) return true;
  return requiredVerticals(files).length === 0;
}

/** Required verticals with the command and the output each one proves. */
export function verticalPlan(files) {
  const required = requiredVerticals(files);
  return {
    required,
    unclassified: files == null ? [] : unclassifiedCodeFiles(files),
    steps: required.map((id) => verticalById(id)),
  };
}

/** True when a pass stamp records every vertical this diff requires. */
export function stampCoversVerticals(stamp, required = []) {
  if (!required.length) return true;
  const ran = Array.isArray(stamp?.verticals) ? stamp.verticals : null;
  if (!ran) return false;
  return required.every((id) => ran.includes(id));
}

function describe(ids) {
  return ids
    .map((id) => verticalById(id))
    .filter(Boolean)
    .map((v) => `  - ${v.id}: ${v.command}\n      validates ${v.validates}`)
    .join('\n');
}

/**
 * null when merge may proceed; otherwise the blocker plus the exact runs.
 *
 * @param {{files: string[]|null, ran?: string[], skipBrowser?: boolean}} input
 * @returns {string | null}
 */
export function verticalE2eBlockReason({ files, ran = [], skipBrowser = false } = {}) {
  const required = requiredVerticals(files);
  if (!required.length) return null;

  if (skipBrowser && guestBrowserRequired(files)) {
    return [
      'code diff changes guest-visible app behaviour — the browser vertical is required (do not --skip-browser).',
      'Static steps prove the build compiles, not that a guest can still use it. Run:',
      '  npm run build && npm start &   # wait for /api/health',
      `  ${verticalById('app').command}`,
    ].join('\n');
  }

  const missing = required.filter((id) => !ran.includes(id));
  if (!missing.length) return null;

  const unclassified = files == null ? [] : unclassifiedCodeFiles(files);
  const why =
    files == null
      ? 'the branch diff could not be read, so every vertical is required'
      : unclassified.length
        ? `no vertical claims ${unclassified.join(', ')}, so every vertical is required — add the path to VERTICALS in scripts/lib/vertical-e2e.mjs`
        : 'this diff is code work, and code work is proven by a run whose output is asserted';

  return [
    `vertical e2e missing for this diff: ${missing.join(', ')}.`,
    `Why: ${why}.`,
    'Run each missing vertical and let it assert its output:',
    describe(missing),
  ].join('\n');
}
