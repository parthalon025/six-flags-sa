/**
 * venues:report gate — re-export from venue-builder.
 *
 * Canonical implementation: packages/venue-builder/lib/venue-report-gate.mjs
 * Relative import here so gate-tests runs before `npm ci` can link workspaces.
 */
export {
  readExpectLock,
  checkExpectLock,
  checkVenueReport,
  checkAllVenueReports,
  checkShippedVenueReports,
} from '../../packages/venue-builder/lib/venue-report-gate.mjs';
