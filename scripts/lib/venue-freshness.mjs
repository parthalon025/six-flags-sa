/**
 * Venue freshness gate — re-export from venue-builder delivery module.
 *
 * Scripts stay outside package internals; the package export is the boundary.
 * See packages/venue-builder/lib/delivery/freshness.mjs.
 */
export {
  freshnessDecision,
  bundleDriftDecision,
  collectTruthStamps,
  collectShippedPacks,
  collectBundles,
  checkVenueFreshness,
} from '@party-tracker/venue-builder/freshness.js';
