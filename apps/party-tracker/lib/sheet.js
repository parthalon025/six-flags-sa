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
 *   rail    the glance cards: .glanceRail's min-height, padding included
 *   digest  one line of the rail, for when a whole card will not fit
 *   search  .searchRow — 2 + a 44px field + 8
 *   brand   the venue name and its status line — an 18px line over 8
 *   list    the place list. A floor rather than a height: the list is the
 *           flexible child and takes whatever is left, but under about this
 *           much it is two rows and a scrollbar, which is not a list.
 *   hint    the "pull up for every place" line that stands in for the list
 */
export const SHEET_RAIL_PX = 104;
export const SHEET_DIGEST_PX = 26;
export const SHEET_SEARCH_PX = 54;
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
 * The glance stop: the rail, the search field, the venue line, the hint, and
 * eighteen pixels so none of them sit on the tab bar. Derived rather than
 * typed, so it cannot drift from the rungs it is the sum of.
 */
export const SHEET_PEEK_PX =
  SHEET_CHROME_PX + SHEET_RAIL_PX + SHEET_SEARCH_PX + SHEET_BRAND_PX + SHEET_HINT_PX + 18;

/** The height at which the place list first earns its room. */
export const SHEET_LIST_AT_PX =
  SHEET_CHROME_PX + SHEET_RAIL_PX + SHEET_SEARCH_PX + SHEET_BRAND_PX + SHEET_LIST_PX;

/** The two open stops, as a fraction of the viewport. */
export const SHEET_OPEN = { half: 0.52, full: 0.88 };

/**
 * Compact place card opened from a map tap — Google Maps' collapsed card:
 * a back chevron, the name, one line of facts, and the three icon actions.
 * Derived from the measured rungs so it cannot drift from the CSS, and kept
 * well under peek/half so the map stays the thing you look at. Pulling up
 * is how the notes and reports arrive.
 */
export const SHEET_PLACE_HEAD_PX = 38;
export const SHEET_PLACE_TITLE_PX = 52;
export const SHEET_PLACE_META_PX = 22;
export const SHEET_PLACE_ACTIONS_PX = 52;
export const SHEET_PLACE_PX =
  SHEET_CHROME_PX +
  SHEET_PLACE_HEAD_PX +
  SHEET_PLACE_TITLE_PX +
  SHEET_PLACE_META_PX +
  SHEET_PLACE_ACTIONS_PX +
  12;

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
  if (px >= SHEET_CHROME_PX + SHEET_DIGEST_PX) return 'peek';
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
 * A budget, spent in importance order. The rail goes first because it is the
 * answer to the question a phone comes out of a pocket to ask — which way, and
 * how long — but it goes first as a *line*: the twenty-six pixels that buy the
 * arrow, the time and the name. Then the search field. Only then does the rail
 * spend the seventy-eight more it takes to become a row of cards, and only then
 * the venue's line and the list.
 *
 * Buying the rail whole before the search field is what the ladder used to do,
 * and it meant the search field appeared at 164px and vanished again at 188 as
 * the rail's cards outbid it. Nothing may drop out on the way up — a row that
 * appears and then leaves as you pull is the arithmetic showing through the
 * interface — so the rail's upgrade waits its turn like everything else.
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
 * @returns {{digest:boolean, rail:boolean, search:boolean, brand:boolean,
 *            list:boolean, hint:boolean, spare:number}}
 */
export function sheetPlan(px) {
  const show = {
    digest: false,
    rail: false,
    search: false,
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

  if (!take(SHEET_DIGEST_PX)) return show;
  show.digest = true;

  if (take(SHEET_SEARCH_PX)) {
    show.search = true;
    if (take(SHEET_RAIL_PX - SHEET_DIGEST_PX)) {
      // The line becomes the cards. It was never two rungs, only one bought in
      // two goes, so the understudy stands down.
      show.rail = true;
      show.digest = false;
      if (take(SHEET_BRAND_PX)) {
        show.brand = true;
        show.list = take(SHEET_LIST_PX);
      }
    }
  }
  if (!show.list) show.hint = take(SHEET_HINT_PX);
  show.spare = room;
  return show;
}
