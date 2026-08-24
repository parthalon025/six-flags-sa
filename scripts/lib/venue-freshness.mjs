/**
 * Venue freshness gate — re-export from venue-builder delivery module.
 *
 * Canonical implementation: packages/venue-builder/lib/delivery/freshness.mjs
 * (also exported as @party-tracker/venue-builder/freshness.js for app code).
 * Relative import here so gate-tests runs before `npm ci` can link workspaces.
 */
export {
  freshnessDecision,
  bundleDriftDecision,
  collectTruthStamps,
  collectShippedPacks,
  collectBundles,
  checkVenueFreshness,
} from '../../packages/venue-builder/lib/delivery/freshness.mjs';
