/**
 * When a party member's GPS may be shared. Canonical, and pure.
 *
 * A fix outside the loaded venue's bounds is not broadcast and is not drawn on
 * other phones — someone at home or in a hotel should not appear on the party
 * map. The check runs at capture time on the sharing phone and again at display
 * time on every viewer, so a position that never left the wire cannot be shown
 * even if the bounds check on the sender was skipped.
 *
 * E4.1 precision: off | approx (~50 m) | precise. Duration timers auto-revert
 * to the safe default (approx) when they expire — never stay precise forever.
 */

import { withinBounds } from '../venue/store.js';
import { coarsenLocation } from '../core/state.js';

export const SHARE_MODES = Object.freeze(['off', 'approx', 'precise']);
/** Safe default while in a party — family can find you without raw GPS. */
export const DEFAULT_SHARE_MODE = 'approx';
/** Precise sharing never lasts longer than this unless renewed. */
export const PRECISE_MAX_MS = 30 * 60 * 1000;

/**
 * @returns {boolean} true when a fix at (lat, lng) may be sent to the party.
 * When bounds are not loaded yet, sharing is allowed so a first fix is not
 * dropped during venue load; once bounds exist, only in-park fixes pass.
 */
export function shouldShareLocation(bounds, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!bounds) return true;
  return withinBounds(bounds, lat, lng);
}

/** Whether another member's last fix should appear on the map or roster. */
export function isLocationVisible(bounds, lat, lng) {
  return shouldShareLocation(bounds, lat, lng);
}

/**
 * Resolve effective share mode for a member at `now`.
 * `sharingPaused` remains the legacy off switch.
 */
export function effectiveShareMode(member, now = Date.now()) {
  if (!member) return 'off';
  if (member.sharingPaused) return 'off';
  let mode = SHARE_MODES.includes(member.shareMode) ? member.shareMode : DEFAULT_SHARE_MODE;
  if (member.shareUntil && now >= member.shareUntil) {
    // Duration expired — drop precise back to approx; off stays off.
    if (mode === 'precise') mode = DEFAULT_SHARE_MODE;
  }
  return mode;
}

/**
 * Shape a fix for the wire under the chosen mode. Returns null for off.
 */
export function locationForShare(loc, mode) {
  if (!loc || mode === 'off') return null;
  if (mode === 'precise') return { ...loc };
  return coarsenLocation(loc);
}

/**
 * Build a share-mode patch. Precise always gets a duration (capped).
 * @param {'off'|'approx'|'precise'} mode
 * @param {{ durationMs?: number, now?: number }} [opts]
 */
export function shareModePatch(mode, { durationMs = PRECISE_MAX_MS, now = Date.now() } = {}) {
  const next = SHARE_MODES.includes(mode) ? mode : DEFAULT_SHARE_MODE;
  const patch = {
    shareMode: next,
    sharingPaused: next === 'off',
    shareUntil: null,
  };
  if (next === 'precise') {
    const ms = Math.min(Math.max(durationMs || PRECISE_MAX_MS, 60_000), PRECISE_MAX_MS);
    patch.shareUntil = now + ms;
  }
  return patch;
}
