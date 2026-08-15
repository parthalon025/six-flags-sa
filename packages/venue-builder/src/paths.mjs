import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Monorepo root (party-tracker/). */
export const MONO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Next.js app package root. */
export const APP_ROOT = path.join(MONO_ROOT, 'apps', 'party-tracker');

/** Venue-builder package root. */
export const BUILDER_ROOT = fileURLToPath(new URL('../', import.meta.url));

export const VENUE_DIR = path.join(APP_ROOT, 'public', 'venues');
export const OVERRIDE_DIR = path.join(BUILDER_ROOT, 'data', 'venues');
export const INDEX_FILE = path.join(APP_ROOT, 'lib', 'venueIndex.js');
export const MANIFEST_FILE = path.join(VENUE_DIR, 'manifest.json');
/** App Store Connect routing coverage — stamped by `reindex()`, not hand-edited. */
export const ROUTING_COVERAGE_FILE = path.join(
  MONO_ROOT,
  'fastlane',
  'metadata',
  'ios',
  'routing_app_coverage.geojson',
);
