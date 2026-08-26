/**
 * Compare built venue bundles against manifest expectations and on-disk recipes.
 * Used by builder tests, the inspection UI, and the app's admin page.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { MANIFEST_FILE, OVERRIDE_DIR, ROUTING_COVERAGE_FILE, VENUE_DIR } from './paths.mjs';
import { venueSidecar } from '../lib/venue-io.mjs';
import {
  coverageFromVenues,
  pointInCoverage,
  routingCoverageIssues,
} from './routing-coverage.mjs';

const hasHeights = (pois) => pois.some((p) => p.h);

export function readManifest() {
  return JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));
}

export function readPois(id) {
  const file = path.join(VENUE_DIR, `${id}.pois.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function readMap(id) {
  const file = path.join(VENUE_DIR, `${id}.map.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function countMapPaths(map) {
  if (!map) return 0;
  if (map.meta?.coverage?.ways != null) return map.meta.coverage.ways;
  const layers = ['path', 'service', 'coaster', 'slide', 'pool', 'park', 'building', 'parking'];
  let n = 0;
  for (const key of layers) {
    if (Array.isArray(map[key])) n += map[key].length;
  }
  if (Array.isArray(map.lands)) n += map.lands.length;
  return n;
}

export function compareVenue(venue) {
  const id = venue.id;
  const pois = readPois(id);
  const map = readMap(id);
  const issues = [];
  const stats = {
    id,
    name: venue.name,
    manifest: venue.counts || {},
    coverage: venue.coverage || {},
    actual: {},
    ok: true,
  };

  if (!pois) {
    issues.push('missing pois.json');
    stats.ok = false;
    return { stats, issues };
  }
  if (!map) {
    issues.push('missing map.json');
    stats.ok = false;
    return { stats, issues };
  }

  const rides = pois.filter((p) => p.c === 'coaster' || p.c === 'ride').length;
  const heights = pois.filter((p) => p.h).length;
  const campsites = pois.filter((p) => p.c === 'campsite').length;
  const paths = countMapPaths(map);

  stats.actual = {
    pois: pois.length,
    rides,
    heights,
    campsites,
    paths,
    hasHeightsTab: hasHeights(pois),
  };

  const expected = venue.counts || {};
  const tol = (a, b, label, slack = 0) => {
    if (a == null || b == null) return;
    if (Math.abs(a - b) > slack) {
      issues.push(`${label}: manifest says ${b}, disk has ${a}`);
      stats.ok = false;
    }
  };

  tol(pois.length, expected.pois, 'poi count', 2);
  tol(rides, expected.rides, 'ride count', 2);
  tol(heights, expected.heights, 'height count', 2);
  tol(paths, venue.coverage?.ways, 'path count', 0);

  const recipeFile = venueSidecar(id, 'recipe.json');
  if (!existsSync(recipeFile)) {
    issues.push('no recipe on disk — cannot rebuild');
    stats.ok = false;
  }

  if (venue.camping && campsites < 1) {
    issues.push('manifest declares camping but no campsite POIs found');
    stats.ok = false;
  }

  return { stats, issues };
}

export function compareAll() {
  const manifest = readManifest();
  return manifest.venues.map((v) => compareVenue(v));
}

/**
 * Stable sha256 over the shipped map + pois bundle bytes.
 * Certification checks also read attractions, recipes, and adapter caches — those
 * inputs are not part of this fingerprint; re-run venues:certify when they drift.
 */
export function bundleFingerprint(id) {
  const mapFile = path.join(VENUE_DIR, `${id}.map.json`);
  const poisFile = path.join(VENUE_DIR, `${id}.pois.json`);
  if (!existsSync(mapFile) || !existsSync(poisFile)) return null;
  const hash = createHash('sha256');
  hash.update(readFileSync(mapFile));
  hash.update(readFileSync(poisFile));
  return hash.digest('hex');
}

/**
 * Pure. Does a certification artifact still describe the bundle on disk?
 */
export function certificationFreshnessDecision({ certification, currentFingerprint }) {
  if (!certification) return { fresh: true, reason: 'no-cert' };
  const pinned = certification.bundleFingerprint ?? null;
  if (!pinned) return { fresh: false, reason: 'unpinned' };
  if (!currentFingerprint) return { fresh: false, reason: 'missing-bundle' };
  if (pinned !== currentFingerprint) {
    return { fresh: false, reason: 'stale', pinned, current: currentFingerprint };
  }
  return { fresh: true };
}

/** Every committed certification.json must pin the bundle it certified. */
export function compareCertificationFreshness() {
  const manifest = readManifest();
  const issues = [];
  for (const venue of manifest.venues) {
    const certFile = venueSidecar(venue.id, 'certification.json');
    if (!existsSync(certFile)) continue;
    const certification = JSON.parse(readFileSync(certFile, 'utf8'));
    const current = bundleFingerprint(venue.id);
    const decision = certificationFreshnessDecision({ certification, currentFingerprint: current });
    if (!decision.fresh) {
      issues.push(`${venue.id}: certification ${decision.reason}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/**
 * App Store routing coverage must match shipped venue bounds (builder → store).
 */
export function compareRoutingCoverage() {
  const issues = [];
  const manifest = readManifest();
  if (!existsSync(ROUTING_COVERAGE_FILE)) {
    return {
      ok: false,
      issues: ['missing routing_app_coverage.geojson — run npm run venues:reindex'],
    };
  }
  const actual = JSON.parse(readFileSync(ROUTING_COVERAGE_FILE, 'utf8'));
  issues.push(...routingCoverageIssues(actual));
  const expected = coverageFromVenues(manifest.venues);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    issues.push('geojson does not match shipped venue bounds — run npm run venues:reindex');
  }
  for (const venue of manifest.venues) {
    const center = venue.center;
    if (!center || !pointInCoverage(actual, center)) {
      issues.push(`${venue.id} center is outside App Store routing coverage`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function summary(reports) {
  const passed = reports.filter((r) => r.stats.ok).length;
  return { total: reports.length, passed, failed: reports.length - passed, reports };
}
