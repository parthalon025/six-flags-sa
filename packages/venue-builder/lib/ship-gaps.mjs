/**
 * Thin Gaps the phone may fetch — one fact per row, invented here once.
 *
 * Builder ask seeds and low-confidence queue evidence stay in certification
 * sidecars. This module is the seam that ships what guests can settle:
 * height, queue, path, restroom, food, gate, camping (ADR-0009's frozen
 * seven), verify (stale adapter cache), inventory (adapter under-coverage,
 * from inventory-gaps.mjs). Credits, aliases, locality, and live ops never go
 * in `*.gaps.json`.
 *
 * Disputes are not on that list and cannot be added to it. Where sources
 * disagree the builder keeps a maintainer record (imagery-disputes.mjs) and
 * ships nothing — the owner's answer, 2026-08-22, to "how does a disputed path
 * position reach a guest?" was that it does not. `assertNoDisputeKinds` runs
 * over the allowlist below at module load, so putting a dispute kind back into
 * it fails the builder instead of reaching a phone.
 *
 * Place keys `i` are unique. Invent one Gap per `i`. A display name is only
 * a fallback when exactly one Place has that title; an ambiguous title is
 * skipped, not forked.
 *
 * Does not import venue-io (venue-io calls this after reading sidecars).
 */

import { questSeedsFromEntrances } from './quest-seeds.mjs';
import { ambientSignalShipArtifacts } from './ambient-signal-seeds.mjs';
import { assertNoDisputeKinds, isDisputeKind } from './imagery-disputes.mjs';

export const SHIPPED_GAP_TYPES = Object.freeze([
  'height',
  'queue',
  'path',
  'restroom',
  'food',
  'gate',
  'camping',
  'verify',
  'inventory',
]);

assertNoDisputeKinds(SHIPPED_GAP_TYPES, 'ship-gaps.mjs SHIPPED_GAP_TYPES');

/** Rides farther than this from walkable geometry get a targeted path Gap. */
export const PATH_RIDE_SNAP_METRES = 35;

const TYPE_RANK = Object.fromEntries(SHIPPED_GAP_TYPES.map((t, i) => [t, i]));

const DROP_SEED_TYPES = new Set(['name_fix']);

const RIDE = (p) => p && (p.c === 'coaster' || p.c === 'ride');

/**
 * Map a builder seed onto a shipped Gap type, or null to drop it.
 * @param {object} seed
 * @returns {string | null}
 */
export function shippedTypeForSeed(seed) {
  if (!seed) return null;
  if (seed.sourceGap === 'adapter_stale') return 'verify';
  // A dispute seed has no shipped type by construction, whatever it is called.
  // The seed still exists — questSeedsForVenue keeps it in the certification
  // brief and imagery-disputes.mjs keeps the imagery half — it simply has no
  // channel to the phone.
  if (isDisputeKind(seed.sourceGap) || isDisputeKind(seed.type)) return null;
  if (DROP_SEED_TYPES.has(seed.type)) return null;
  if (seed.sourceGap === 'credits' || seed.sourceGap === 'locality') return null;
  if (seed.sourceGap === 'ambient_ops') return null;
  if (seed.type === 'height_rule' || seed.sourceGap === 'heights') return 'height';
  if (seed.type === 'geometry_nudge' || seed.sourceGap === 'entrance_missing' || seed.sourceGap === 'entrance_low_confidence') {
    return 'queue';
  }
  if (seed.sourceGap === 'camping' || seed.type === 'poi_attribute') return 'camping';
  if (seed.type === 'poi_presence' || seed.sourceGap === 'missing-poi') {
    return presenceTypeFromSeed(seed);
  }
  return null;
}

function presenceTypeFromSeed(seed) {
  const from = (blob) => {
    if (/\btoilet|\brestroom/.test(blob)) return 'restroom';
    if (/\bfood|\beat\b/.test(blob)) return 'food';
    if (/\bgate\b|\bway in\b/.test(blob)) return 'gate';
    return null;
  };
  return from(String(seed.target || '').toLowerCase()) || from(String(seed.need || '').toLowerCase());
}

/**
 * Resolve a seed target to one Place key `i`. Name fallback only when exactly
 * one Place has that title. Ambiguous titles return null — do not fork.
 * @param {object[]} pois
 * @param {string | null} target
 * @returns {string | null}
 */
export function resolveGapTarget(pois, target) {
  if (target == null || target === '') return null;
  const list = Array.isArray(pois) ? pois : [];
  const byKey = list.find((p) => p && (p.i === target || p.id === target));
  if (byKey) return byKey.i || byKey.id || null;
  const byName = list.filter((p) => p && p.n === target);
  if (byName.length !== 1) return null;
  return byName[0].i || byName[0].id || null;
}

function metresBetween(aLat, aLng, bLat, bLng) {
  const kx = 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot((bLng - aLng) * kx, (bLat - aLat) * 110540);
}

function distPointToSegment(lat, lng, aLat, aLng, bLat, bLng) {
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const px = lng * kx;
  const py = lat * ky;
  const ax = aLng * kx;
  const ay = aLat * ky;
  const bx = bLng * kx;
  const by = bLat * ky;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function walkableRings(map) {
  const rings = [];
  for (const layer of [map?.path, map?.service]) {
    for (const way of layer || []) {
      if (Array.isArray(way?.r) && way.r.length) rings.push(way.r);
    }
  }
  return rings;
}

/** Metres from a point to the nearest walkable path/service segment, or Infinity. */
export function metresToWalkable(map, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const rings = walkableRings(map);
  if (!rings.length) return Infinity;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      if (!a || a.length < 2) continue;
      const d = b && b.length >= 2
        ? distPointToSegment(lat, lng, a[1], a[0], b[1], b[0])
        : metresBetween(lat, lng, a[1], a[0]);
      if (d < best) best = d;
    }
  }
  return best;
}

function pathGapsFromMap(pois, map) {
  if (map == null) return [];
  const stranded = [];
  const seen = new Set();
  for (const p of pois || []) {
    if (!RIDE(p)) continue;
    const i = p.i || p.id;
    if (!i || seen.has(i)) continue;
    seen.add(i);
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const d = metresToWalkable(map, p.lat, p.lng);
    if (d == null || d > PATH_RIDE_SNAP_METRES) stranded.push({ type: 'path', target: i });
  }
  return [...stranded.slice(0, 60), { type: 'path', target: null }];
}

function heightGapsFromPois(pois) {
  const out = [];
  const seen = new Set();
  for (const p of pois || []) {
    if (!RIDE(p) || p.h) continue;
    const i = p.i || p.id;
    if (!i || seen.has(i)) continue;
    seen.add(i);
    out.push({ type: 'height', target: i });
  }
  return out;
}

function presenceAndCampingSeeds(meta, pois) {
  const seeds = [];
  for (const [type, needle] of [
    ['restroom', 'toilet'],
    ['food', 'food'],
    ['gate', 'gate'],
  ]) {
    if (!pois.some((p) => p.c === type)) {
      seeds.push({ type: 'poi_presence', sourceGap: 'missing-poi', target: needle, need: needle });
    }
  }
  const camps = pois.filter((p) => p.c === 'campsite');
  if (camps.length && !meta?.camping && !pois.some((p) => p.camp)) {
    seeds.push({ type: 'poi_attribute', sourceGap: 'camping', target: null });
  }
  return seeds;
}

/**
 * Atomic Gaps the phone ranks. One row per fact. Height is invented per unique
 * Place key `i` (not per display name). Path Gaps need a `map`; omit it in
 * unit tests that are not about walk geometry.
 *
 * @param {{ venueId: string, seeds?: object[], pois?: object[], map?: object | null, inventoryGaps?: { type: string, target: string | null }[] }} opts
 * @returns {{ version: number, venue: string, gaps: { type: string, target: string | null }[] }}
 */
export function shippedGapsDocument({ venueId, seeds = [], pois = [], map = null, inventoryGaps = [] } = {}) {
  const seen = new Set();
  const gaps = [];
  const add = (type, target) => {
    const key = `${type}:${target ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    gaps.push({ type, target: target ?? null });
  };

  for (const gap of heightGapsFromPois(pois)) add(gap.type, gap.target);

  for (const gap of inventoryGaps || []) {
    if (gap && gap.type === 'inventory') add('inventory', gap.target);
  }

  for (const seed of seeds) {
    const type = shippedTypeForSeed(seed);
    if (!type) continue;
    if (type === 'height' || type === 'queue') {
      const target = resolveGapTarget(pois, seed.target);
      if (target) add(type, target);
      continue;
    }
    if (type === 'verify') {
      add(type, seed.adapterId || null);
      continue;
    }
    add(type, null);
  }

  for (const gap of pathGapsFromMap(pois, map)) add(gap.type, gap.target);

  gaps.sort((a, b) => {
    const tr = (TYPE_RANK[a.type] ?? 99) - (TYPE_RANK[b.type] ?? 99);
    if (tr) return tr;
    return String(a.target || '').localeCompare(String(b.target || ''));
  });
  return {
    version: 1,
    venue: venueId || null,
    gaps,
  };
}

/**
 * Invent Gaps for a built venue without going through venue-requests
 * (that import cycle would pull venue-io back in).
 *
 * Imagery extractions do not appear here. A disputed extraction is recorded by
 * imagery-disputes.mjs and stops there; nothing about it is on the wire.
 *
 * @param {{ venueId: string, meta?: object, pois?: object[], map?: object, attractions?: object | null }} opts
 */
export function shippedGapsForVenue({
  venueId,
  meta = null,
  pois = [],
  map = {},
  attractions = null,
  adapterCaches = null,
  gapNotes = {},
  asOf,
} = {}) {
  const signals = ambientSignalShipArtifacts({
    venueId,
    adapterCaches: adapterCaches || {},
    attractions,
    gapNotes,
    asOf,
  });
  const seeds = [
    ...questSeedsFromEntrances(venueId, attractions),
    ...presenceAndCampingSeeds(meta, pois),
    ...signals.seeds,
  ];
  return shippedGapsDocument({ venueId, seeds, pois, map: map ?? {} });
}
