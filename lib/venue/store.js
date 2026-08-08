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

const LS_KEY = 'tracker-venue';

const state = {
  manifest: null,
  venue: null, // the manifest row for the active venue
  map: null, // drawn geometry
  pois: [], // places
  status: 'idle', // idle | loading | ready | error
  error: null,
  /** True once the visitor has chosen a venue by hand — stops auto-switching. */
  pinned: false,
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

/* --------------------------------------------------------------- loading - */

const savedChoice = () => {
  try {
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
};

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
    state.pois = pois;
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

export function pinVenue(id) {
  state.pinned = true;
  try {
    localStorage.setItem(LS_KEY, id);
  } catch {
    /* private mode: the choice just does not survive the session */
  }
  emit();
}

/**
 * Boot: the venue chosen last time, else the deployment's default. The GPS fix
 * has not landed yet at this point, so this is deliberately not clever — it
 * gets something on screen, and `retargetForPosition` corrects it if the first
 * fix says we are standing somewhere else.
 */
export async function bootVenue() {
  const manifest = await loadManifest();
  const saved = savedChoice();
  if (saved && manifest.venues.some((v) => v.id === saved)) state.pinned = true;
  return selectVenue(saved || manifest.default || manifest.venues[0]?.id);
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
