'use client';

import { useSyncExternalStore } from 'react';
import { getSnapshot, subscribe } from './store';

/** The whole venue snapshot: {manifest, venue, map, pois, status, error, pinned}. */
export function useVenue() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function usePois() {
  return useVenue().pois;
}
