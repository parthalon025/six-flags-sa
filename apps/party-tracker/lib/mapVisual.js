/**
 * Map visual policy — palette timing, first paint, declutter ranks, fog filter.
 * ADR-0012 + root CONTEXT.md.
 */

import { labelWantedAtZoom } from './mapSymbols.js';

/** First ship-polish Skins (store + delight tier). */
export const SHIP_SKIN_IDS = ['postcard', 'marquee', 'junior', 'pixel-tycoon'];

/** Categories on at gate before the visitor opens the key. */
export const GATE_CATEGORY_ORDER = [
  'coaster',
  'ride',
  'gate',
  'landmark',
  'service',
  'food',
  'restroom',
  'campsite',
];

/** Quiet when kids are on the roster (device-less Members). */
const KIDS_QUIET_CATEGORIES = ['show', 'shop', 'parking'];

/**
 * Trail (day) between 7:00 and 19:59 local; Park Midnight otherwise.
 */
export function autoPalette(now = Date.now()) {
  const h = new Date(now).getHours();
  return h >= 7 && h < 20 ? 'day' : 'night';
}

/**
 * @param {{ paletteMode?: string, manualTheme?: string, now?: number }} opts
 */
export function resolvePalette({ paletteMode = 'auto', manualTheme = 'night', now = Date.now() } = {}) {
  if (paletteMode === 'auto') return autoPalette(now);
  return manualTheme === 'day' ? 'day' : 'night';
}

export function cyclePaletteMode(current) {
  if (current === 'auto') return 'day';
  if (current === 'day') return 'night';
  return 'auto';
}

export function paletteModeLabel(mode) {
  if (mode === 'auto') return 'Auto (sunset)';
  if (mode === 'day') return 'Trail (light)';
  return 'Park Midnight (dark)';
}

export function paletteToggleAria(mode, resolved) {
  if (mode === 'auto') {
    return resolved === 'day' ? 'Map follows sunset — switch to Park Midnight' : 'Map follows sunset — switch to Trail';
  }
  return resolved === 'day' ? 'Switch to Park Midnight map' : 'Switch to Trail map';
}

/**
 * Device-less Members on roster → sparser category set on first paint.
 */
export function rosterHasDeviceLess(roster = []) {
  return roster.some((m) => m && !m.device && m.id);
}

/**
 * @param {{ roster?: unknown[], presentCategories?: Set<string>, base?: Set<string> }} opts
 */
export function categoriesForGate({ roster = [], presentCategories = null, base = null } = {}) {
  const present = presentCategories || null;
  const out = new Set();
  for (const key of GATE_CATEGORY_ORDER) {
    if (present && !present.has(key)) continue;
    out.add(key);
  }
  if (!rosterHasDeviceLess(roster)) {
    for (const key of ['show', 'shop', 'parking']) {
      if (!present || present.has(key)) out.add(key);
    }
  }
  if (base) {
    for (const key of base) {
      if (!present || present.has(key)) out.add(key);
    }
  }
  return out;
}

/** Declutter priority bucket for a POI marker (lower wins). */
export function markerDeclutterPriority({
  isSelected = false,
  isNav = false,
  isPlanNext = false,
  rank = 5,
  barred = false,
  index = 0,
}) {
  if (isSelected) return -1000;
  if (isNav) return -900;
  if (isPlanNext) return -850;
  return rank * 1000 + (barred ? 250 : 0) + index;
}

/**
 * Whether a marker gets a name at this zoom. The policy layer here is only
 * pin promotion (Go target / next Plan stop always named, selection never —
 * its name lives in the sheet); the zoom decision itself delegates to the
 * shared labelWantedAtZoom so the canonical hysteresis is what ships.
 */
export function markerWantsLabel({ isSelected, isNav, isPlanNext, rank, zPlan, wasShown }) {
  if (isSelected) return false;
  if (isNav || isPlanNext) return true;
  return labelWantedAtZoom(rank, zPlan, wasShown);
}

/**
 * Soft fog filter on the map canvas when Profile opt-in is on.
 * @returns {{ saturate: number, brightness: number } | null}
 */
export function fogMapStyle(progress, venueId) {
  if (!progress?.fogMapEnabled || !venueId) return null;
  const meters = progress.meters || {};
  const walked = (meters.walkedByVenue?.[venueId] || []).length;
  const total = meters.venuePlaceCount?.[venueId] || 0;
  const pct = total > 0 ? Math.min(100, (walked / total) * 100) : 0;
  if (pct >= 100) return null;
  const t = pct / 100;
  return {
    saturate: 0.55 + t * 0.45,
    brightness: 0.88 + t * 0.12,
  };
}
