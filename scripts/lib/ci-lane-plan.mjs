/**
 * CI lane plan — canon decomposition for local pre-merge and GitHub test-app.yml.
 *
 * Lanes (vertical-e2e) decide what a diff owes; this module maps lanes to static
 * steps and GitHub jobs. GitHub mirrors this plan — not module-select alone.
 *
 * Interface:
 *   staticStepsForFiles(files, manifest)
 *   canonLanePlan(files, manifest)
 *   jobsRequiredByCanon(files, manifest)
 *   jobsProvenByStamp(stamp)
 *   stampProvesCanonJobs(stamp, context)
 *   laneGithubOutputs(files, manifest)
 */
import { factoryLegsForFiles } from './factory-legs.mjs';
import {
  guestBrowserRequired,
  noCodeWorkRequired,
  requiredVerticals,
  unclassifiedCodeFiles,
} from './vertical-e2e.mjs';
import { loadModulesManifest, selectModulesFromFiles } from '../../test/app/lib/module-select.mjs';

/** Step ids — must match `STATIC_STEPS` in scripts/lib/local-ci-pass.mjs */
export const CANON_STATIC_STEP_IDS = [
  'test:ci-gate',
  'test:unit',
  'lint',
  'test:module-select',
  'test:coverage-contract',
  'build',
];

const ALL_STATIC = [...CANON_STATIC_STEP_IDS];

/** GitHub jobs each static step stands in for (gate is always run — not skippable). */
export const STATIC_STEP_GITHUB_JOBS = {
  'test:ci-gate': [],
  'test:unit': [],
  lint: ['lint', 'boundaries'],
  'test:module-select': ['module-select-unit'],
  build: ['app-build'],
};

/** Vertical lanes → GitHub jobs the vertical command stands in for. */
export const VERTICAL_GITHUB_JOBS = {
  backside: [],
  builder: ['builder'],
  app: ['ui', 'visual'],
};

const FACTORY_JOB_KEYS = {
  map: 'map-factory',
  visual: 'visual-factory',
  delivery: 'delivery-factory',
};

/**
 * Static npm steps owed by this diff — subset of CANON_STATIC_STEP_IDS.
 * App / guest lane owes the full floor; backside owes ci-gate only.
 */
export function staticStepsForFiles(files, manifest = loadModulesManifest()) {
  if (files == null) return ALL_STATIC;
  if (noCodeWorkRequired(files)) return [];
  if (unclassifiedCodeFiles(files).length) return ALL_STATIC;

  const steps = new Set();
  const verticals = requiredVerticals(files);
  const guest = guestBrowserRequired(files, manifest);

  if (verticals.includes('app') || guest) {
    for (const id of ALL_STATIC) steps.add(id);
  }
  if (verticals.includes('backside')) {
    steps.add('test:ci-gate');
    if (
      files?.some(
        (f) =>
          f.endsWith('test/app/critical-paths.json') || f.endsWith('test/app/coverage-contract.mjs'),
      )
    ) {
      steps.add('test:coverage-contract');
    }
  }

  return ALL_STATIC.filter((id) => steps.has(id));
}

/** Full lane plan for a diff — verticals, static steps, and GitHub job flags. */
export function canonLanePlan(files, manifest = loadModulesManifest()) {
  const verticals =
    files == null ? ['app', 'builder', 'backside'] : requiredVerticals(files);
  const staticSteps = staticStepsForFiles(files, manifest);
  const factory = factoryLegsForFiles(files ?? []);
  const guest = files == null ? true : guestBrowserRequired(files, manifest);
  const selection =
    files == null
      ? { modules: manifest.modules.map((m) => m.id), fullSuite: true }
      : selectModulesFromFiles(files, manifest);

  const runBuilder = verticals.includes('builder');
  const runAppUi = guest || verticals.includes('app');

  return {
    verticals,
    staticSteps,
    needsBrowser: guest,
    modules: selection.modules,
    fullSuite: selection.fullSuite,
    factory,
    runCiGate: staticSteps.includes('test:ci-gate'),
    runUnit: staticSteps.includes('test:unit'),
    runLint: staticSteps.includes('lint'),
    runModuleSelectUnit: staticSteps.includes('test:module-select'),
    runAppBuild: staticSteps.includes('build'),
    runBuilder,
    runAppUi,
    runMapFactory: runBuilder && factory.map,
    runVisualFactory: runBuilder && factory.visual,
    runDeliveryFactory: runBuilder && factory.delivery,
  };
}

/** GitHub jobs canon says must be proved before `local-ci-verified` may skip them. */
export function jobsRequiredByCanon(files, manifest = loadModulesManifest()) {
  if (noCodeWorkRequired(files)) return [];
  if (files == null) return allCanonGithubJobs();

  const plan = canonLanePlan(files, manifest);
  const jobs = new Set();

  for (const stepId of plan.staticSteps) {
    for (const job of STATIC_STEP_GITHUB_JOBS[stepId] || []) jobs.add(job);
  }
  for (const id of plan.verticals) {
    for (const job of VERTICAL_GITHUB_JOBS[id] || []) jobs.add(job);
  }
  if (plan.runMapFactory) jobs.add(FACTORY_JOB_KEYS.map);
  if (plan.runVisualFactory) jobs.add(FACTORY_JOB_KEYS.visual);
  if (plan.runDeliveryFactory) jobs.add(FACTORY_JOB_KEYS.delivery);

  return [...jobs].sort();
}

function allCanonGithubJobs() {
  const jobs = new Set();
  for (const stepId of ALL_STATIC) {
    for (const job of STATIC_STEP_GITHUB_JOBS[stepId] || []) jobs.add(job);
  }
  for (const id of Object.keys(VERTICAL_GITHUB_JOBS)) {
    for (const job of VERTICAL_GITHUB_JOBS[id]) jobs.add(job);
  }
  for (const job of Object.values(FACTORY_JOB_KEYS)) jobs.add(job);
  return [...jobs].sort();
}

/** Jobs recorded on a stamp — static steps, verticals, and factory legs that ran. */
export function jobsProvenByStamp(stamp) {
  if (!stamp) return [];
  const jobs = new Set();
  const staticSteps = Array.isArray(stamp.staticSteps) ? stamp.staticSteps : [];
  for (const stepId of staticSteps) {
    for (const job of STATIC_STEP_GITHUB_JOBS[stepId] || []) jobs.add(job);
  }
  const verticals = Array.isArray(stamp.verticals) ? stamp.verticals : [];
  for (const id of verticals) {
    for (const job of VERTICAL_GITHUB_JOBS[id] || []) jobs.add(job);
  }
  if (verticals.includes('builder')) jobs.add('builder');
  const legs = Array.isArray(stamp.factoryLegs) ? stamp.factoryLegs : [];
  if (legs.includes('map')) jobs.add(FACTORY_JOB_KEYS.map);
  if (legs.includes('visual')) jobs.add(FACTORY_JOB_KEYS.visual);
  if (legs.includes('delivery')) jobs.add(FACTORY_JOB_KEYS.delivery);
  return [...jobs].sort();
}

/** True when the stamp proves every canon-required GitHub job for this context. */
export function stampProvesCanonJobs(stamp, context) {
  const files = context?.files;
  const required = jobsRequiredByCanon(files);
  if (!required.length) return true;
  const proven = new Set(jobsProvenByStamp(stamp));
  return required.every((job) => proven.has(job));
}

/** GitHub Actions outputs — canon lane flags for test-app.yml job `if` lines. */
export function laneGithubOutputs(files, manifest = loadModulesManifest()) {
  const plan = canonLanePlan(files, manifest);
  return {
    canon_builder: plan.runBuilder ? 'true' : 'false',
    canon_lint: plan.runLint ? 'true' : 'false',
    canon_selector: plan.runModuleSelectUnit ? 'true' : 'false',
    canon_any_ui: plan.runAppUi ? 'true' : 'false',
    canon_boundaries: plan.runLint ? 'true' : 'false',
    canon_map_factory: plan.runMapFactory ? 'true' : 'false',
    canon_visual_factory: plan.runVisualFactory ? 'true' : 'false',
    canon_delivery_factory: plan.runDeliveryFactory ? 'true' : 'false',
  };
}
