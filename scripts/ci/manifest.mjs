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
  'test/scripts/release-cycle.test.mjs',
  'test/scripts/deploy-version-report.test.mjs',
  'test/scripts/local-ci-pass.test.mjs',
  'test/scripts/agent-docs.test.mjs',
  'test/scripts/clerk-e2e.test.mjs',
  'test/scripts/wire-watch-target.test.mjs',
  'test/scripts/clerk-apple-prod.test.mjs',
];
