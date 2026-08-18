/**
 * CI gate manifest — single list of fast script tests that guard deploy/skip invariants.
 * Add a row here when a new scripts/lib seam needs CI protection.
 */
export const GATE_SCRIPT_TESTS = [
  'test/scripts/ci-module.test.mjs',
  'test/scripts/gitnexus-only.test.mjs',
  'test/scripts/bump-version.test.mjs',
  'test/scripts/version-stamp.test.mjs',
  'test/scripts/vercel-ignore.test.mjs',
  'test/scripts/store-release-plan.test.mjs',
  'test/scripts/app-store-connect-pack.test.mjs',
  'test/scripts/apple-developer.test.mjs',
  'test/scripts/release-cycle.test.mjs',
  'test/scripts/deploy-version-report.test.mjs',
  'test/scripts/local-ci-pass.test.mjs',
  'test/scripts/agent-docs.test.mjs',
  'test/scripts/clerk-e2e.test.mjs',
  'test/scripts/wire-watch-target.test.mjs',
  'test/scripts/clerk-apple-prod.test.mjs',
  'test/scripts/install-global-skills.test.mjs',
  'test/scripts/worktree.test.mjs',
  'test/scripts/matt-standards.test.mjs',
  'test/scripts/matt-review.test.mjs',
  'test/scripts/dependency-boundaries.test.mjs',
  'test/scripts/map-performance-contract.test.mjs',
  'test/scripts/venues-env-file.test.mjs',
];

/**
 * test/scripts tests deliberately NOT in the gate, with the reason.
 * ci-module.test.mjs fails when a test file is in neither list.
 */
export const GATE_EXCLUDED_TESTS = {
  'test/scripts/store-app-preview.test.mjs':
    'needs ffmpeg on PATH — runs via npm run test:unit where the toolchain has it (#474)',
};
