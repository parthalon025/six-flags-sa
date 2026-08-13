/**
 * Location sharing helpers live in `lib/location.js` — the Location module.
 * This file re-exports the same names so older imports keep working.
 */
export {
  SHARE_MODES,
  DEFAULT_SHARE_MODE,
  PRECISE_MAX_MS,
  shouldShareLocation,
  isLocationVisible,
  effectiveShareMode,
  locationForShare,
  locationReadyToJoin,
  locationRevokedInParty,
  shareModePatch,
  coarsenLocation,
} from '../location.js';
