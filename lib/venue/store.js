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

/** A venue picked by hand, in the picker. Hard: nothing moves the map after it. */
const LS_KEY = 'tracker-venue';
/** The venue the visitor said yes to on the way in. Soft: the party still wins. */
const LS_CONFIRMED = 'tracker-venue-confirmed';

const state = {
  manifest: null,
  venue: null, // the manifest row for the active venue
  map: null, // drawn geometry
  pois: [], // places
  status: 'idle', // idle | loading | ready | error
  error: null,
  /** True once the visitor has chosen a venue by hand — stops auto-switching. */
  pinned: false,
  /** The venue id answered at intake, if any — so the question is asked once. */
  confirmed: null,
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

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

export async function loadManifest() {
  if (state.manifest) return state.manifest;
  const manifest = await fetchJson('/venues/manifest.json');
  state.manifest = manifest;
  emit();
  return manifest;
}

/**
 * Load a venue's geometry and places and make it active. Both files are
 * fetched, not imported, which is the whole point: a venue added to the
 * manifest is available to a phone that already has the app installed.
 */
export async function selectVenue(id, { pin = false } = {}) {
  const manifest = await loadManifest();
  const venue = manifest.venues.find((v) => v.id === id) || manifest.venues[0];
  if (!venue) throw new Error('This build ships no venues. Run npm run venues:build.');
  if (state.venue?.id === venue.id && state.status === 'ready') {
    if (pin) pinVenue(venue.id);
    return venue;
  }

  state.status = 'loading';
  state.error = null;
  emit();
  try {
    const [map, pois] = await Promise.all([fetchJson(venue.map), fetchJson(venue.pois)]);
    state.venue = venue;
    state.map = map;
    // Ids are attached here rather than left to each reader: a ride report is
    // addressed by id and crosses to other phones and to the host, so the
    // browser has to number a venue's repeats exactly the way they do.
    state.pois = withIds(pois);
    state.status = 'ready';
    emit();
    if (pin) pinVenue(venue.id);
    return venue;
  } catch (err) {
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
  try {
    localStorage.setItem(LS_CONFIRMED, venue.id);
  } catch {
    /* private mode: the question comes back next launch, which is survivable */
  }
  emit();
  return venue;
}

/**
 * Boot: the venue picked last time, else the one said yes to last time, else
 * the deployment's default. The GPS fix has not landed yet at this point, so
 * this is deliberately not clever — it gets something on screen, and the intake
 * question (or `retargetForPosition`) corrects it once there is a fix to
 * correct it with.
 */
export async function bootVenue() {
  const manifest = await loadManifest();
  const has = (id) => Boolean(id) && manifest.venues.some((v) => v.id === id);
  const picked = savedChoice();
  const confirmed = savedConfirmation();
  if (has(picked)) state.pinned = true;
  if (has(confirmed)) state.confirmed = confirmed;
  return selectVenue(
    (has(picked) && picked) ||
      (has(confirmed) && confirmed) ||
      manifest.default ||
      manifest.venues[0]?.id,
  );
}

/**
 * Once a fix lands, move to the venue it falls inside — unless the visitor has
 * chosen one by hand, in which case they meant it. Returns the venue if it
 * switched, so the caller can say so.
 */
export async function retargetForPosition(lat, lng) {
  if (state.pinned || !state.manifest) return null;
  const hit = venueForPosition(state.manifest, lat, lng);
  if (!hit?.inside || hit.venue.id === state.venue?.id) return null;
  await selectVenue(hit.venue.id);
  return hit.venue;
}
