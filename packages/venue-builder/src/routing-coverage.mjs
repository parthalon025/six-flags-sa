/**
 * Apple routing-app coverage GeoJSON (one MultiPolygon) from shipped venue bounds.
 *
 * App Store Connect → version → Routing App Coverage File.
 * Spec: https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/ProvidingDirections/ProvidingDirections.html
 *
 * `venues:reindex` / `venues:build` stamp this so a new park updates the store
 * file. Do not hand-edit the generated GeoJSON.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ROUTING_COVERAGE_FILE } from './paths.mjs';

export const ROUTING_COVERAGE_REL = 'fastlane/metadata/ios/routing_app_coverage.geojson';
export { ROUTING_COVERAGE_FILE };
export const PAD_DEG = 0.01;
export const MAX_POLYGONS = 20;

function roundCoord(n) {
  return Number(Number(n).toFixed(5));
}

export function padBounds(bounds, padDeg = PAD_DEG) {
  return {
    west: roundCoord(bounds.west - padDeg),
    east: roundCoord(bounds.east + padDeg),
    south: roundCoord(bounds.south - padDeg),
    north: roundCoord(bounds.north + padDeg),
  };
}

/** Closed rectangle, counterclockwise, GeoJSON [lng, lat]. */
export function ringFromBounds(bounds) {
  const { west, east, south, north } = bounds;
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

export function coverageFromVenues(venues, { padDeg = PAD_DEG } = {}) {
  const withBounds = [...venues]
    .filter((v) => v?.bounds && v.bounds.west != null && v.bounds.north != null)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const coordinates = withBounds.map((venue) => [
    ringFromBounds(padBounds(venue.bounds, padDeg)),
  ]);

  return {
    type: 'MultiPolygon',
    coordinates,
  };
}

export function routingCoverageIssues(geojson) {
  const issues = [];
  if (!geojson || geojson.type !== 'MultiPolygon') {
    issues.push('type must be MultiPolygon');
    return issues;
  }
  const polys = geojson.coordinates;
  if (!Array.isArray(polys) || polys.length === 0) {
    issues.push('MultiPolygon must contain at least one Polygon');
    return issues;
  }
  if (polys.length > MAX_POLYGONS) {
    issues.push(`MultiPolygon may contain at most ${MAX_POLYGONS} Polygons`);
  }

  for (let i = 0; i < polys.length; i += 1) {
    const polygon = polys[i];
    if (!Array.isArray(polygon) || polygon.length === 0) {
      issues.push(`polygon ${i} must have at least one ring`);
      continue;
    }
    if (polygon.length > 1) {
      issues.push(`polygon ${i} must not contain holes`);
    }
    const ring = polygon[0];
    if (!Array.isArray(ring) || ring.length < 4) {
      issues.push(`polygon ${i} ring must have at least 4 positions`);
      continue;
    }
    for (const pos of ring) {
      if (!Array.isArray(pos) || pos.length !== 2) {
        issues.push(`polygon ${i} positions must be [longitude, latitude]`);
        break;
      }
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      issues.push(`polygon ${i} must be a closed ring`);
    }
  }
  return issues;
}

export function assertAppleRoutingCoverage(geojson) {
  const issues = routingCoverageIssues(geojson);
  if (issues.length) {
    throw new Error(issues.join('\n'));
  }
  return geojson;
}

/** Axis-aligned rings (our venue boxes). */
export function pointInCoverage(geojson, { lat, lng } = {}) {
  if (lat == null || lng == null || geojson?.type !== 'MultiPolygon') return false;
  for (const polygon of geojson.coordinates || []) {
    const ring = polygon?.[0];
    if (!Array.isArray(ring) || ring.length < 4) continue;
    const lngs = ring.map((p) => p[0]);
    const lats = ring.map((p) => p[1]);
    if (
      lng >= Math.min(...lngs) &&
      lng <= Math.max(...lngs) &&
      lat >= Math.min(...lats) &&
      lat <= Math.max(...lats)
    ) {
      return true;
    }
  }
  return false;
}

export function writeRoutingCoverage(venues, file = ROUTING_COVERAGE_FILE) {
  const withBounds = (venues || []).filter(
    (v) => v?.bounds && v.bounds.west != null && v.bounds.north != null,
  );
  if (!withBounds.length) return null;
  const geojson = assertAppleRoutingCoverage(coverageFromVenues(withBounds));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(geojson, null, 2)}\n`);
  return file;
}
