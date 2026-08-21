'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';

/**
 * The whole venue snapshot:
 * {manifest, venue, map, pois, overlayPins, gaps, status, error, pinned}.
 *
 * `pois` is already Overlay-painted — see usePois below.
 */
export function useVenue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useVenueSelector(selector) {
  const get = useCallback(() => selector(getSnapshot()), [selector]);
  return useSyncExternalStore(subscribe, get, get);
}

/**
 * This World's Places, as this phone believes them — shipped Places with this
 * phone's Overlay already painted on, so a Contribution is visible to whoever
 * asks.
 *
 * This is the only way to get a World's Places, and that is the point. There
 * used to be a second one: app/page.js painted the Overlay and drilled the
 * result outward as props, so a screen saw Contributions if it took the props
 * and did not if it called this hook. Whether a Member's own Contribution
 * showed up came down to which door the panel's author happened to reach for.
 * See lib/venue/store.js for the failure that produced.
 */
export function usePois() {
  return useVenueSelector((s) => s.pois);
}
