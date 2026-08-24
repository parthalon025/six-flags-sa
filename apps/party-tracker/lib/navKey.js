/**
 * Stable identity for a walk target.
 *
 * Kept out of `routing.js` so UI that only needs a stable walk-target key does
 * not pull the whole walk-graph module into the first-load client bundle.
 *
 * A party member is a moving target and a meet-up can be dropped again, so the
 * destination is held as a reference rather than a pair of coordinates, and
 * this is what the UI compares to know which card is the live one.
 */
export const navKeyOf = (nav) => {
  if (!nav) return null;
  if (nav.kind === 'member') return `member:${nav.id}`;
  if (nav.kind === 'meet') return 'meet';
  return `poi:${nav.placeId || nav.label}`;
};
