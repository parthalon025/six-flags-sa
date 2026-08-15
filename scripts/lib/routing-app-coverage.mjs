/**
 * App Store routing coverage — re-export of the venue-builder entry point.
 *
 * Generation lives in `@party-tracker/venue-builder/routing-coverage.js` so
 * `venues:reindex` stamps the GeoJSON. Scaffold and Fastlane keep this path.
 */
import { join } from 'node:path';
import {
  MAX_POLYGONS,
  PAD_DEG,
  ROUTING_COVERAGE_FILE,
  ROUTING_COVERAGE_REL,
  assertAppleRoutingCoverage,
  coverageFromVenues,
  padBounds,
  pointInCoverage,
  ringFromBounds,
  routingCoverageIssues,
  writeRoutingCoverage as writeRoutingCoverageFile,
} from '../../packages/venue-builder/src/routing-coverage.mjs';

export {
  MAX_POLYGONS,
  PAD_DEG,
  ROUTING_COVERAGE_FILE,
  ROUTING_COVERAGE_REL,
  assertAppleRoutingCoverage,
  coverageFromVenues,
  padBounds,
  pointInCoverage,
  ringFromBounds,
  routingCoverageIssues,
};

export function routingCoveragePath(root) {
  return join(root, ROUTING_COVERAGE_REL);
}

export function writeRoutingCoverage(root, venues) {
  return writeRoutingCoverageFile(venues, join(root, ROUTING_COVERAGE_REL));
}
