/**
 * CI gate manifest — single list of fast script tests that guard deploy/skip invariants.
 * Add a row here when a new scripts/lib seam needs CI protection.
 */
export const GATE_SCRIPT_TESTS = [
  'test/scripts/ci-module.test.mjs',
  'test/scripts/suite-wiring.test.mjs',
  'test/scripts/train-plan.test.mjs',
  'test/scripts/matt-workflow.test.mjs',
  'test/scripts/operating-stack.test.mjs',
  'test/scripts/executive-resume.test.mjs',
  'test/scripts/executive-resume-brief.test.mjs',
  'test/scripts/wayfinder-committed.test.mjs',
  'test/scripts/test-estate.test.mjs',
  'test/scripts/gitnexus-only.test.mjs',
  'test/scripts/gitnexus-detect-changes.test.mjs',
  'test/scripts/gitnexus-docs.test.mjs',
  'test/scripts/gitnexus-repair.test.mjs',
  'test/scripts/bump-version.test.mjs',
  'test/scripts/version-stamp.test.mjs',
  'test/scripts/vercel-ignore.test.mjs',
  'test/scripts/vercel-deploy-gate.test.mjs',
  'test/scripts/store-release-plan.test.mjs',
  'test/scripts/app-store-connect-pack.test.mjs',
  'test/scripts/apple-developer.test.mjs',
  'test/scripts/release-cycle.test.mjs',
  'test/scripts/deploy-version-report.test.mjs',
  'test/scripts/local-ci-pass.test.mjs',
  'test/scripts/pre-push.test.mjs',
  'test/scripts/git-env.test.mjs',
  'test/scripts/glance-rail-dead-code.test.mjs',
  'test/scripts/agent-docs.test.mjs',
  'test/scripts/credits.test.mjs',
  // design-bundle.test.mjs is deliberately NOT here. Every other entry is a
  // pure script test, which is what lets the Gate job run before a workspace
  // install. The design bundle derives its skin swatches by calling mapPaint()
  // for real rather than transcribing hexes, so it reaches lib/world.js and on
  // into @party-tracker/shared — unresolvable this early. It runs in test:unit,
  // where the workspace exists.
  'test/scripts/clerk-e2e.test.mjs',
  'test/scripts/cloud-agent-clerk-env.test.mjs',
  'test/scripts/cloud-agent-neon-env.test.mjs',
  'test/scripts/wire-watch-target.test.mjs',
  'test/scripts/clerk-apple-prod.test.mjs',
  'test/scripts/install-global-skills.test.mjs',
  'test/scripts/worktree.test.mjs',
  'test/scripts/matt-standards.test.mjs',
  'test/scripts/matt-review.test.mjs',
  'test/scripts/orchestrator.test.mjs',
  'test/scripts/vertical-e2e.test.mjs',
  'test/scripts/factory-legs.test.mjs',
  'test/scripts/pre-merge-vertical.test.mjs',
  'test/scripts/dependency-boundaries.test.mjs',
  'test/scripts/map-performance-contract.test.mjs',
  'test/scripts/venues-env-file.test.mjs',
  'test/scripts/venue-freshness.test.mjs',
  'test/scripts/venue-report-gate.test.mjs',
  'test/scripts/drift-watch.test.mjs',
  'test/scripts/bake-drift-watch.test.mjs',
  'test/scripts/billing-sync-check.test.mjs',
  'test/scripts/lakebase-config.test.mjs',
  'test/scripts/postdb-migrate.test.mjs',
  'test/scripts/databricks-auth.test.mjs',
  'test/scripts/profile-max-rank.test.mjs',
  'test/scripts/app-store-connect.test.mjs',
  'test/scripts/store-screenshot-compose.test.mjs',
];

/**
 * test/scripts tests deliberately NOT in the gate, with the reason.
 * ci-module.test.mjs fails when a test file is in neither list.
 */
export const GATE_EXCLUDED_TESTS = {
  'test/scripts/store-app-preview.test.mjs':
    'needs ffmpeg on PATH — runs via npm run test:unit where the toolchain has it (#474)',
  'test/scripts/design-bundle.test.mjs':
    'reaches app source — the bundle calls mapPaint() for its skin swatches rather than copying hexes, so it imports lib/world.js and on into @party-tracker/shared, which the Gate job runs too early to resolve. Runs via npm run test:unit where the workspace is installed.',
};
