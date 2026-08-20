/* What a walkable way is, beyond its shape and its name.
 *
 * Until this existed, every feature in `map.path` and `map.service` had exactly
 * two keys — the ring and, if somebody had named it, the name. Every other
 * OpenStreetMap tag was read once by the builder and thrown away, and the
 * router therefore could not tell a flight of stairs from flat midway. It cost
 * both the same and would send a pushchair down the steps.
 *
 * So a small closed set of facts travels with each way. They are written by
 * scripts/lib/osm-tags.mjs and read by lib/routing.js, and this module is
 * deliberately the only place either of them learns what a bit means: a builder
 * and a router that disagree about bit 2 is a bug nothing would catch.
 *
 * Two fields, on the feature itself:
 *
 *   f   a bitfield of the booleans below, omitted when it would be zero
 *   l   OpenStreetMap's `layer`, a signed integer, omitted when it would be
 *       zero — which is all but about 4% of ways
 *
 * A bitfield rather than a key per fact because the set is closed and small,
 * and because a way that already carries one fact carries the rest for nothing.
 * The byte case for it is real but thin — about 1.6× against named keys, which
 * on Cedar Point is two kilobytes out of six hundred. The better argument is
 * that six named booleans on three thousand ways is six chances for the builder
 * and the router to drift apart, and one integer is one.
 *
 * Absent is not false. A way with no `f` is a way nobody has recorded any of
 * this about — OpenStreetMap does not tag the absence of a bridge — and code
 * reading these must not turn silence into an assertion.
 */

/**
 * The bits. Values are load-bearing: they are written into shipped venue files,
 * so a bit may be added but never renumbered or reused.
 */
export const WAY_FLAGS = {
  /** `highway=steps`. Walkable, and not by everyone. */
  STEPS: 1,
  /** Carried over whatever is underneath. Pairs with `l`. */
  BRIDGE: 2,
  /** Under something: a tunnel, or a passage through a building. */
  TUNNEL: 4,
  /** `oneway=yes` — passable only in the direction the ring is drawn. */
  ONEWAY: 8,
  /** `oneway=-1` — passable only against the direction the ring is drawn. */
  ONEWAY_BACK: 16,
  /** `access=no` or `access=private`. Back of house, whoever drew it. */
  RESTRICTED: 32,
};

/** Whether a way's bitfield asserts a given flag. */
export const hasWayFlag = (flags, bit) => ((Number(flags) || 0) & bit) === bit;

/**
 * Which way a way may be walked, as the sign of travel along its ring:
 * `1` forward only (ONEWAY), `-1` against the ring only (ONEWAY_BACK),
 * `0` both ways. Both bits at once is a contradiction no tag can produce
 * (`oneway=yes` and `oneway=-1` are one key), so it reads as unrestricted
 * rather than as an unwalkable way — absent is not false, and corrupt is
 * not a wall.
 */
export const onewayDirOf = (flags) => {
  const fwd = hasWayFlag(flags, WAY_FLAGS.ONEWAY);
  const back = hasWayFlag(flags, WAY_FLAGS.ONEWAY_BACK);
  return fwd === back ? 0 : fwd ? 1 : -1;
};

/** A bundle feature's flags, as a number, whatever shape the feature is in. */
export const wayFlagsOf = (feature) => (feature && Number(feature.f)) || 0;

/**
 * A bundle feature's `layer`, as a number.
 *
 * Zero means both "ground level" and "nobody said", and that is fine: they are
 * the same thing for anything that reads it. Only the non-zero values are worth
 * carrying, and they are the ones that say two ways crossing in plan view do
 * not meet.
 */
export const wayLayerOf = (feature) => (feature && Number(feature.l)) || 0;
