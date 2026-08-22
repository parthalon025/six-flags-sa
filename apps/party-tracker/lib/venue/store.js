/* The active venue.
 *
 * The map was drawn for one park; everything about drawing it was already
 * general. This module is what makes that generality reachable at runtime: it
 * holds the manifest of venues the deployment ships with, the one currently
 * loaded, and the geometry and places that go with it.
 *
 * It is a plain store rather than React state because loading a venue is not a
 * render: the boot sequence, the GPS retarget and the picker all drive it from
 * outside React, and components read the result through useVenue().
 */

/* Relative and with the extension: the unit suite imports this module straight
   into bare node, where the bundler's '@/…' alias does not exist. */
import { distance } from '../geo.js';
import { withIds } from './ids.js';
import { AnalyticsEvents } from '../analytics.js';

/** A venue picked by hand, in the picker. Hard: nothing moves the map after it. */
const LS_KEY = 'tracker-venue';
/** The venue the visitor said yes to on the way in. Soft: the party still wins. */
const LS_CONFIRMED = 'tracker-venue-confirmed';
/* The venue that was last actually on screen, whether or not anybody chose it.
   This is the "last" half of "nearest or last": it is what the app opens on
   before the GPS has answered, so a phone that was at a park yesterday opens on
   that park today instead of on whichever venue happens to be first in the
   manifest. */
const LS_LAST = 'tracker-venue-last';

const state = {
  manifest: null,
  venue: null, // the manifest row for the active venue
  map: null, // drawn geometry
  pois: [], // places
  gaps: [], // builder-shipped Gaps; empty if the file is missing
  status: 'idle', // idle | loading | ready | error
  error: null,
  /** True once the visitor has chosen a venue by hand — stops auto-switching. */
  pinned: false,
  /** The venue id answered at intake, if any — so the question is asked once. */
  confirmed: null,
  /* Whether this phone had a venue of its own to open on. False means a first
     run, and a first run is the one case where a fix outside every venue should
     still move the map: there is nothing to overrule. */
  remembered: false,
};

let snapshot = { ...state };
const listeners = new Set();

function emit() {
  snapshot = { ...state };
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* a bad subscriber must not take the map down */
    }
  });
}

export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const getSnapshot = () => snapshot;


/* --------------------------------------------------------------- picking - */

export function withinBounds(bounds, lat, lng) {
  if (!bounds || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat < bounds.north && lat > bounds.south && lng < bounds.east && lng > bounds.west;
}

/** Cheap metres-ish comparison — only ever used to rank, never to display. */
function roughDistance(aLat, aLng, bLat, bLng) {
  const dLat = (bLat - aLat) * 111320;
  const dLng = (bLng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * Which venue a position belongs to. Containment wins over proximity, because
 * two parks in one city have centres that are further away than their edges.
 */
export function venueForPosition(manifest, lat, lng) {
  const venues = manifest?.venues || [];
  if (!venues.length || !Number.isFinite(lat)) return null;
  const inside = venues.filter((v) => withinBounds(v.bounds, lat, lng));
  const pool = inside.length ? inside : venues;
  let best = null;
  for (const v of pool) {
    const d = roughDistance(lat, lng, v.center.lat, v.center.lng);
    if (!best || d < best.d) best = { v, d };
  }
  return best ? { venue: best.v, metres: best.d, inside: inside.includes(best.v) } : null;
}

/**
 * Every venue this build ships, nearest first, with the one you are standing
 * inside promoted above everything else. The intake shows the head of this list
 * as the question and the tail as the answer if the question is wrong.
 *
 * Distances here are haversine rather than the rough ranking metric, because
 * these ones are read out: "412 mi away" is the reason someone taps a different
 * row, so it has to be true at the scale of a drive as well as a walk.
 */
export function venuesByDistance(manifest, lat, lng) {
  const venues = manifest?.venues || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return venues.map((venue) => ({ venue, metres: null, inside: false }));
  }
  return venues
    .map((venue) => ({
      venue,
      metres: distance(lat, lng, venue.center.lat, venue.center.lng),
      inside: withinBounds(venue.bounds, lat, lng),
    }))
    .sort((a, b) => Number(b.inside) - Number(a.inside) || a.metres - b.metres);
}

/**
 * The venue the intake should ask about, or null if there is nothing to ask.
 *
 * Nothing to ask means one of two things: the visitor already picked a map by
 * hand, which outranks anything a fix could suggest, or they already said yes
 * to this park and have not since turned up inside a different one. Walking
 * into another park is worth a question; being at home, one state over from the
 * park you said you were going to, is not.
 */
export function venueChoiceFor(manifest, lat, lng, { confirmed = null, pinned = false } = {}) {
  if (pinned) return null;
  const hit = venueForPosition(manifest, lat, lng);
  if (!hit) return null;
  if (confirmed && (hit.venue.id === confirmed || !hit.inside)) return null;
  return hit;
}

/**
 * The park the intake should ask about — with or without a GPS fix.
 *
 * With a fix, this is `venueChoiceFor`. Without one, a visitor who has not
 * yet answered still needs to pick a park: otherwise the app opens on whatever
 * placeholder booted and the map looks empty until they stumble into Me →
 * Which map. The explore flag tells the prompt to ask openly rather than guess
 * from distance.
 */
export function intakeChoiceFor(manifest, lat, lng, { confirmed = null, pinned = false } = {}) {
  if (pinned) return null;
  const hasFix = Number.isFinite(lat) && Number.isFinite(lng);
  if (hasFix) {
    const hit = venueChoiceFor(manifest, lat, lng, { confirmed, pinned });
    return hit ? { ...hit, explore: false } : null;
  }
  if (confirmed) return null;
  const rows = venuesByDistance(manifest, null, null);
  const venue =
    rows.find((r) => r.venue.id === manifest?.default)?.venue ||
    rows[0]?.venue ||
    manifest?.venues?.[0];
  if (!venue) return null;
  return { venue, metres: null, inside: false, explore: true };
}

/* --------------------------------------------------------------- loading - */

const readLocal = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const savedChoice = () => readLocal(LS_KEY);
const savedConfirmation = () => readLocal(LS_CONFIRMED);

/**
 * True when boot should refetch venue files past the HTTP/SW cache.
 *
 * Online used to force `cache: 'no-store'`, which defeated the service worker
 * and re-downloaded ~100KB+ of map JSON on every park-wifi launch. Deploys
 * invalidate via a new SW cache name; keep the boolean override for tests and
 * an explicit "refresh map" path.
 */
export function shouldRefreshVenueAtBoot(online) {
  if (typeof online === 'boolean') return online;
  return false;
}

export function venueFetchInit(refresh) {
  return refresh ? { cache: 'no-store' } : {};
}

async function fetchJson(url, { refresh = false } = {}) {
  const res = await fetch(url, venueFetchInit(refresh));
  if (!res.ok) throw new Error('Could not download that park\u2019s map.');
  return res.json();
}

/** Missing Gaps must not fail venue load — 404 / network → null. */
async function fetchOptionalJson(url, { refresh = false } = {}) {
  try {
    const res = await fetch(url, venueFetchInit(refresh));
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

const SHIPPED_GAP_TYPES = new Set(['height', 'queue', 'path', 'path_disputed', 'restroom', 'food', 'gate', 'camping']);

export function gapsUrlFor(venue) {
  if (venue?.gaps) return venue.gaps;
  if (venue?.id) return `/venues/${venue.id}.gaps.json`;
  return null;
}

/** Phone-safe Gap list. Unknown types and a missing document are []. */
export function normalizeGapsDocument(data) {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.gaps) ? data.gaps : [];
  return rows.filter(
    (g) => g && typeof g.type === 'string' && SHIPPED_GAP_TYPES.has(g.type) && (g.target == null || typeof g.target === 'string'),
  ).map((g) => ({ type: g.type, target: g.target ?? null }));
}

export async function loadManifest({ refresh = false } = {}) {
  if (state.manifest && !refresh) return state.manifest;
  try {
    const manifest = await fetchJson('/venues/manifest.json', { refresh });
    state.manifest = manifest;
    emit();
    return manifest;
  } catch (err) {
    if (state.manifest) return state.manifest;
    throw err;
  }
}

/**
 * Load a venue's geometry, places, and Gaps and make it active. Files are
 * fetched, not imported, which is the whole point: a venue added to the
 * manifest is available to a phone that already has the app installed.
 * A missing Gaps file is an empty list — it must not fail the park load.
 */
export async function selectVenue(id, { pin = false, refresh = false } = {}) {
  const manifest = await loadManifest({ refresh });
  const venue = manifest.venues.find((v) => v.id === id) || manifest.venues[0];
  if (!venue) throw new Error('This build ships no venues. Run npm run venues:build.');
  const already = state.venue?.id === venue.id && state.status === 'ready';
  if (already && !refresh) {
    if (pin) pinVenue(venue.id);
    return venue;
  }

  const previous =
    state.status === 'ready'
      ? { venue: state.venue, map: state.map, pois: state.pois, gaps: state.gaps }
      : null;

  if (!already) {
    state.status = 'loading';
    state.error = null;
    emit();
  }
  try {
    const gapsUrl = gapsUrlFor(venue);
    const [map, pois, gapsDoc] = await Promise.all([
      fetchJson(venue.map, { refresh }),
      fetchJson(venue.pois, { refresh }),
      gapsUrl ? fetchOptionalJson(gapsUrl, { refresh }) : Promise.resolve(null),
    ]);
    state.venue = venue;
    state.map = map;
    // Ids are attached here rather than left to each reader: a ride report is
    // addressed by id and crosses to other phones and to the host, so the
    // browser has to number a venue's repeats exactly the way they do.
    state.pois = withIds(pois);
    state.gaps = normalizeGapsDocument(gapsDoc);
    state.status = 'ready';
    state.error = null;
    emit();
    // Whatever ends up on screen is what this phone opens on next time, chosen
    // or not. Written here rather than at the call sites so no future way of
    // loading a venue can forget to.
    try {
      localStorage.setItem(LS_LAST, venue.id);
    } catch {
      /* private mode, or a browser with storage switched off */
    }
    if (pin) pinVenue(venue.id);
    AnalyticsEvents.venueLoaded(venue.id);
    return venue;
  } catch (err) {
    if (previous) {
      state.venue = previous.venue;
      state.map = previous.map;
      state.pois = previous.pois;
      state.gaps = previous.gaps || [];
      state.status = 'ready';
      state.error = null;
      emit();
      if (pin) pinVenue(previous.venue.id);
      return previous.venue;
    }
    state.status = 'error';
    state.error = err?.message || 'Could not load that venue.';
    emit();
    throw err;
  }
}

/**
 * Let go of a hand-picked map.
 *
 * Picking a venue pins it, permanently and on purpose — but there was no way
 * back from the UI, so a visitor who tapped the wrong park once had an app that
 * would never follow their party again and nothing on any screen to undo it.
 */
export function unpinVenue() {
  state.pinned = false;
  state.confirmed = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* private mode: nothing was stored to remove */
  }
  emit();
}

export function pinVenue(id) {
  state.pinned = true;
  state.confirmed = id;
  state.remembered = true;
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* private mode: the choice just does not survive the session */
  }
  emit();
}

/**
 * "Yes, I am going to this park" — the intake's answer.
 *
 * Softer than the picker: it loads the park's geometry and places, remembers
 * the park so the next launch opens on it, and stops the intake asking again.
 * What it deliberately does not do is pin. Someone who says yes to Kings Island
 * from the car park and then joins a party being hosted from inside Kings
 * Island has answered the same question twice; someone who says yes and then
 * joins a party at a different park is telling us the party is the better
 * answer, and the map should follow it.
 */
export async function confirmVenue(id) {
  const venue = await selectVenue(id);
  state.confirmed = venue.id;
  // An answer is an answer: from here a fix out in the country stops moving
  // the map on its own.
  state.remembered = true;
  try {
    localStorage.setItem(LS_CONFIRMED, venue.id);
  } catch {
    /* private mode: the question comes back next launch, which is survivable */
  }
  emit();
  return venue;
}

/**
 * Boot: the last venue this phone had on screen — picked by hand, said yes to,
 * or simply the one it was looking at.
 *
 * When the phone is online, boot refetches the manifest and venue JSON past
 * the HTTP cache so a new Place or bound lands without waiting for a new
 * install. Offline keeps the last good map.
 *
 * The GPS fix has not landed at this point, so this is deliberately not clever.
 * It answers "last"; `retargetForPosition` answers "nearest" a second later,
 * and between them there is no venue this deployment prefers. The manifest's
 * `default` is only what a phone that has never opened the app looks at for the
 * two seconds before its first fix arrives — it is a placeholder, not an
 * opinion about where anybody is. Treating it as an opinion is how a visitor in
 * San Antonio opened the app and was shown a park in Ohio.
 */
export async function bootVenue() {
  const refresh = shouldRefreshVenueAtBoot();
  const manifest = await loadManifest({ refresh });
  const has = (id) => Boolean(id) && manifest.venues.some((v) => v.id === id);
  const picked = savedChoice();
  const confirmed = savedConfirmation();
  const last = readLocal(LS_LAST);
  if (has(picked)) state.pinned = true;
  if (has(confirmed)) state.confirmed = confirmed;
  state.remembered = has(picked) || has(confirmed) || has(last);
  return selectVenue(
    (has(picked) && picked) ||
      (has(confirmed) && confirmed) ||
      (has(last) && last) ||
      manifest.default ||
      manifest.venues[0]?.id,
    { refresh },
  );
}

/**
 * Once a fix lands, move to the venue it belongs to — unless the visitor has
 * chosen one by hand, in which case they meant it. Returns the venue if it
 * switched, so the caller can say so.
 *
 * Standing inside a venue always moves the map: walking into a park is not
 * ambiguous. Standing outside every one of them moves it only on a phone that
 * has never had a venue of its own, and then it moves to the nearest — which
 * is the whole of "nearest or last" in one sentence. A phone that has been to a
 * park keeps that park until it is somewhere else's grounds, because "nearest"
 * measured from a sofa two hundred miles from anywhere is not information.
 */
export async function retargetForPosition(lat, lng) {
  if (state.pinned || !state.manifest) return null;
  const hit = venueForPosition(state.manifest, lat, lng);
  if (!hit || hit.venue.id === state.venue?.id) return null;
  if (!hit.inside && state.remembered) return null;
  await selectVenue(hit.venue.id);
  // From here on this phone has an answer of its own, so a later fix out in the
  // country cannot drag it somewhere else.
  state.remembered = true;
  return hit.venue;
}
