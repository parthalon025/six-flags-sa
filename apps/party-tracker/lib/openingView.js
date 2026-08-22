/**
 * The opening view: a World opens showing the whole park, then flies to the
 * guest (slice h18, owner decision `openingView`).
 *
 * This is neither renderer's old behaviour, and that is the point. The SVG
 * viewer opened on the venue's declared `meta.center`; the ported path opened
 * on the geometric centre of the truth bounds. Those are 77 m to 291 m apart
 * across the shipped venues, and the day the renderer flipped, whichever one
 * lost would have been a silent regression on every venue's first paint. The
 * decision retires the argument instead of settling it: a World opens on *the
 * whole park* — its truth bounds framed into the glass, which is a box and so
 * chooses no centre at all — and then goes to wherever the guest is.
 *
 * The opening is a state machine rather than an effect because three things
 * have to be true at once and none survives being re-derived every frame:
 *
 *   **The flight happens once.** Fixes land every few seconds and each one is
 *   a fresh object. A camera re-derived from "where is the guest" on each of
 *   them would drag the map back the moment a guest looked anywhere else —
 *   which is the failure `cameraRequest` already refuses to have a fallback
 *   for, for exactly this reason.
 *
 *   **The whole park is actually shown.** A phone with a warm fix knows where
 *   the guest is before the first frame, so an opening that flew immediately
 *   would show the park for no frames at all. The park is held for
 *   `OPENING_HOLD_MS`, and while it is held nothing else may move the camera:
 *   Follow is switched on at boot for a guest standing inside the park, and a
 *   Follow that fired during the hold would slide the park off the glass
 *   before the flight ever started.
 *
 *   **The map never becomes unmovable.** That hold is the dangerous half. A
 *   guest whose GPS is refused, or who is at home looking at a park two states
 *   away, has no fix to fly to — and an opening that waited for one while
 *   still holding the camera would leave them unable to pan, tap a Place or
 *   preview a route for the rest of the session. So the hold expires on its
 *   own into `OPENING_WAITING`: the whole park is still on screen and the
 *   first usable fix will still fly, but the camera belongs to everyone again.
 *
 * Nothing here reads a clock, draws, or projects. `elapsedMs` is an argument
 * for the same reason `overlayGeo.js` takes a `now`: a function that timed
 * itself could not be handed a known answer.
 */

import { bandResolution } from '@party-tracker/shared/zoomBands.js';
import { withinBounds } from './venue/store.js';

/** Showing the whole park, and holding the camera while it does. */
export const OPENING_PARK = 'park';
/** The hold is over and no guest has turned up here yet. The whole park is
 *  still on screen; the camera is no longer the opening's. */
export const OPENING_WAITING = 'waiting';
/** Over, having gone to the guest. */
export const OPENING_GUEST = 'guest';
/** Over, because something else took the camera first. */
export const OPENING_KEPT = 'kept';

/** How long the whole park is held before the flight.
 *
 *  Long enough to be a view rather than a flicker, short enough that a guest
 *  who opened the app to find themselves is not kept waiting. */
export const OPENING_HOLD_MS = 900;

/** The flight, in milliseconds. Longer than Follow's `FOLLOW_EASE_MS` on
 *  purpose: Follow is a correction nobody should notice, and this is the one
 *  camera move that is meant to be watched — it is what tells a guest where in
 *  the park they are standing. */
export const OPENING_EASE_MS = 1200;

/** Where the flight stops, in ground metres per pixel.
 *
 *  The mid Zoom band's own resolution, read off the band table rather than
 *  chosen here. Mid is the band that ships inside the venue pack (ADR-0021
 *  clauses 2 and 5), so the view a World opens into is the one that is painted
 *  with no network at all. */
export const OPENING_RESOLUTION = bandResolution('mid');

/** Where every World starts: the whole park, and no camera request.
 *
 *  `camera: null` is load-bearing. The whole-park view comes from framing the
 *  World's bounds at mount, which is a box; the moment this carried a centre
 *  the opening would be picking one of the two points the decision retired. */
export const OPENING_START = Object.freeze({ phase: OPENING_PARK, camera: null });

/** Is the opening still going to fly, given the chance? */
export function openingRunning(state) {
  return state?.phase === OPENING_PARK || state?.phase === OPENING_WAITING;
}

/** Is the opening holding the camera against every other request?
 *
 *  Only during the hold, and the hold expires whatever else happens — see the
 *  third bullet of this file's header for why that bound is the important part
 *  rather than a detail. */
export function openingHoldsCamera(state) {
  return state?.phase === OPENING_PARK;
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

const WAITING = Object.freeze({ phase: OPENING_WAITING, camera: null });
const KEPT = Object.freeze({ phase: OPENING_KEPT, camera: null });

/**
 * The opening, one step on.
 *
 * Returns the state it was handed — the same object, not an equal one — when
 * nothing has changed, so a React caller's own bail-out ends the loop instead
 * of re-rendering on every fix for the rest of the session.
 *
 * @param {{phase: string, camera: object|null}} state
 * @param {object} input
 * @param {{west,south,east,north}} input.bounds the World's truth bounds —
 *   what decides whether this fix is a guest *at this park*.
 * @param {{lat: number, lng: number}|null} [input.anchor] where the guest is.
 * @param {boolean} [input.cameraTaken] has something else claimed the camera —
 *   a hand on the glass, a Place the guest tapped, a route being previewed?
 *   Follow is deliberately not one of those: it chases the very point the
 *   flight is going to, so it is not a competing answer.
 * @param {number} input.elapsedMs how long the park has been on screen.
 */
export function advanceOpening(
  state,
  { bounds, anchor = null, cameraTaken = false, elapsedMs } = {},
) {
  if (!finite(elapsedMs)) {
    throw new TypeError(
      `advanceOpening needs a finite elapsedMs in ms — it must not read the clock itself, got ${elapsedMs}`,
    );
  }
  if (!openingRunning(state)) return state;
  // Something else is already answering where the camera should be. The guest
  // is looking at what they asked for; taking it away from them is the one
  // thing an opening must not do, and it stays not-done from here on.
  if (cameraTaken) return KEPT;

  const { lat, lng } = anchor ?? {};
  /* Is there a guest here to fly to? One predicate does both halves of that.
     `withinBounds` already refuses anything that is not two finite numbers,
     and it is the same judgement the app switches Follow on by, so the opening
     and Follow cannot disagree about whether the guest has arrived. A second
     finiteness check here would be a line no test could ever fail. */
  if (!withinBounds(bounds, lat, lng)) {
    /* Nobody yet. Keep holding while the hold lasts, then step aside: the park
       stays on screen and the first fix will still fly, but a guest whose GPS
       never answers has to be able to move their own map. */
    return elapsedMs < OPENING_HOLD_MS ? state : WAITING;
  }
  // Somebody, but not yet: the park has to be seen before it is left.
  if (elapsedMs < OPENING_HOLD_MS) return state;

  return Object.freeze({
    phase: OPENING_GUEST,
    camera: Object.freeze({
      center: Object.freeze({ lng, lat }),
      resolution: OPENING_RESOLUTION,
      // A point, not a box — the box was the opening itself.
      fit: null,
      bearing: 0,
      lift: 0,
      easeMs: OPENING_EASE_MS,
      // Nothing to hold still for: the flight crosses a park.
      deadbandMetres: 0,
    }),
  });
}

/**
 * The opening's move, handed over.
 *
 * A camera request is applied when it arrives; held any longer this one would
 * outrank every later Follow, focus and route framing, and the guest would be
 * unable to look anywhere for the rest of the session. So the caller applies
 * it and then says so, and the phase — how the opening ended — is what
 * remains.
 */
export function openingConsumed(state) {
  if (!state?.camera) return state;
  return Object.freeze({ phase: state.phase, camera: null });
}
