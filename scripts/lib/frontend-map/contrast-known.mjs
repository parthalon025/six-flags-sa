/**
 * Contrast debt that is already known about, so a gate can tell it from a
 * regression.
 *
 * Nothing in this file is derivable. A ratio is measured from `globals.css`;
 * whether somebody has agreed to live with it, and under which issue, is a
 * decision, and a decision has to be written down. The rule for this list is
 * that it only ever shrinks: an entry is removed when the pairing is fixed,
 * never edited to accept a worse number.
 *
 * `ratio` is the reading at the moment the entry was written, and it is the
 * one hardcoded number here that earns its place — it is a ratchet. A tracked
 * pairing that measures *worse* than its entry fails the command, so accepting
 * white-on-orange at 2.84 does not quietly license white-on-orange at 2.1.
 *
 * The app is read outdoors in direct sun, which is why these are debts rather
 * than decisions: `globals.css` already records that a lighter treatment
 * "fails on outdoor glare", and a primary action nobody can read at midday is
 * a broken button, not a styling preference.
 */

/** The issue the front-end contrast debt is filed under. */
export const KNOWN_ISSUE = 576;

export const KNOWN_CONTRAST_FAILURES = [
  {
    pair: '--onTint on --adventure',
    ratio: 2.84,
    issue: KNOWN_ISSUE,
    why: 'White on the Adventure orange, the primary action fill (.btn.primary). The most-pressed button in the app and the worst-reading text on it.',
  },
  {
    pair: '--onTint on --signal',
    ratio: 3.69,
    issue: null,
    why: 'White on the alert fill (.chip.danger.on). Clears the 3:1 non-text floor but not the 4.5:1 text floor it is held to, because the chip carries a word. Found by the first run of this command; it needs an issue of its own.',
  },
];
