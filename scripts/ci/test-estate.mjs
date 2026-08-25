/**
 * The test estate — every suite under `test/`, and the job that runs it.
 *
 * `scripts/ci/manifest.mjs` does this for `test/scripts` alone, and the reason
 * it exists applies to the whole tree: a suite nobody runs still passes review,
 * still passes CI, and rots in place until the day someone reads it and finds
 * it has been lying for a year. Three real suites were in exactly that state
 * when this file was written.
 *
 * So every `.mjs` under `test/` is in one of two places:
 *
 *   TEST_ESTATE          — the run list: which runner(s) execute this file.
 *   TEST_ESTATE_EXCLUDED — path → the written reason nothing runs it.
 *
 * This file is the data. The audit is `scripts/lib/test-estate.mjs`, run by
 * `test/scripts/test-estate.test.mjs`: it fails when a file is in neither list,
 * in both, or listed but missing from disk — and it does not take the run list
 * on trust, checking each claim against package.json, the gate manifest and
 * .github/workflows/test-app.yml so an entry cannot name a job that does not
 * run it.
 *
 * Interface:
 *   TEST_RUNNERS / TEST_ESTATE / TEST_ESTATE_EXCLUDED
 */

/**
 * Who runs a suite. Each runner declares how a claim on it is proven:
 *   npmScript   — that package.json script's command must name the file
 *   gateManifest— the file must be in GATE_SCRIPT_TESTS (scripts/ci/manifest.mjs)
 *   job         — that job in .github/workflows/test-app.yml must invoke the
 *                 file, directly or through an npm script that names it
 *   spawnedFrom — that file must name the suite it spawns as a child process
 */
export const TEST_RUNNERS = {
  'test:unit': {
    label:
      'npm run test:unit — the static floor of the local pre-merge run (STATIC_STEPS in scripts/lib/local-ci-pass.mjs), which .husky/pre-push runs. No GitHub job runs it.',
    npmScript: 'test:unit',
  },
  'test:builder': {
    label: 'npm run test:builder — the `builder` GitHub job, and the `builder` vertical.',
    npmScript: 'test:builder',
    job: 'builder',
  },
  'map-factory-job': {
    label: 'the `map-factory` GitHub job — map factory leg (noop-result when skipped).',
    job: 'map-factory',
  },
  'visual-factory-job': {
    label: 'the `visual-factory` GitHub job — visual factory leg (noop-result when skipped).',
    job: 'visual-factory',
  },
  'delivery-factory-job': {
    label: 'the `delivery-factory` GitHub job — delivery leg (noop-result when skipped).',
    job: 'delivery-factory',
  },
  'test:module-select': {
    label:
      'npm run test:module-select — a static-floor step, and the `module-select-unit` GitHub job.',
    npmScript: 'test:module-select',
    job: 'module-select-unit',
  },
  'ci-gate': {
    label:
      'npm run test:ci-gate — the `gate` GitHub job, which runs before any workspace install, and the `automation` vertical.',
    gateManifest: true,
    job: 'gate',
  },
  'gate-job': {
    label: 'the `gate` GitHub job, which runs this file directly rather than through the gate manifest.',
    job: 'gate',
  },
  'select-job': {
    label: 'the `select` GitHub job, which runs this file to decide what the rest of the workflow does.',
    job: 'select',
  },
  'ui-matrix': {
    label: 'the `ui` matrix job in .github/workflows/test-app.yml, one module per matrix leg.',
    job: 'ui',
  },
  'visual-job': {
    label:
      'the `visual` GitHub job — soft: it is continue-on-error and the `ci` aggregator treats it as non-blocking, so it reports and never gates.',
    job: 'visual',
  },
  'app-vertical': {
    label:
      'npm run test:validate-ui:changed — the `app` vertical (scripts/lib/vertical-e2e.mjs), run by .husky/pre-push through scripts/ci/pre-merge-vertical.mjs.',
    npmScript: 'test:validate-ui:changed',
    spawnedFrom: 'test/app/lib/validate-ui-queue.mjs',
  },
};

/** path → the runner ids that execute it. */
export const TEST_ESTATE = {
  // --- test/app: behaviour in a browser, and the pure logic behind it -------
  'test/app/appUpdate.test.mjs': ['test:unit'],
  'test/app/band-plan.test.mjs': ['test:unit'],
  'test/app/contributions-thanks.test.mjs': ['test:unit'],
  'test/app/custom-map.test.mjs': ['test:unit'],
  'test/app/displaySpike.test.mjs': ['test:unit'],
  'test/app/eligibility.test.mjs': ['test:unit'],
  'test/app/functional.mjs': ['ui-matrix', 'app-vertical'],
  'test/app/geo.test.mjs': ['test:unit'],
  'test/app/godmode.test.mjs': ['test:unit'],
  'test/app/grandma.mjs': ['ui-matrix', 'app-vertical'],
  'test/app/host-service-import.test.mjs': ['test:unit'],
  'test/app/iso-track.test.mjs': ['test:unit'],
  'test/app/iso-world.test.mjs': ['test:unit'],
  'test/app/map-camera.test.mjs': ['test:unit'],
  'test/app/map-view-camera-apply.test.mjs': ['test:unit'],
  'test/app/map-view.test.mjs': ['test:unit'],
  'test/app/map-visual.test.mjs': ['test:unit'],
  'test/app/module-select.test.mjs': ['test:module-select'],
  'test/app/native.test.mjs': ['test:unit'],
  'test/app/overlay.test.mjs': ['test:unit'],
  'test/app/overlay-geo.test.mjs': ['test:unit'],
  'test/app/overlay-marks.test.mjs': ['test:unit'],
  'test/app/party-protocol.test.mjs': ['test:unit'],
  'test/app/party-runtime.test.mjs': ['test:unit'],
  'test/app/quest-sync.test.mjs': ['test:unit'],
  'test/app/rank-prizes.test.mjs': ['test:unit'],
  'test/app/readme-shots-check.mjs': ['test:unit', 'gate-job'],
  'test/app/select-modules.mjs': ['select-job'],
  'test/app/server-store.test.mjs': ['test:unit'],
  'test/app/spot.test.mjs': ['test:unit'],
  'test/app/store-links.test.mjs': ['test:unit'],
  'test/app/transport-contract.test.mjs': ['test:unit'],
  'test/app/transport-registry.test.mjs': ['test:unit'],
  'test/app/validate-ui-queue.test.mjs': ['test:unit'],
  'test/app/validate-ui.mjs': ['app-vertical'],
  'test/app/venue-download.test.mjs': ['test:unit'],
  'test/app/venue-store.test.mjs': ['test:unit'],
  'test/app/visual.mjs': ['visual-job'],
  'test/app/weather-route.test.mjs': ['test:unit'],
  'test/app/ready-route.test.mjs': ['test:unit'],
  'test/app/zoom-bands.test.mjs': ['test:unit'],

  // --- test/builder: assertions over generated venue output ----------------
  'test/builder/check-names.mjs': ['test:builder'],
  'test/builder/compare.mjs': ['test:builder'],
  'test/builder/display-assets.mjs': ['test:builder'],
  'test/builder/display-bands.mjs': ['test:unit', 'test:builder'],
  'test/builder/display-distinct-cli.mjs': ['test:unit', 'test:builder'],
  'test/builder/display-grounding.mjs': ['test:builder'],
  'test/builder/display-iso.mjs': ['test:builder'],
  'test/builder/display-pyramid.mjs': ['test:builder'],
  'test/builder/display-references.mjs': ['test:builder'],
  'test/builder/display-scatter.mjs': ['test:builder'],
  'test/builder/display-style.mjs': ['test:builder'],
  'test/builder/display.mjs': ['test:builder'],
  'test/builder/esa-worldcover.mjs': ['test:builder'],
  'test/builder/footprint-fusion.mjs': ['test:builder'],
  'test/builder/factory-modules.mjs': ['test:builder', 'map-factory-job', 'visual-factory-job', 'delivery-factory-job'],
  'test/builder/factory-validate.mjs': ['test:builder'],
  'test/builder/gaps-quests.mjs': ['test:unit', 'test:builder'],
  'test/builder/imagery-claims.mjs': ['test:builder'],
  'test/builder/imagery-ledger.mjs': ['test:builder'],
  'test/builder/iso-track.mjs': ['test:builder'],
  'test/builder/iso-world.mjs': ['test:builder'],
  'test/builder/llm-agent.mjs': ['test:builder'],
  'test/builder/mapillary-video.mjs': ['test:builder'],
  'test/builder/naip.mjs': ['test:builder'],
  'test/builder/overture-buildings.mjs': ['test:builder'],
  'test/builder/paths.mjs': ['test:builder'],
  'test/builder/poly-haven.mjs': ['test:builder'],
  'test/builder/skin-distinct.mjs': ['test:unit', 'test:builder'],
  'test/builder/terrain.mjs': ['test:builder'],
  'test/builder/tiles-export.mjs': ['test:builder'],
  'test/builder/unit.mjs': ['test:unit', 'test:builder'],
  'test/builder/venue-bundle.mjs': ['test:builder'],
  'test/builder/world.mjs': ['test:unit', 'test:builder'],

  // --- test/scripts: the decisions the workflows call ----------------------
  'test/scripts/agent-docs.test.mjs': ['ci-gate'],
  'test/scripts/app-store-connect-pack.test.mjs': ['ci-gate'],
  'test/scripts/app-store-connect.test.mjs': ['ci-gate'],
  'test/scripts/apple-developer.test.mjs': ['ci-gate'],
  'test/scripts/bake-drift-watch.test.mjs': ['ci-gate'],
  'test/scripts/billing-sync-check.test.mjs': ['ci-gate', 'test:unit'],
  'test/scripts/bump-version.test.mjs': ['ci-gate'],
  'test/scripts/ci-module.test.mjs': ['ci-gate'],
  'test/scripts/clerk-apple-prod.test.mjs': ['ci-gate'],
  'test/scripts/clerk-e2e.test.mjs': ['ci-gate'],
  'test/scripts/cloud-agent-clerk-env.test.mjs': ['ci-gate', 'test:unit'],
  'test/scripts/credits.test.mjs': ['ci-gate'],
  'test/scripts/dependency-boundaries.test.mjs': ['ci-gate'],
  'test/scripts/deploy-version-report.test.mjs': ['ci-gate', 'test:unit'],
  'test/scripts/design-bundle.test.mjs': ['test:unit'],
  'test/scripts/drift-watch.test.mjs': ['ci-gate'],
  'test/scripts/git-env.test.mjs': ['ci-gate'],
  'test/scripts/glance-rail-dead-code.test.mjs': ['ci-gate'],
  'test/scripts/gitnexus-detect-changes.test.mjs': ['ci-gate'],
  'test/scripts/gitnexus-docs.test.mjs': ['ci-gate'],
  'test/scripts/gitnexus-only.test.mjs': ['ci-gate'],
  'test/scripts/gitnexus-repair.test.mjs': ['ci-gate'],
  'test/scripts/install-global-skills.test.mjs': ['ci-gate'],
  'test/scripts/local-ci-pass.test.mjs': ['ci-gate'],
  'test/scripts/map-performance-contract.test.mjs': ['ci-gate'],
  'test/scripts/matt-review.test.mjs': ['ci-gate'],
  'test/scripts/matt-standards.test.mjs': ['ci-gate'],
  'test/scripts/orchestrator.test.mjs': ['ci-gate'],
  'test/scripts/pre-push.test.mjs': ['ci-gate'],
  'test/scripts/profile-max-rank.test.mjs': ['ci-gate'],
  'test/scripts/release-cycle.test.mjs': ['ci-gate', 'test:unit'],
  'test/scripts/store-app-preview.test.mjs': ['test:unit'],
  'test/scripts/store-release-plan.test.mjs': ['ci-gate', 'test:unit'],
  'test/scripts/store-screenshot-compose.test.mjs': ['ci-gate'],
  'test/scripts/suite-wiring.test.mjs': ['ci-gate'],
  'test/scripts/test-estate.test.mjs': ['ci-gate'],
  'test/scripts/train-plan.test.mjs': ['ci-gate'],
  'test/scripts/matt-workflow.test.mjs': ['ci-gate'],
  'test/scripts/executive-resume.test.mjs': ['ci-gate'],
  'test/scripts/venue-freshness.test.mjs': ['ci-gate'],
  'test/scripts/venues-env-file.test.mjs': ['ci-gate'],
  'test/scripts/vercel-deploy-gate.test.mjs': ['ci-gate'],
  'test/scripts/vercel-ignore.test.mjs': ['ci-gate'],
  'test/scripts/version-stamp.test.mjs': ['ci-gate'],
  'test/scripts/vertical-e2e.test.mjs': ['ci-gate'],
  'test/scripts/factory-legs.test.mjs': ['ci-gate'],
  'test/scripts/pre-merge-vertical.test.mjs': ['ci-gate'],
  'test/scripts/wire-watch-target.test.mjs': ['ci-gate'],
  'test/scripts/worktree.test.mjs': ['ci-gate', 'test:unit'],
};

/**
 * Files nothing runs, and why. A reason has to say what the file is for and
 * what would have to change for it to join a run list — "unused" is not a
 * reason, it is a bug report.
 */
export const TEST_ESTATE_EXCLUDED = {
  'test/app/audit-mobile.mjs':
    'human-run screenshot tool, actively maintained. Walks four phone viewports with safe-area simulation and writes PNGs + JSON to test/audit/mobile for a person to look at. Needs a running app and a system Chromium; its output is a report, not a verdict. `npm start & CHROMIUM_PATH=… node test/app/audit-mobile.mjs`.',
  'test/app/audit-overlap.mjs':
    'human-run screenshot tool, actively maintained. Overlap and tap-target usability audit; writes screenshots + a JSON report to test/audit/ for a person to read. Needs a running app and a system Chromium.',
  'test/app/audit-visual.mjs':
    'human-run screenshot tool, actively maintained. Captures every major UI state to test/audit/ for human review. Needs a running app.',
  'test/app/browser.mjs':
    'shared plumbing, not a suite: the Playwright harness (launch, go, until, openPhone, signIn, IGNORABLE_CONSOLE) that functional.mjs, grandma.mjs, visual.mjs and the audit tools import. It runs whenever they do, and it is in modules.json fullSuitePaths so editing it forces the whole UI matrix.',
  'test/app/display-parity.mjs':
    'renderer-parity spot check run by hand (`npm run test:display-parity`). It asserts that three independent measurements of a Place position agree — geo.js, MapLibre and the display pipeline — which needs a running app with a live map. Wiring it into the UI matrix would mean a fourth browser job for a check that has never caught a regression in CI; revisit if it does.',
  'test/app/lib/appAlias-hook.mjs':
    'library, not a suite: async resolve hook registered by appAlias.mjs for @/* imports in Node tests. Asserted through party-runtime.test.mjs.',
  'test/app/lib/appAlias.mjs':
    'library, not a suite: dynamic import helper for party stack tests that resolves app modules under test. Asserted through the party-protocol and party-runtime suites that import it.',
  'test/app/lib/fakeTransport.mjs':
    'library, not a suite: in-memory transport double for party stack interface tests. Asserted through transport-contract, transport-registry, party-protocol, and party-runtime.',
  'test/app/lib/module-select.mjs':
    'library, not a suite: the module manifest loader and path matcher that select-modules.mjs, validate-ui.mjs, functional.mjs and the CI scripts import. Asserted by test/app/module-select.test.mjs.',
  'test/app/lib/partyBus.mjs':
    'library, not a suite: fake party bus harness for protocol and runtime tests. Asserted through party-protocol.test.mjs and party-runtime.test.mjs.',
  'test/app/lib/readme-shots.mjs':
    'library, not a suite: the shared README-gallery manifest (CAPTURE_SCRIPT, recordCapture, shotsNeedingRefresh) imported by readme-shots.mjs and readme-shots-check.mjs. Asserted through readme-shots-check.mjs.',
  'test/app/lib/validate-ui-queue.mjs':
    'library, not a suite: the suite plan for validate-ui.mjs, split out precisely because validate-ui.mjs runs suites on import. Asserted by test/app/validate-ui-queue.test.mjs.',
  'test/app/map-skin-visual-points.mjs':
    'visual Skin drift matrix run by hand (`npm run test:map-skin-points`). Takes a fixed 20-point comparison across map Skins; needs a running app, and the output is a set of screenshots a person compares Skin to Skin.',
  'test/app/readme-shots.mjs':
    'capture tool run by hand (`npm run readme:shots`): it writes committed artefacts (docs/images/readme/*.png, walkthrough.mp4) against a running app. The automated half is readme-shots-check.mjs, which runs in the gate job and in test:unit.',
  'test/app/theme.mjs':
    'screenshot pair for human palette review (`npm run test:theme`): drives the real daylight/night toggle and writes two shots with a single assert. Needs a running app; documented as hand-run in docs/guide/testing.md. It is in modules.json fullSuitePaths, so editing it still forces the full UI matrix.',
  'test/app/ux.mjs':
    'human-run exploration (`npm run test:ux`): boots a phone viewport, logs page errors and takes two glance-rail screenshots. It asserts nothing, so running it in CI would only prove a browser started. It is in modules.json fullSuitePaths, so editing it still forces the full UI matrix.',
};
