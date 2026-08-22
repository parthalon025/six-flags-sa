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
 *
 * ## One door to a World's Places
 *
 * `state.pois` is the Places *this phone believes in*: what the builder
 * shipped, numbered by `withIds`, and then painted with this phone's Overlay.
 * The shipped array is a module-private `shipped` below rather than a field on
 * the snapshot, so nothing that draws a World can reach it by destructuring one.
 *
 * There is exactly one exception, and it is not a screen: the guest
 * ground-truth research lane, whose question is about the builder rather than
 * about this phone. It is served by `placesAsShippedForResearchOnly()` — one
 * named export, off the snapshot, said out loud rather than left as a second
 * silent door. See that function for the failure it prevents.
 *
 * That is not tidiness, it is the fix for a shipped bug. Painting used to
 * happen once in app/page.js and be drilled outward as props, so a screen got
 * Contributions if it took its Places through those props and did not if it
 * called the store — and which door a panel used was an accident of how it was
 * written. HeightPanel called the store, so a Member who had just walked over
 * and photographed a ride's height sign watched the map redraw with the number
 * they had contributed while the eligibility tally beside it went on answering
 * from the shipped rule. Two screens, one phone, two answers about whether a
 * child could ride.
 *
 * Painting belongs here for the same reason `withIds` already does: it is a
 * once-only concern that every reader must see the same answer to. A caller
 * asks the store for Places and gets the truth this phone believes.
 */

/* Relative and with the extension: the unit suite imports this module straight
   into bare node, where the bundler's '@/…' alias does not exist. */
import { distance } from '../geo.js';
import { withIds } from './ids.js';
import { applyOverlayToPlaces, emptyOverlay } from '../overlay.js';
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
  /* Places as this phone believes them: shipped, numbered, Overlay painted on.
     Never the raw file — see the header. */
  pois: [],
  /* Overlay drawables that are not Places: contributed queue pins and path
     crumbs. They fall out of the same paint, so they are published from the
     same place rather than recomputed by whoever draws the map. */
  overlayPins: [],
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

/* The two inputs to painting, both module-private.
 *
 * `shipped` is the second door the store exists to close: publishing it would
 * let a future screen reach for unpainted Places again, and the bug that
 * produces is silent — the screen renders, it is just answering from a
 * different World than the map is. The one export that hands it out is named
 * after the lane allowed to have it, not after the data, so reaching for it is
 * a decision rather than a slip.
 *
 * `overlay` is private for the smaller reason that nothing outside needs it:
 * the app already holds the Overlay it pushed down (see setOverlay), so a copy
 * on the snapshot would be a second place to read the same fact and a second
 * place for it to go stale. The store keeps it only so a venue swap repaints
 * with the Overlay that is live at that moment rather than whatever was
 * current when the fetch started.
 */
let shipped = [];
let overlay = emptyOverlay();

/**
 * The Places this World shipped with, unpainted — for the guest ground-truth
 * research lane, and nothing else on this phone.
 *
 * That lane records how far a guest actually stood from the pin the *builder*
 * shipped and uploads the delta to /api/contributions/traces, where it is read
 * as independent evidence about whether that pin is in the right place. Paint
 * these with this phone's Overlay and a guest who has just dropped a queue pin
 * in a Side Quest gets measured against their own Contribution: the
 * map-improvement loop takes its own output back as confirmation of the truth
 * it shipped, agrees with itself, and drifts with nothing left to catch it.
 *
 * Deliberately not a field on the snapshot and deliberately not a hook a screen
 * meets while shopping for Places — `usePois()` is the one door for anything
 * that draws. It is also not a general "give me unpainted Places" API: it names
 * its one consumer because a second caller means the question has changed, and
 * that should have to be argued for rather than imported.
 */
export function placesAsShippedForResearchOnly() {
  return shipped;
}

let snapshot = { ...state };
const listeners = new Set();

/**
 * Recompute the painted Places from `shipped` + `overlay`.
 *
 * Pure with respect to the store's other fields and deliberately does not
 * `emit()`: every caller is already inside a state change that ends in one, and
 * a repaint that emitted on its own would publish a venue half-swapped — new
 * Places against the old geometry, for one render.
 */
function repaint() {
  const painted = applyOverlayToPlaces(shipped, overlay);
  state.pois = painted.places;
  state.overlayPins = painted.pins;
  /* painted.venueCamping is dropped on purpose: no screen reads a
     campground-wide hookup off the store, because the camping Contribution is
     already painted onto every campsite Place above. Publishing it would add a
     field every reader has to learn and nobody has to use. */
}

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


/* --------------------------------------------------------------- overlay - */

/** An Overlay with no drawn facts. Painting one is the identity function. */
const paintsNothing = (o) => !o || !Object.keys(o.drawn || {}).length;

/**
 * Hand the store the Overlay this phone should be drawing, and repaint Places.
 *
 * The store paints the Overlay but does not compose it. Composing means
 * unioning this phone's authored Contributions with the ones a Party's Host
 * has pushed out, and the Party is a live runtime that the venue store must
 * not know about — a module that loads map JSON has no business holding a
 * reference to the mesh, and giving it one would make the boot sequence
 * un-testable in bare node. So the app composes and pushes the answer down;
 * the store owns the once-only paint.
 *
 * Two guards, both about not republishing Places that would come out the same.
 *
 * Identity first: the caller derives the display Overlay with a memo, so an
 * unchanged Overlay arrives as the same object. Emitting anyway would hand
 * every subscriber a fresh `pois` array on every party heartbeat and re-render
 * the map for nothing.
 *
 * Then blankness, which is not a micro-optimisation — it is what keeps the app
 * hydratable. A phone with no Contributions still pushes an Overlay on mount,
 * and `emptyOverlay()` is a fresh object every time, so identity never catches
 * it. Repainting on that push swaps `state.pois` for an array with the same
 * contents and a new identity, and the emit lands while React is still
 * hydrating the tree that read the old one: React gives up on the server HTML
 * and regenerates the whole page (hydration error #418, three phones in the
 * functional suite). Painting nothing over nothing cannot change a Place, so
 * the store says nothing. Going blank → drawn, or drawn → blank (a Member
 * leaves a Party and the Host's Contributions go with them), both repaint.
 */
export function setOverlay(next) {
  const composed = next || emptyOverlay();
  if (composed === overlay) return;
  const wasBlank = paintsNothing(overlay);
  overlay = composed;
  if (wasBlank && paintsNothing(composed)) return;
  repaint();
  emit();
}


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

const SHIPPED_GAP_TYPES = new Set(['height', 'queue', 'path', 'restroom', 'food', 'gate', 'camping']);

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

  /* The rollback snapshot keeps `shipped`, not the painted `pois`: painting is
     derived, and a Contribution that lands while this fetch is in flight must
     survive the rollback. Restoring a painted array captured before it would
     silently un-draw a fact the visitor had just watched appear. */
  const previous =
    state.status === 'ready'
      ? { venue: state.venue, map: state.map, shipped, gaps: state.gaps }
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
    shipped = withIds(pois);
    // …and painted here for the same reason, one step later: every screen has
    // to be looking at the same World. See the module header.
    repaint();
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
      shipped = previous.shipped;
      repaint();
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
