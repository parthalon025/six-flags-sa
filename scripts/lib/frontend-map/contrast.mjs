/**
 * Measure the token pairings this app actually paints, in both palettes.
 *
 * The arithmetic and the pair list are not here. `design-bundle/sources.mjs`
 * already owns `contrast()` and `CONTRAST_PAIRS`, and the whole argument of
 * that module — one answer, read from the place that owns it — would be lost
 * by a second WCAG implementation two directories away. This file adds the one
 * thing the bundle deliberately does not do: an exit code.
 *
 * The bundle echoes its findings and always exits 0, because it is a mirror of
 * the app and "the app has a problem" is not "the mirror is broken". A gate
 * has to be able to say no. So the pairings are measured here against a
 * baseline of what was already known to fail, and only a *new* failure stops
 * the build. `--aqua` at 2.45:1 and `--adventure` at 2.84:1 are real, are
 * tracked in #576, and would fail this command on the day it landed if it did
 * not know the difference between a debt and a regression.
 *
 * Interface:
 *   measureContrast() → { rows, failures, regressions, fixed, known }
 */
import { readTokens, contrast, CONTRAST_PAIRS } from '../design-bundle/sources.mjs';
import { KNOWN_CONTRAST_FAILURES, KNOWN_ISSUE } from './contrast-known.mjs';

/**
 * The floors, and why they are what they are.
 *
 * WCAG 2.1: 4.5:1 for normal text (1.4.3), 3:1 for graphical objects and user
 * interface components (1.4.11). Each pair in CONTRAST_PAIRS carries the floor
 * that applies to it, so these are here to be named in the report rather than
 * to be applied — the stylesheet's own reading is what decides which one a
 * pairing is held to.
 *
 * They are not raised for this app even though `globals.css` records that its
 * lighter treatments "fail on outdoor glare" and this is a park app used in
 * direct sun. A floor invented here would be a number nobody could check
 * against a standard; the sun is an argument for clearing 4.5 comfortably, not
 * for a private threshold.
 */
export const FLOORS = [
  { ratio: 4.5, what: 'normal text', clause: 'WCAG 2.1 SC 1.4.3 Contrast (Minimum)' },
  { ratio: 3, what: 'graphical objects and UI components', clause: 'WCAG 2.1 SC 1.4.11 Non-text Contrast' },
];

/** Key a pairing by what it is, so a reordered list does not invalidate a baseline. */
export const pairKey = (p) => `${p.fg} on ${p.bg}`;

export function measureContrast() {
  const tokens = readTokens();
  /* The cascade the browser runs, not the day block alone: `--blue` is
     `var(--adventure)` in both palettes and `--adventure` is declared once, in
     night, so a day lookup that ignored night would leave it unpainted. This
     is the same resolution design-bundle/compose.mjs builds its swatch table
     from, for the same reason. */
  const night = new Map(tokens.rows.map((t) => [t.name, t.resolved]));
  const day = new Map(tokens.rows.map((t) => [t.name, t.dayResolved ?? t.resolved]));
  const at = (map, ref) => (ref.startsWith('--') ? map.get(ref) : ref);

  const rows = CONTRAST_PAIRS.map((p) => {
    const measured = { night: contrast(at(night, p.fg), at(night, p.bg)), day: contrast(at(day, p.fg), at(day, p.bg)) };
    const worst = Object.entries(measured)
      .filter(([, r]) => r !== null)
      .sort((a, b) => a[1] - b[1])[0] ?? [null, null];
    return {
      ...p,
      key: pairKey(p),
      ...measured,
      worst: worst[1],
      worstPalette: worst[0],
      /* Only what the app paints is judged. A `rejected` row is a proposal
         that was measured and turned down — it is on the page so the floor has
         a failing example beside it, and failing the build on a colour the app
         does not use would make this command unrunnable. */
      judged: p.status === 'ships',
    };
  });

  const failing = rows.filter((r) => r.judged && r.worst !== null && r.worst < r.floor);
  const known = new Map(KNOWN_CONTRAST_FAILURES.map((k) => [k.pair, k]));

  /* Two kinds of regression, and they fail for the same reason: something got
     worse and nobody said so. A pairing nobody has written down is the obvious
     one. A tracked pairing that now reads below the number its entry records
     is the one a plain allow-list would miss — accepting 2.84:1 must not be a
     licence for 2.1:1. The 0.01 of slack is the precision the baseline is
     written to, not a tolerance. */
  const worse = (r) => {
    const entry = known.get(r.key);
    return entry && r.worst < entry.ratio - 0.01;
  };

  return {
    rows,
    failures: failing,
    regressions: failing.filter((r) => !known.has(r.key) || worse(r)),
    tracked: failing
      .filter((r) => known.has(r.key) && !worse(r))
      .map((r) => ({ ...r, ...known.get(r.key) })),
    /* Debt that has been paid. Left in the baseline it would hide the next
       regression on the same pairing, so the command asks for it to be
       removed rather than quietly forgetting it. */
    fixed: KNOWN_CONTRAST_FAILURES.filter((k) => !failing.some((r) => r.key === k.pair)),
    known: KNOWN_CONTRAST_FAILURES,
    issue: KNOWN_ISSUE,
  };
}
