/**
 * Server-side contribution abuse controls (E9 / #301).
 *
 * Proximity enforcement mirrors the client NEARBY_RADIUS_M so UX and the API
 * agree. Dedupe window is per (author, place, kind) — see store.insertContribution.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distance } from '../geo.js';
import { NEARBY_RADIUS_M } from '../sideQuests.js';

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const poisCache = new Map();

function poisForVenue(venueId) {
  if (poisCache.has(venueId)) return poisCache.get(venueId);
  const path = join(APP_ROOT, 'public', 'venues', `${venueId}.pois.json`);
  if (!existsSync(path)) {
    poisCache.set(venueId, null);
    return null;
  }
  const pois = JSON.parse(readFileSync(path, 'utf8'));
  poisCache.set(venueId, pois);
  return pois;
}

/** Max distance from the target Place fix; shared with Side Quests client radius. */
export const CONTRIBUTION_PROXIMITY_MAX_M = NEARBY_RADIUS_M;

/** Waze-like repeat-edit window — per hour / per POI (design doc). */
export const CONTRIBUTION_DEDUPE_WINDOW_MS = 60 * 60 * 1000;

/** Durable kinds that always target a Place — proximity gate cannot be skipped. */
export const PLACE_TARGETED_CONTRIBUTION_KINDS = new Set([
  'height',
  'height_rule',
  'poi_patch',
  'drop_place',
]);

function placeCentroid(venueId, placeId) {
  const pois = poisForVenue(venueId);
  if (!pois) return null;
  const id = String(placeId || '').trim();
  if (!id) return null;
  const poi = pois.find((p) => p.i === id || p.id === id);
  if (!poi || !Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return null;
  return { lat: poi.lat, lng: poi.lng };
}

/**
 * @param {{ venueId: string, placeId?: string, kind: string, lat?: number, lng?: number }} input
 * @returns {{ ok: true } | { ok: false, code: string, error: string }}
 */
export function assessContributionProximity(input) {
  const kind = String(input.kind || '').trim();
  const placeId = input.placeId != null ? String(input.placeId).trim() : '';
  if (!placeId) {
    if (PLACE_TARGETED_CONTRIBUTION_KINDS.has(kind)) {
      return {
        ok: false,
        code: 'contribution_place_required',
        error: 'placeId is required for this contribution kind',
      };
    }
    return { ok: true };
  }

  const lat = input.lat;
  const lng = input.lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return {
      ok: false,
      code: 'contribution_fix_required',
      error: 'A GPS fix near the target Place is required for this contribution',
    };
  }

  const target = placeCentroid(input.venueId, placeId);
  if (!target) {
    return {
      ok: false,
      code: 'contribution_place_unknown',
      error: 'Unknown Place for this venue',
    };
  }

  const metres = distance(lat, lng, target.lat, target.lng);
  if (metres > CONTRIBUTION_PROXIMITY_MAX_M) {
    return {
      ok: false,
      code: 'contribution_too_far',
      error: `Submitted fix is ${Math.round(metres)} m from the Place; must be within ${CONTRIBUTION_PROXIMITY_MAX_M} m`,
    };
  }

  return { ok: true };
}
