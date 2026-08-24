'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getSnapshot, placesAsShippedForResearchOnly, subscribe } from './store';

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

/**
 * Shipped Places for the guest ground-truth research lane — the one reader on
 * this phone that must not see the Overlay, because it measures guests against
 * what the *builder* shipped and uploads the delta as evidence about that pin.
 * Painting it with this phone's Contributions would feed the map-improvement
 * loop its own output back as independent confirmation. The failure is spelled
 * out at `placesAsShippedForResearchOnly` in lib/venue/store.js.
 *
 * Subscribed rather than read straight off the module during render: the lane
 * files every observation under the venue that was active when it was taken, so
 * a torn read would measure a guest at one park against another park's pins.
 *
 * Anything that draws wants `usePois()`.
 */
export function usePlacesAsShippedForResearchOnly() {
  return useSyncExternalStore(
    subscribe,
    placesAsShippedForResearchOnly,
    placesAsShippedForResearchOnly,
  );
}
