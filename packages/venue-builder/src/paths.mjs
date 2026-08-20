import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Directory containing this file (packages/venue-builder/src/), resolved once.
 * Deliberately not computed by passing a relative path plus import.meta.url
 * into the `URL` constructor — bundlers (Turbopack, webpack) statically
 * detect that two-argument call and try to resolve the relative segment as
 * an asset module, which fails with "Module not found" for a directory
 * target that isn't a real file. Plain `fileURLToPath(import.meta.url)`
 * isn't special-cased, so this computes the identical path while staying
 * resolvable once this module is bundled into the Next.js app.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Monorepo root (party-tracker/). */
export const MONO_ROOT = path.join(HERE, '..', '..', '..');

/** Next.js app package root. */
export const APP_ROOT = path.join(MONO_ROOT, 'apps', 'party-tracker');

/** Venue-builder package root. */
export const BUILDER_ROOT = path.join(HERE, '..');

export const VENUE_DIR = path.join(APP_ROOT, 'public', 'venues');
export const OVERRIDE_DIR = path.join(BUILDER_ROOT, 'data', 'venues');

/**
 * The builder's per-venue data packages (sidecars: recipe.json,
 * overrides.json, …) — the app-facing seam for the one thing outside this
 * package that legitimately needs the directory (issue #475). App code must
 * call this instead of composing the path itself, so the builder can
 * restructure data/ without silently breaking the app; the matt-standards
 * path-literal lint (scripts/lib/matt-standards.mjs) holds the line.
 */
export const venueDataDir = () => OVERRIDE_DIR;
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
