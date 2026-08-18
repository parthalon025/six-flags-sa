/**
 * Vertical e2e gate — every code diff must be proven through the stack it
 * ships in, and the run's *output* must be asserted, before merge.
 *
 * Two words, both load-bearing:
 *   vertical  — the change exercised end to end in the real thing (a browser
 *               against the production build, the builder over real venue
 *               data, the workflow entry points CI actually calls), not a
 *               unit that stops at the seam it changed.
 *   output    — assertions over what that run produced (DOM and behaviour,
 *               generated venue files, returned decisions). An exit code is
 *               not output validation; a suite that only proves the process
 *               started proves nothing about the change.
 *
 * Static steps (lint, unit, build) stay necessary and stay insufficient: they
 * are the floor of `pre-merge-vertical`, never the proof.
 *
 * Interface:
 *   VERTICALS
 *   isCodeFile(file)
 *   verticalsForFiles(files)
 *   unclassifiedCodeFiles(files)
 *   requiredVerticals(files)
 *   verticalPlan(files)
 *   stampCoversVerticals(stamp, required)
 *   verticalE2eBlockReason({ files, ran, skipBrowser })
 */
import { pathMatchesAny } from '../../test/app/lib/module-select.mjs';

/**
 * Stamp files are written *by* the gates; they are never the code work being
 * proven, so they must not pull a vertical in on their own.
 */
export const STAMP_FILES = [
  'scripts/ci/local-ci-pass.json',
  'scripts/ci/matt-review-pass.json',
];

/**
 * One row per shipped vertical. `command` is the run that produces the
 * evidence; `validates` names the output that run asserts on — if you cannot
 * fill `validates` with something the suite actually reads, it is not a
 * vertical and does not belong here.
 */
export const VERTICALS = [
  {
    id: 'app',
    title: 'App browser vertical',
    command: 'npm run test:validate-ui:changed',
    validates:
      'guest-visible behaviour in a real browser against the production build — functional checks, grandma task scores, and a clean console',
    paths: [
      'apps/**',
      'packages/**',
      'test/app/**',
      'test/shots/**',
      'eslint.config.mjs',
      'vercel.json',
      'turbo.json',
      'package.json',
      'package-lock.json',
    ],
  },
  {
    id: 'builder',
    title: 'Venue builder vertical',
    command: 'npm run test:builder',
    validates:
      'generated venue output — world, gaps/quests and compare assertions read the built venue files, not the builder internals',
    paths: [
      'packages/venue-builder/**',
      'data/venues/**',
      'apps/party-tracker/public/venues/**',
      'test/builder/**',
    ],
  },
  {
    id: 'automation',
    title: 'Automation vertical',
    command: 'npm run test:ci-gate',
    validates:
      'the CI, deploy and stamp decisions returned by the exported functions the workflows call',
    paths: [
      'scripts/**',
      'test/scripts/**',
      '.github/workflows/**',
      '.dependency-cruiser.cjs',
    ],
  },
];

export const VERTICAL_IDS = VERTICALS.map((v) => v.id);

/** Paths that are code work: a change here has to be proven by a run. */
const CODE_PATH =
  /^(apps|packages|scripts|test)\/|^\.github\/workflows\/|^(package\.json|package-lock\.json|eslint\.config\.mjs|\.dependency-cruiser\.cjs|turbo\.json|vercel\.json)$/;

function normalize(file) {
  return String(file).replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isCodeFile(file) {
  const f = normalize(file);
  if (STAMP_FILES.includes(f)) return false;
  return CODE_PATH.test(f);
}

export function verticalById(id) {
  return VERTICALS.find((v) => v.id === id) || null;
}

/** Verticals whose paths this diff touches, in VERTICALS order. */
export function verticalsForFiles(files = []) {
  const candidates = files.map(normalize).filter((f) => !STAMP_FILES.includes(f));
  return VERTICALS.filter((v) => candidates.some((f) => pathMatchesAny(f, v.paths))).map(
    (v) => v.id,
  );
}

/** Code files no vertical claims — the map has a hole and cannot be trusted. */
export function unclassifiedCodeFiles(files = []) {
  return files
    .map(normalize)
    .filter((f) => isCodeFile(f))
    .filter((f) => !VERTICALS.some((v) => pathMatchesAny(f, v.paths)));
}

/**
 * What this diff must run. Fails closed: an unknown diff, or code the map
 * does not claim, requires every vertical rather than none.
 */
export function requiredVerticals(files) {
  if (files == null) return [...VERTICAL_IDS];
  if (unclassifiedCodeFiles(files).length) return [...VERTICAL_IDS];
  return verticalsForFiles(files);
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
 * Called twice by pre-merge-vertical: once up front with `ran = required`, so
 * a refused `--skip-browser` costs nothing before the slow steps, and once
 * after the run with what actually executed.
 *
 * @param {{files: string[]|null, ran?: string[], skipBrowser?: boolean}} input
 * @returns {string | null}
 */
export function verticalE2eBlockReason({ files, ran = [], skipBrowser = false } = {}) {
  const required = requiredVerticals(files);
  if (!required.length) return null;

  if (skipBrowser && required.includes('app')) {
    return [
      'code diff changes app behaviour — the browser vertical is required (do not --skip-browser).',
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
