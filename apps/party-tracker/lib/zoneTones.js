'use client';

/**
 * Zone tones from the Visual factory — the phone's read of a World's display
 * pack.
 *
 * A Skin restyles a World's Zones. That derivation belongs to the Visual
 * factory, which compiles `<skin>.visual.json` per World × Skin and certifies
 * that every colour in it comes out of that Skin's own declared palette. This
 * module is the phone's side of that seam: fetch the published spec once per
 * session, hand back the tone table, and answer "none" for a World whose pack
 * has not been published.
 *
 * Before this existed the app kept its own per-Skin district tables in
 * theme.js and its own per-World tints in `map.meta.lands`, which meant three
 * places decided what a Zone looked like and the Skin was not one of them.
 */

import { useEffect, useState } from 'react';

/**
 * App theme ids and Skin ledger ids agree everywhere except the two always-on
 * Palettes, which the app calls by their band and the ledger by their name.
 */
const LEDGER_SKIN_ID = { day: 'trail', night: 'park-midnight' };

/** The ledger Skin whose visual spec paints this theme, or null for none. */
export const ledgerSkinFor = (theme) => (theme ? LEDGER_SKIN_ID[theme] || theme : null);

export const zoneTonesUrl = (venueId, theme) => {
  const skin = ledgerSkinFor(theme);
  return venueId && skin ? `/venues/${venueId}/display/${skin}.visual.json` : null;
};

/**
 * The spec's tone table, flattened to `{ Zone: {fill, stroke, label} }`.
 *
 * A spec carries only the half its Skin paints — `landTones[zone][mode]`
 * where `mode` is the Skin's own — so the mode the spec declares is the one
 * to read. Anything else is a spec from a different contract and is ignored
 * rather than half-read.
 */
export function tonesFromSpec(spec) {
  const mode = spec?.tokens?.mode === 'night' ? 'night' : 'day';
  const out = {};
  for (const [zone, byMode] of Object.entries(spec?.landTones || {})) {
    const tone = byMode?.[mode];
    if (tone?.fill) out[zone] = tone;
  }
  return out;
}

/* One fetch per url per session: a Wear toggle must not refetch a spec the
   phone already holds, and a World with no published pack must answer "none"
   once rather than on every render. Mirrors CustomMapLayer's sidecar cache. */
const specs = new Map();

export function fetchZoneTones(url) {
  if (!specs.has(url)) {
    specs.set(
      url,
      fetch(url)
        .then((res) => (res.ok ? res.json() : null))
        .then((spec) => (spec ? tonesFromSpec(spec) : null))
        .catch(() => null),
    );
  }
  return specs.get(url);
}

/**
 * The active World × Skin's Zone tones, or null until they land (and forever
 * for a World whose pack is not published). Null is a complete answer: every
 * caller falls back to the renderer's own name-hue, which is what a World
 * nobody has harvested is supposed to look like.
 */
export function useZoneTones(venueId, theme) {
  const url = zoneTonesUrl(venueId, theme);
  // Keyed by url so a World or Wear switch never paints the previous Skin's
  // tones while the new spec is in flight.
  const [answer, setAnswer] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!url) return undefined;
    fetchZoneTones(url).then((tones) => {
      if (alive) setAnswer({ url, tones });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return answer && answer.url === url ? answer.tones : null;
}