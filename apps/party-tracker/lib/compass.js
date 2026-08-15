/**
 * Phone re-export of the shared Compass seam.
 * Prefer `@party-tracker/shared/compass.js` from packages; this path keeps
 * existing app-relative import habits.
 */
export {
  DEFAULT_WATCH_SETTINGS,
  WATCH_SETTINGS_KEY,
  buildCompassMarks,
  loadWatchSettings,
  mapRotationDegrees,
  normalizeWatchSettings,
  placeKeyOf,
  saveWatchSettings,
  watchAlwaysOnPayload,
} from '@party-tracker/shared/compass.js';
