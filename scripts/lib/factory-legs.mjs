/**
 * Factory CI leg selection — map, visual, and delivery workflow legs.
 *
 * Each leg runs when its paths change; skipped legs noop-pass through *-result
 * jobs so required checks never false-fail on path filters.
 */
import { pathMatchesAny } from '../../test/app/lib/module-select.mjs';

/** @type {Record<'map'|'visual'|'delivery', string[]>} */
export const FACTORY_LEG_PATHS = {
  map: [
    'packages/venue-builder/lib/map-factory/**',
    'packages/venue-builder/lib/venue-certify.mjs',
    'packages/venue-builder/lib/venue-route-qa-core.mjs',
    'packages/venue-builder/bin/build-venue.mjs',
    'packages/venue-builder/bin/venue-certify.mjs',
    'test/builder/compare.mjs',
    'test/builder/factory-modules.mjs',
  ],
  visual: [
    'packages/venue-builder/lib/visual-factory/**',
    'packages/venue-builder/lib/display-*.mjs',
    'packages/venue-builder/lib/terrain/**',
    'packages/venue-builder/bin/display-*.mjs',
    'test/builder/display*.mjs',
    'test/builder/factory-modules.mjs',
  ],
  delivery: [
    'packages/venue-builder/lib/delivery/**',
    'packages/venue-builder/lib/venue-bundle.mjs',
    'scripts/lib/venue-freshness.mjs',
    'test/scripts/venue-freshness.test.mjs',
    'test/builder/venue-bundle.mjs',
    'test/builder/factory-modules.mjs',
  ],
};

/**
 * @param {string[]} files changed paths (posix)
 * @returns {{ map: boolean, visual: boolean, delivery: boolean }}
 */
export function factoryLegsForFiles(files = []) {
  const norm = files.map((f) => f.replace(/\\/g, '/').replace(/^\.\//, ''));
  return {
    map: norm.some((f) => pathMatchesAny(f, FACTORY_LEG_PATHS.map)),
    visual: norm.some((f) => pathMatchesAny(f, FACTORY_LEG_PATHS.visual)),
    delivery: norm.some((f) => pathMatchesAny(f, FACTORY_LEG_PATHS.delivery)),
  };
}

/** GitHub Actions outputs for the three factory legs. */
export function factoryLegGithubOutputs(files = []) {
  const legs = factoryLegsForFiles(files);
  return {
    map_factory: legs.map ? 'true' : 'false',
    visual_factory: legs.visual ? 'true' : 'false',
    delivery_factory: legs.delivery ? 'true' : 'false',
  };
}
