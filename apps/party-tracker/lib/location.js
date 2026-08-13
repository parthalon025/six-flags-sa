/**
 * Location — Party situational awareness.
 *
 * Callers pass a fix and Venue places. This module decides what the Party
 * sees: last-known stays, one Place name, no hedging. Place travels with
 * Location; phones do not each guess.
 *
 * Relative `.js` imports so the unit suite can load this in plain Node.
 */

import { distance } from './geo.js';
import { shouldShareLocation } from './gps/sharing.js';

/** At a Place slot — not walking past on the midway. */
export const AT_PLACE_M = 35;

const SKIP = new Set(['parking', 'gate', 'campsite']);

function recognizability(place) {
  const c = place?.c;
  if (c === 'coaster' || c === 'ride' || c === 'show') return 3;
  if (c === 'food' || c === 'drink') return 2;
  if (c === 'restroom') return 1;
  return 0;
}

function slotsOf(place) {
  const out = [];
  if (Number.isFinite(place?.lat) && Number.isFinite(place?.lng)) {
    out.push({ lat: place.lat, lng: place.lng });
  }
  for (const key of ['queue', 'station', 'queue_entrance', 'ride_entrance']) {
    const slot = place?.[key];
    if (slot && Number.isFinite(slot.lat) && Number.isFinite(slot.lng)) {
      out.push({ lat: slot.lat, lng: slot.lng });
    }
  }
  return out;
}

function nearestSlotMetres(place, lat, lng) {
  let best = Infinity;
  for (const slot of slotsOf(place)) {
    const d = distance(lat, lng, slot.lat, slot.lng);
    if (d < best) best = d;
  }
  return best;
}

/** Last-known is visible to the Party whenever we have a pin. */
export function isLocationVisible(_bounds, lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng);
}

/** Live Location is only inside Venue bounds. */
export function isLocationLive(bounds, lat, lng) {
  return shouldShareLocation(bounds, lat, lng);
}

/**
 * One Place the Party should name, or null when walking past.
 * Never two names. Conflict: most recognizable. Equal Attractions: the slot
 * the body is in.
 */
export function placeAt(places, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Array.isArray(places)) return null;
  const hits = [];
  for (const place of places) {
    if (!place || SKIP.has(place.c)) continue;
    const d = nearestSlotMetres(place, lat, lng);
    if (d <= AT_PLACE_M) hits.push({ place, d, rank: recognizability(place) });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.rank - a.rank || a.d - b.d);
  const top = hits[0];
  const id = top.place.i || top.place.id || null;
  const name = top.place.n || top.place.name || null;
  if (!name) return null;
  return { id, name };
}

/** Stamp the Place on a fix so it travels with Location. */
export function attachPlace(loc, places) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return loc;
  const place = placeAt(places, loc.lat, loc.lng);
  if (!place) {
    if (loc.place == null) return loc;
    const next = { ...loc };
    delete next.place;
    return next;
  }
  return { ...loc, place };
}

/**
 * What the Party reads. No "most likely" / "probably" / "near".
 * Live at a Place: "Dad · Orion".
 * Stale at a Place: "last known location of Dad at Orion".
 */
export function locationCopy({ name, place, live } = {}) {
  const who = name || 'Member';
  const at = place?.name || null;
  if (live === false) {
    return at ? `last known location of ${who} at ${at}` : `last known location of ${who}`;
  }
  if (at) return `${who} · ${at}`;
  return null;
}
