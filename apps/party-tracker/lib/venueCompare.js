/**
 * Venue bundle comparison for the app admin API (no import.meta of its own —
 * safe for the Next bundler; the builder-data seam below handles bundling on
 * its side of the boundary).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
// The builder's entry-point seam for its venue data packages (issue #475) —
// never compose that path by hand from here.
import { venueDataDir } from '@party-tracker/venue-builder/paths.js';

function appRoot() {
  const cwd = process.cwd();
  if (cwd.endsWith('party-tracker')) return cwd;
  return path.join(cwd, 'apps', 'party-tracker');
}

const VENUE_DIR = () => path.join(appRoot(), 'public', 'venues');

const hasHeights = (pois) => pois.some((p) => p.h);

function countMapPaths(map) {
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

export function readManifest() {
  return JSON.parse(readFileSync(path.join(VENUE_DIR(), 'manifest.json'), 'utf8'));
}

export function compareVenue(venue) {
  const id = venue.id;
  const poisPath = path.join(VENUE_DIR(), `${id}.pois.json`);
  const mapPath = path.join(VENUE_DIR(), `${id}.map.json`);
  const issues = [];
  const stats = {
    id,
    name: venue.name,
    manifest: venue.counts || {},
    coverage: venue.coverage || {},
    actual: {},
    ok: true,
  };

  if (!existsSync(poisPath)) {
    issues.push('missing pois.json');
    stats.ok = false;
    return { stats, issues };
  }
  if (!existsSync(mapPath)) {
    issues.push('missing map.json');
    stats.ok = false;
    return { stats, issues };
  }

  const pois = JSON.parse(readFileSync(poisPath, 'utf8'));
  const map = JSON.parse(readFileSync(mapPath, 'utf8'));
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

  // Sidecars live in the builder's venue data packages, one directory per
  // venue with recipe.json inside it (not <id>.recipe.json at the root).
  if (!existsSync(path.join(venueDataDir(), id, 'recipe.json'))) {
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
  return readManifest().venues.map((v) => compareVenue(v));
}

export function summary(reports) {
  const passed = reports.filter((r) => r.stats.ok).length;
  return { total: reports.length, passed, failed: reports.length - passed, reports };
}
