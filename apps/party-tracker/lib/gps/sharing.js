/**
 * When a party member's GPS may be shared. Canonical, and pure.
 *
 * A fix outside the loaded venue's bounds is not broadcast as live Location.
 * Last-known and the in-bounds trail stay visible to the Party and are marked
 * stale. The live check runs at capture time on the sharing phone.
 *
 * E4.1 precision: approx (~50 m) | precise. Duration timers auto-revert
 * to the safe default (approx) when they expire — never stay precise forever.
 * Location is mandatory; there is no off / pause mode.
 */

import { withinBounds } from '../venue/store.js';
import { coarsenLocation } from '../core/state.js';

export const SHARE_MODES = Object.freeze(['approx', 'precise']);
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

/** Last-known is visible to the Party whenever we have a pin. */
export function isLocationVisible(_bounds, lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/**
 * Resolve effective share mode for a member at `now`.
 * Location is mandatory — unknown/expired precise falls back to approx.
 */
export function effectiveShareMode(member, now = Date.now()) {
  if (!member) return DEFAULT_SHARE_MODE;
  let mode = SHARE_MODES.includes(member.shareMode) ? member.shareMode : DEFAULT_SHARE_MODE;
  if (member.shareUntil && now >= member.shareUntil) {
    if (mode === 'precise') mode = DEFAULT_SHARE_MODE;
  }
  return mode;
}

/**
 * Shape a fix for the wire under the chosen mode.
 */
export function locationForShare(loc, mode) {
  if (!loc) return null;
  if (mode === 'precise') return { ...loc };
  return coarsenLocation(loc);
}

/**
 * Join does not finish without Location — a live GPS fix or a manual pin.
 */
export function locationReadyToJoin(status) {
  return status === 'live' || status === 'manual';
}

/**
 * After join, OS revoke: stay a Member, drop the live dot, wall to turn it
 * back on. Not an eject and not a silent pause.
 */
export function locationRevokedInParty(status) {
  return status === 'denied' || status === 'unsupported' || status === 'insecure';
}

/**
 * Build a share-mode patch. Precise always gets a duration (capped).
 * `off` is ignored — Location is mandatory.
 * @param {'approx'|'precise'|string} mode
 * @param {{ durationMs?: number, now?: number }} [opts]
 */
export function shareModePatch(mode, { durationMs = PRECISE_MAX_MS, now = Date.now() } = {}) {
  const next = SHARE_MODES.includes(mode) ? mode : DEFAULT_SHARE_MODE;
  const patch = {
    shareMode: next,
    shareUntil: null,
  };
  if (next === 'precise') {
    const ms = Math.min(Math.max(durationMs || PRECISE_MAX_MS, 60_000), PRECISE_MAX_MS);
    patch.shareUntil = now + ms;
  }
  return patch;
}
