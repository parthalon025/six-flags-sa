/**
 * When a party member's GPS may be shared. Canonical, and pure.
 *
 * A fix outside the loaded venue's bounds is not broadcast and is not drawn on
 * other phones — someone at home or in a hotel should not appear on the party
 * map. The check runs at capture time on the sharing phone and again at display
 * time on every viewer, so a position that never left the wire cannot be shown
 * even if the bounds check on the sender was skipped.
 */

import { withinBounds } from '../venue/store.js';

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
