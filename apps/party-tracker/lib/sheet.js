/**
 * The sheet's geometry: where it comes to rest, and what is worth putting on
 * it once it is there.
 *
 * The sheet used to have four heights and nothing in between. You pulled it,
 * it followed your finger, and the moment you let go it jumped to whichever of
 * peek/half/full it decided you had meant — so the one thing you could not do
 * was leave it where you put it. On a map that is the whole argument: the split
 * between map and list is a judgement about *this* moment, and only the person
 * holding the phone can make it.
 *
 * So the height is now a number, and the number is the finger's. The named
 * stops survive as two smaller things:
 *
 *   - magnets. Release within {@link SHEET_MAGNET_PX} of a stop and it takes
 *     you, because "all the way up" and "right down" are worth being able to
 *     hit without aiming. Release anywhere else and you stay exactly there.
 *   - rungs for the tap cycle, so the handle still reaches every stop for
 *     somebody who never discovers the drag.
 *
 * The other half is {@link sheetPlan}. With a continuous height, "what does the
 * Explore screen show" can no longer be a switch on a stop name — there are no
 * stops to switch on. It is a budget instead: the content is a priority list
 * with a measured cost in pixels, and whatever the current height can pay for
 * is what gets drawn. Pull the sheet up a hundred pixels and the next thing
 * down the list appears as the room for it does, rather than at a threshold
 * somebody picked.
 *
 * All of it is pure arithmetic on purpose — there is no DOM in here, so
 * test/unit.mjs can hold the ladder to its measurements.
 */

/* ------------------------------------------------------------- the rungs -- */

/**
 * What the sheet wears at every height: the grab handle (12 + 5 + 10) and the
 * tab bar (4 + 44 + 6 + a half-pixel rule). Whatever the phone reserves for its
 * home indicator sits under both and is added in CSS, which is the only place
 * that knows it.
 */
export const SHEET_CHROME_PX = 84;

/**
 * The measured cost of each thing the Explore screen can show, in the order it
 * is worth showing. These track globals.css and are the first thing to check if
 * a row in the collapsed sheet grows.
 *
 *   search  .searchRow — 2 + a 44px field + 8
 *   locate  .locateCard — the "Location off / Turn on" card. Only ever charged
 *           on a phone with no fix: on every other phone there is nothing to
 *           draw, and a rung nobody can see must not cost anything. Measured
 *           at 72 on a 390px phone, where the second line wraps, plus its 8 of
 *           margin. A narrower phone wraps it to three and eats into the
 *           eighteen SHEET_PEEK_PX holds back.
 *   brand   the venue name and its status line — an 18px line over 8
 *   list    the place list. A floor rather than a height: the list is the
 *           flexible child and takes whatever is left, but under about this
 *           much it is two rows and a scrollbar, which is not a list.
 *   hint    the "pull up for every place" line that stands in for the list
 *
 * The glance rail's two rungs — 104px of cards and a 26px one-line understudy —
 * used to head this list. Explore is search → context → list now, so they are
 * gone rather than merely unrendered: leaving them in the budget would charge
 * the sheet 104px for a band with nothing drawn in it, which is the arithmetic
 * showing through the interface in its purest form.
 */
export const SHEET_SEARCH_PX = 54;
export const SHEET_LOCATE_PX = 80;
export const SHEET_BRAND_PX = 26;
export const SHEET_LIST_PX = 132;
export const SHEET_HINT_PX = 22;

/**
 * The smallest sheet that is still saying something. Below it the stage is not
 * shown at all: a sliver of a search field above a sliced-off card is not a
 * smaller screen, it is a broken one.
 */
export const SHEET_SHUT_PX = SHEET_CHROME_PX;

/**
 * The resting stop: the search field, the venue line, the hint, and eighteen
 * pixels so none of them sit on the tab bar. Derived rather than typed, so it
 * cannot drift from the rungs it is the sum of.
 *
 * It also has to clear the locate card, because that is what a phone with no
 * fix gets in place of the venue line and the hint — and the one screen that
 * most needs an answer must not be the one screen that rests too low to show
 * it. The two ways of spending the same room are held side by side here rather
 * than added up: only one of them is ever drawn.
 */
export const SHEET_PEEK_PX =
  SHEET_CHROME_PX +
  SHEET_SEARCH_PX +
  Math.max(SHEET_BRAND_PX + SHEET_HINT_PX, SHEET_LOCATE_PX) +
  18;

/** The height at which the place list first earns its room. */
export const SHEET_LIST_AT_PX =
  SHEET_CHROME_PX + SHEET_SEARCH_PX + SHEET_BRAND_PX + SHEET_LIST_PX;

/** The two open stops, as a fraction of the viewport. */
export const SHEET_OPEN = { half: 0.52, full: 0.88 };

/**
 * The place card opened from a map tap, measured from globals.css:
 *
 *   head     .placeDetailTop — the live word and the verdict pill on one
 *            22px line, over 2
 *   title    .placeDetailName — 21px type on a 26px line, over 5 to the meta
 *   meta     .placeDetailLine — one 18px line
 *   actions  .placeActions.labelled — a 44px button under 12 of margin
 *
 * The back chevron overlays the title rather than taking a row of its own, so
 * it costs nothing here — see .navHead.placeNav.
 *
 * These four are what the sheet opens at, so they are the four things to
 * re-measure whenever this screen's type changes. It grew when the name went
 * from 17px to 21 and the actions gained their words: an icon row that cost
 * nothing because it sat beside the title now costs a row of its own, which is
 * the price of a button somebody can read.
 */
export const SHEET_PLACE_HEAD_PX = 24;
export const SHEET_PLACE_TITLE_PX = 31;
export const SHEET_PLACE_META_PX = 18;
/** One labelled action row: 44px button over 12px margin (globals.css). */
export const SHEET_PLACE_ACTIONS_PX = 56;
/** Two wrapped rows at ≤389px: 12 margin + 44 + 6 gap + 44 (globals.css). */
export const SHEET_PLACE_ACTIONS_WRAP_PX = 106;
/** Viewport width below which labelled actions wrap (measured 390 fits, 375 wraps). */
export const SHEET_PLACE_ACTIONS_WRAP_AT_PX = 390;

export function sheetPlaceActionsPx(viewportWidth = SHEET_PLACE_ACTIONS_WRAP_AT_PX) {
  return viewportWidth < SHEET_PLACE_ACTIONS_WRAP_AT_PX
    ? SHEET_PLACE_ACTIONS_WRAP_PX
    : SHEET_PLACE_ACTIONS_PX;
}

export function sheetPlacePx(viewportWidth = SHEET_PLACE_ACTIONS_WRAP_AT_PX) {
  return (
    SHEET_CHROME_PX +
    SHEET_PLACE_HEAD_PX +
    SHEET_PLACE_TITLE_PX +
    SHEET_PLACE_META_PX +
    sheetPlaceActionsPx(viewportWidth) +
    8
  );
}

export const SHEET_PLACE_PX = sheetPlacePx();

/** How close to a stop a release has to land for the stop to take it. */
export const SHEET_MAGNET_PX = 26;

/**
 * How far the sheet coasts at the speed it was let go at. 140ms of projection
 * is enough for a flick to carry into the magnet at the far end without a slow
 * drag ever overshooting the height it was aimed at.
 */
export const SHEET_COAST_MS = 140;

/**
 * The gap the sheet floats clear of the bottom edge in each of its forms. What
 * the map is standing on is the height plus this; at the full form the sheet is
 * anchored and there is no gap. CSS mirrors this as --sheetFoot (height + gap +
 * safe-area inset) for positioning map chrome above the tab bar.
 */
export const SHEET_GAP = { shut: 8, peek: 8, half: 5, full: 0 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* ------------------------------------------------------------- the stops -- */

/**
 * The named stops in pixels. Two of them are fractions of the viewport, so they
 * are only knowable once there is a window to ask.
 */
export function sheetStops(viewportH) {
  return {
    shut: SHEET_SHUT_PX,
    peek: SHEET_PEEK_PX,
    half: Math.round(SHEET_OPEN.half * viewportH),
    full: Math.round(SHEET_OPEN.full * viewportH),
  };
}

/** Every stop's height, low to high. */
const ladderOf = (stops) => Object.values(stops).sort((a, b) => a - b);

/**
 * Where a release settles.
 *
 * The finger's height, carried on by however fast it was moving, clamped to the
 * floor and the ceiling — and then handed to a stop only if it landed close
 * enough to one to have plausibly been aimed at it. Everywhere else it stays
 * put, which is the point.
 *
 * @param px        the height the sheet was at when the finger left it
 * @param stops     the named stops
 * @param velocity  pixels per millisecond, positive upwards
 */
export function settleSheet(px, stops, velocity = 0) {
  const heights = ladderOf(stops);
  const coasted = clamp(px + velocity * SHEET_COAST_MS, heights[0], heights[heights.length - 1]);
  let best = heights[0];
  let gap = Infinity;
  heights.forEach((at) => {
    const d = Math.abs(coasted - at);
    if (d < gap) {
      gap = d;
      best = at;
    }
  });
  return gap <= SHEET_MAGNET_PX ? best : Math.round(coasted);
}

/**
 * The stop a tap on the handle moves to: the next one up, wrapping round to
 * shut from the top. Dragging is how most people will move the sheet, but a tap
 * has to be able to reach every stop too, including all the way back down —
 * somebody who has collapsed it must not need a gesture to undo it. Answering
 * in heights rather than names is what lets it start from a height the visitor
 * chose that has no name at all.
 */
export function nextSheetStop(px, stops) {
  const heights = ladderOf(stops);
  return heights.find((at) => at > px + 1) ?? heights[0];
}

/**
 * Which of the four shapes the sheet wears at this height. Purely cosmetic —
 * how far it insets from the edges, how round its corners are, and whether it
 * is still glass over the map or has become an opaque surface you read a list
 * on. Nothing about *what* it shows is decided here; that is {@link sheetPlan}.
 *
 * The boundaries are not midpoints. `shut` ends exactly where the first rung
 * becomes affordable, so the shape and the contents agree about whether there
 * is anything on the sheet, and `full` begins only near the ceiling, so a sheet
 * pulled two thirds of the way up is still a card floating over a map rather
 * than a screen that has replaced one.
 */
export function sheetForm(px, stops) {
  if (px >= stops.full - 12) return 'full';
  if (px >= Math.round((stops.peek + stops.half) / 2)) return 'half';
  if (px >= SHEET_CHROME_PX + SHEET_SEARCH_PX) return 'peek';
  return 'shut';
}

/**
 * What the right-hand control column needs above the sheet: the zoom pad sits
 * 142px clear of it and is 88px tall, and the two floating buttons in the top
 * corners own the first 100px of the screen.
 */
export const SHEET_FURNITURE_PX = 330;

/**
 * Whether the sheet has taken enough of the screen that the map's own controls
 * have nowhere left to stand. They ride on --sheetH, so they climb as it does,
 * and past this they climb into the buttons in the top corners.
 *
 * With four stops this could not happen — the pad fitted at half and was hidden
 * outright at full, and there was nothing in between. A height the visitor
 * chooses can land exactly in between, so the question has to be asked of the
 * number rather than of a stop's name.
 */
export function sheetCrowdsMap(px, viewportH) {
  return px + SHEET_FURNITURE_PX > viewportH;
}

/* -------------------------------------------------------------- the plan -- */

/**
 * What the Explore screen shows at this height.
 *
 * A budget, spent in importance order. Search goes first, because searching is
 * the way into a map and it is the one row that is worth having on a sheet
 * pulled almost shut. Then the locate card on a phone that has no fix, because
 * until there is one every other row on this screen is a worse version of
 * itself — no walking times in the list, no district in the venue line. Then
 * the venue's own line, then the list.
 *
 * The ladder stops at the first rung it cannot afford rather than skipping to a
 * cheaper one below: the brand line costs half what the search field does, and
 * a sheet showing the park's name but no way to search it would be the
 * arithmetic talking rather than anything anyone wanted.
 *
 * The hint is the exception, and deliberately so. It is what the list looks
 * like when the list will not fit, so it is only ever offered once the list has
 * been turned down, out of whatever is left over.
 *
 * Nothing may drop out on the way up — a row that appears at 300px and is gone
 * again at 320 is the arithmetic showing through the interface — so every rung
 * above is bought in one go, in one order, and `located` is fixed for the whole
 * of a drag.
 *
 * @param px                the sheet's height
 * @param [opts.located]    whether this phone has a fix. False buys the locate
 *                          card its rung; true means there is nothing to draw
 *                          and therefore nothing to charge for.
 * @returns {{search:boolean, locate:boolean, brand:boolean,
 *            list:boolean, hint:boolean, spare:number}}
 */
export function sheetPlan(px, { located = true } = {}) {
  const show = {
    search: false,
    locate: false,
    brand: false,
    list: false,
    hint: false,
    spare: 0,
  };
  let room = Math.max(0, Math.round(px) - SHEET_CHROME_PX);
  const take = (cost) => {
    if (room < cost) return false;
    room -= cost;
    return true;
  };

  /* Nothing below the first rung. The hint is cheap enough to fit under the
     search field, and offering it there would put "pull up to explore" on a
     sheet with no way to explore anything on it — a shape with nothing in it,
     which is exactly what `shut` means. */
  if (!take(SHEET_SEARCH_PX)) return show;
  show.search = true;

  if (located || take(SHEET_LOCATE_PX)) {
    show.locate = !located;
    if (take(SHEET_BRAND_PX)) {
      show.brand = true;
      show.list = take(SHEET_LIST_PX);
    }
  }
  if (!show.list) show.hint = take(SHEET_HINT_PX);
  show.spare = room;
  return show;
}
