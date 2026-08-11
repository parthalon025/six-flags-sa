/**
 * Official park maps — catalogue helpers and georeferencing policy.
 *
 * Park handout maps are often schematic (not to scale): lands are exaggerated,
 * paths are straightened, and a global similarity fit fails. Thin-plate spline
 * (TPS) with leave-one-out RMS is the transform for that case; this module picks
 * defaults by `map_kind` so schematic maps get a honest error budget instead of
 * being thrown away or pretending to be survey-grade.
 *
 * map_kind:
 *   to_scale  — surveyed / CAD-like print; tight error budget
 *   photo     — photograph of a map board (projective often wins)
 *   schematic — illustrated / not-to-scale handout (TPS; looser budget)
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readJson, writeJson, venueSidecar, venueSidecarRel } from './venue-io.mjs';
import { readSources } from './venue-sources.mjs';

export const MAP_KINDS = ['to_scale', 'photo', 'schematic'];

/** Default georef policy per map kind (metres / model hints). */
export const GEOREF_POLICY = {
  to_scale: {
    preferredModel: 'auto',
    smoothing: 0,
    maxErrorM: 10,
    minControls: 4,
    note: 'Survey-grade or CAD print — refuse fits worse than ~one midway width.',
  },
  photo: {
    preferredModel: 'auto',
    smoothing: 0,
    maxErrorM: 12,
    minControls: 4,
    note: 'Photo of a map board — projective often wins; still refuse large CV error.',
  },
  schematic: {
    preferredModel: 'tps',
    smoothing: 0.25,
    maxErrorM: 25,
    minControls: 8,
    note: 'Illustrated / not-to-scale park map — TPS warp; pins publish as approximate until corroborated.',
  },
};

export function normalizeMapKind(value) {
  const k = String(value || '').toLowerCase().replace(/-/g, '_');
  if (MAP_KINDS.includes(k)) return k;
  if (k === 'illustrated' || k === 'not_to_scale' || k === 'cartoon') return 'schematic';
  if (k === 'scan' || k === 'cad' || k === 'survey') return 'to_scale';
  return null;
}

export function georefPolicyFor(mapKind, overrides = {}) {
  const kind = normalizeMapKind(mapKind) || 'to_scale';
  const base = GEOREF_POLICY[kind];
  return {
    mapKind: kind,
    preferredModel: overrides.model || base.preferredModel,
    smoothing: overrides.smoothing != null ? Number(overrides.smoothing) : base.smoothing,
    maxErrorM: overrides.maxErrorM != null ? Number(overrides.maxErrorM) : base.maxErrorM,
    minControls: base.minControls,
    note: base.note,
  };
}

/**
 * Official map rows from a venue sources catalogue.
 * @returns {{ id, url, image, mapKind, usedFor, policy }[]}
 */
export function officialMapsFromCatalog(catalog) {
  const rows = [];
  for (const s of catalog?.sources || []) {
    if (s.kind !== 'official_map') continue;
    const mapKind = normalizeMapKind(s.map_kind) || (s.image ? 'schematic' : 'to_scale');
    rows.push({
      id: s.id || 'official-map',
      url: s.url || null,
      image: s.image || null,
      mapKind,
      usedFor: s.used_for || null,
      policy: georefPolicyFor(mapKind),
    });
  }
  return rows;
}

export function officialMapsForVenue(venueId) {
  const { data } = readSources(venueId);
  return officialMapsFromCatalog(data);
}

export const traceTemplateFile = (id) => venueSidecar(id, 'trace.json');
export const tracedGeoJsonFile = (id) => venueSidecar(id, 'traced.geojson');

/**
 * Scaffold an empty pixel-trace file for an official map (controls/features blank).
 * Does not invent coordinates — maintainer fills px + lat/lng from OSM corners.
 */
export function scaffoldOfficialMapTrace(venueId, opts = {}) {
  const maps = officialMapsForVenue(venueId);
  const pick = opts.mapId ? maps.find((m) => m.id === opts.mapId) : maps[0];
  if (!pick) {
    throw new Error(
      `No official_map in data/venues/${venueId}/sources.json — add kind "official_map" with image and map_kind.`,
    );
  }
  const policy = pick.policy;
  const doc = {
    version: 1,
    venue: venueId,
    image: pick.image || opts.image || null,
    source: pick.url || pick.id,
    map_kind: pick.mapKind,
    model: policy.preferredModel,
    smoothing: policy.smoothing,
    max_error_m: policy.maxErrorM,
    _comment:
      'Control points: identify the same place in the picture AND in OpenStreetMap '
      + '(building corner, path junction, pool end). Spread to the park corners. '
      + `For ${pick.mapKind} maps prefer ≥${policy.minControls} controls. `
      + 'Features: entrance/exit (of: ride name), place (n + c), route/path (walking lines). '
      + `Run: npm run venues:trace -- data/venues/${venueId}/trace.json`,
    controls: [],
    features: [],
  };
  const file = opts.file || traceTemplateFile(venueId);
  if (existsSync(file) && !opts.force) {
    return { file, wrote: false, reason: 'exists', doc: readJson(file), map: pick };
  }
  writeJson(file, doc, true);
  return { file, wrote: true, doc, map: pick };
}

/**
 * Resolve georef options for a trace document, merging CLI overrides.
 */
export function resolveTraceGeorefOptions(trace, cli = {}) {
  const mapKind = normalizeMapKind(trace.map_kind)
    || normalizeMapKind(cli.mapKind)
    || (trace.image ? 'schematic' : 'to_scale');
  const policy = georefPolicyFor(mapKind, {
    model: cli.model || trace.model,
    smoothing: cli.smoothing != null ? cli.smoothing : trace.smoothing,
    maxErrorM: cli.maxErrorM != null
      ? cli.maxErrorM
      : (trace.max_error_m != null ? trace.max_error_m : undefined),
  });
  return policy;
}

/**
 * Ensure sources.json datasets.trace lists the traced GeoJSON when present.
 */
export function ensureTraceDatasetWired(venueId) {
  const traced = tracedGeoJsonFile(venueId);
  if (!existsSync(traced)) return { wired: false, reason: 'no_traced_geojson' };
  const { file, data } = readSources(venueId);
  if (!data) return { wired: false, reason: 'no_sources' };
  const rel = venueSidecarRel(venueId, 'traced.geojson');
  data.datasets = data.datasets || {};
  const list = Array.isArray(data.datasets.trace) ? [...data.datasets.trace] : [];
  if (!list.includes(rel)) list.push(rel);
  data.datasets.trace = list;
  writeJson(venueSidecar(venueId, 'sources.json'), data, true);
  return { wired: true, file: rel, catalog: file };
}
