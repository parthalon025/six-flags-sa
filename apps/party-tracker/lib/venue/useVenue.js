'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';

/** The whole venue snapshot: {manifest, venue, map, pois, status, error, pinned}. */
export function useVenue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useVenueSelector(selector) {
  const get = useCallback(() => selector(getSnapshot()), [selector]);
  return useSyncExternalStore(subscribe, get, get);
}

export function usePois() {
  return useVenueSelector((s) => s.pois);
}
