/**
 * Location — Party situational awareness.
 *
 * Callers pass a capture and Venue facts. This module decides live vs stale,
 * approx/precise coarsening, the in-bounds trail, and one Place name.
 * Pause / off is not a product fact. Place travels with Location; phones
 * do not each guess.
 *
 * Relative `.js` imports so the unit suite can load this in plain Node.
 */

import { distance } from './geo.js';

function inBounds(bounds, lat, lng) {
  if (!bounds || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat < bounds.north && lat > bounds.south && lng < bounds.east && lng > bounds.west;
}

/** At a Place slot — not walking past on the midway. */
export const AT_PLACE_M = 35;
/** Last-known dots kept on a Member for the family trail. */
export const TRAIL_MAX = 24;

export const SHARE_MODES = Object.freeze(['approx', 'precise']);
/** Safe default while in a party — family can find you without raw GPS. */
export const DEFAULT_SHARE_MODE = 'approx';
/** Precise sharing never lasts longer than this unless renewed. */
export const PRECISE_MAX_MS = 30 * 60 * 1000;

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

function pinFrom(loc) {
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return null;
  return loc;
}

/** Coarsen a fix before it leaves the phone (~50 m grid). */
export function coarsenLocation(loc, metres = 50) {
  if (!loc) return loc;
  const latStep = metres / 110540;
  const lngStep = metres / (111320 * Math.cos(loc.lat * (Math.PI / 180)));
  return {
    ...loc,
    lat: Math.round(loc.lat / latStep) * latStep,
    lng: Math.round(loc.lng / lngStep) * lngStep,
  };
}

/**
 * @returns {boolean} true when a fix at (lat, lng) may be sent as live Location.
 * When bounds are not loaded yet, sharing is allowed so a first fix is not
 * dropped during venue load; once bounds exist, only in-park fixes pass.
 */
export function shouldShareLocation(bounds, lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!bounds) return true;
  return inBounds(bounds, lat, lng);
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
 * Resolve effective share mode for a member at `now`.
 * Location is mandatory — unknown/expired precise falls back to approx.
 * `off` and pause are not modes.
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
 * `off` / unknown is ignored — Location is mandatory approx.
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

/**
 * Append a crumb only for live Location. Stale last-known does not grow the
 * trail — the trail is the in-bounds path; the Place name stays on the pin.
 */
export function nextTrail(trail, loc) {
  const prev = Array.isArray(trail) ? trail : [];
  if (!loc || loc.live === false) return prev;
  if (!Number.isFinite(loc.lat) || !Number.isFinite(loc.lng)) return prev;
  return [...prev, loc].slice(-TRAIL_MAX);
}

function staleFrom(last, places, now) {
  const pin = pinFrom(last);
  if (!pin) return null;
  if (pin.live === false) return null;
  return {
    location: attachPlace(
      {
        lat: pin.lat,
        lng: pin.lng,
        acc: pin.acc ?? null,
        heading: Number.isFinite(pin.heading) ? pin.heading : null,
        speed: null,
        ts: now,
        live: false,
        place: pin.place,
      },
      places,
    ),
  };
}

/**
 * Shape a capture for the Party. Callers pass a fix and Venue facts — they
 * do not decide live vs stale, coarsening, or Place.
 *
 * Out of bounds or OS revoke: last-known marked stale, sent once. No wipe.
 * In bounds: Place stamped on the raw fix, then coarsened for the wire.
 *
 * @param {{
 *   fix?: { lat: number, lng: number, acc?: number, heading?: number, speed?: number, ts?: number },
 *   bounds?: object | null,
 *   places?: object[],
 *   member?: object | null,
 *   last?: object | null,
 *   now?: number,
 *   revoked?: boolean,
 * }} [facts]
 * @returns {{ location: object } | null}
 */
export function capture(facts = {}) {
  const {
    fix = null,
    bounds = null,
    places = [],
    member = null,
    last = null,
    now = Date.now(),
    revoked = false,
  } = facts;

  if (revoked) return staleFrom(last, places, now);

  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return null;

  const inside = shouldShareLocation(bounds, fix.lat, fix.lng);
  if (!inside) return staleFrom(last, places, now);

  const raw = {
    lat: fix.lat,
    lng: fix.lng,
    acc: fix.acc ?? null,
    heading: Number.isFinite(fix.heading) ? fix.heading : null,
    speed: Number.isFinite(fix.speed) ? fix.speed : null,
    ts: Number.isFinite(fix.ts) ? fix.ts : now,
    live: true,
  };
  const stamped = attachPlace(raw, places);
  const mode = effectiveShareMode(member, now);
  return { location: locationForShare(stamped, mode) };
}

/**
 * What the Party sees for one Member on the map / roster.
 * Callers pass the Member record and Venue bounds — they do not recompute live.
 */
export function view(member, bounds) {
  const loc = member?.location;
  const lat = loc?.lat;
  const lng = loc?.lng;
  const visible = isLocationVisible(bounds, lat, lng);
  const live = Boolean(visible && loc?.live !== false && isLocationLive(bounds, lat, lng));
  const place = loc?.place || null;
  return { visible, live, place, lat, lng };
}
