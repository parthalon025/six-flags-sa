/** Per-band kit vocabulary — what one kit looks like at one Zoom band.
 *
 * Not to be confused with `display-bands.mjs`, which is the *geometry* of a
 * band for a venue (how many cells, how many pixels, how many ground metres).
 * This module is the *look*: the half of ADR-0019 clause 1's "content changes
 * per band" that adds rather than removes.
 *
 * Slice h5 built the removal half. `bandGeneralization` in `display-bake.mjs`
 * drops a mark that cannot draw three pixels across, and its own note defers
 * the rest in as many words: close-band specificity is "added content from kit
 * vocabulary (ADR-0021 clause 7), not removed content, and therefore is not
 * this policy's job". This is that job. Together the two make the three bands
 * differ in content rather than in sharpness — the thing ADR-0019 rejected
 * "one ultra-res bake, tiled" for failing.
 *
 * ## Why a kit needs to speak per band at all
 *
 * A band is a ground sample distance, and the three sit two zoom levels apart
 * (ADR-0021 clause 2). The same declaration therefore paints three different
 * pictures. A per-cell speckle at density 0.3 is one pixel of noise at
 * overview's 2.4 m/px and a legible grain at close's 0.15; a building's drop
 * shadow at 0.25 cells is a smudge at one pixel per cell and a painted side
 * wall at sixteen. Left band-blind, a kit is authored for whichever band its
 * author had in mind and is wrong at the other two.
 *
 * ## The one rule, and where it comes from
 *
 * ADR-0021 clause 3: **generalization removes, never moves.** A band overlay is
 * held to the same line from the other side — it may restyle and nothing else.
 * Mechanically that is an allowlist (`BAND_LOOK_BLOCKS`), and the exclusions
 * are the point:
 *
 *   - `strokes` carries the seeded-noise displacement, which `display-bake.mjs`
 *     calls "the geo-truth budget in bake pixels". A band that could raise it
 *     would be a band moving Truth. It is also stated in *bake pixels*, which
 *     are a different ground distance at every band, so it could not be
 *     band-scoped coherently even if clause 3 allowed it.
 *   - `id` and `label` are the kit's identity. One kit reading as two Skins
 *     would fool the distinctness gate (`skin-distinct.mjs`) and the pack's
 *     Skin-to-bakeKit binding alike.
 *   - `bands` cannot nest: a band inside a band has no resolution to be.
 *
 * ## What the distinctness gate can and cannot see here
 *
 * `skin-distinct.mjs` reads kit specs at the top level, so two kits that differ
 * only inside their `bands` blocks score SAME on every axis. That is stated
 * rather than fixed: mapping band-scoped knobs onto the design axes is a
 * decision about what a kit should be able to say, which is the same call
 * UNMAPPED_AXES refuses to make on its own. Every shipped kit differs at the
 * base level, so nothing is currently hidden by it.
 *
 * Pure — no filesystem, no ledger, no clock. `resolveKit` in `display-bake.mjs`
 * is the caller: it merges the band look before it validates, so a band overlay
 * faces every check the base spec does.
 */
import { BANDS } from '@party-tracker/shared/zoomBands.js';

/** The kit blocks a band may restyle. An allowlist rather than a deny list:
 *  new kit vocabulary should have to be admitted to a band on purpose, not
 *  become band-scopable by having been added somewhere else. */
export const BAND_LOOK_BLOCKS = Object.freeze(['terrain', 'sprites', 'wash']);

/** Deep-merge one kit spec fragment over another.
 *
 *  Arrays replace wholesale — a roof palette or a slide colour ramp is a
 *  statement about the whole set, not a base for the next layer to extend, and
 *  an index-wise merge would leave a longer base's tail showing through a
 *  shorter override. Objects merge key by key. An absent key leaves the base
 *  standing, which is what makes a partial overlay partial.
 *
 *  One owner for this, because three layers now compose through it: the piece
 *  defaults, a band look, and a venue's design theme. Two implementations that
 *  disagreed about arrays would put a band's palette and a venue's palette on
 *  different rules. */
export function mergeKitSpec(base, over) {
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    for (const [k, v] of Object.entries(over || {})) {
      out[k] = k in base ? mergeKitSpec(base[k], v) : v;
    }
    return out;
  }
  return over === undefined ? base : over;
}

const BAND_IDS = BANDS.map((b) => b.id);

/** The bands a kit speaks for, coarsest first — the order `BANDS` is in and
 *  the order a pyramid is built, so a caller listing them reads them the way
 *  they are painted rather than the way the JSON happened to be typed. */
export function bandsDeclaredBy(spec) {
  const declared = Object.keys(spec?.bands || {});
  return BAND_IDS.filter((id) => declared.includes(id));
}

function assertBandBlock(spec) {
  const bands = spec?.bands;
  if (bands == null) return;
  if (typeof bands !== 'object' || Array.isArray(bands)) {
    throw new Error('kit `bands` must be an object keyed by band id');
  }
  for (const [bandId, look] of Object.entries(bands)) {
    // Checked on every resolve, not only when this band is the one asked for.
    // A typo'd band name that is silently dropped is a look nobody ever sees
    // painted, and nothing downstream would report its absence.
    if (!BAND_IDS.includes(bandId)) {
      throw new Error(`kit declares a look for unknown band "${bandId}" (${BAND_IDS.join(', ')})`);
    }
    if (look == null || typeof look !== 'object' || Array.isArray(look)) {
      throw new Error(`kit band "${bandId}" must be an object of kit blocks`);
    }
    for (const key of Object.keys(look)) {
      if (!BAND_LOOK_BLOCKS.includes(key)) {
        throw new Error(
          `kit band "${bandId}" may not carry "${key}" — a band restyles and nothing else `
            + `(ADR-0021 clause 3); band-scopable blocks are ${BAND_LOOK_BLOCKS.join(', ')}`,
        );
      }
    }
  }
}

/**
 * This kit as it is painted at one band: the band's look merged over the base
 * spec, with the `bands` block consumed.
 *
 * Consumed, not passed on, and that is load-bearing rather than tidy. A painter
 * still holding the block could read one band's look while drawing another —
 * the one route by which a band could end up carrying a fact of its own, which
 * is what ADR-0021 clause 1 exists to prevent.
 *
 * A band the kit says nothing about is the base kit. That is a statement, not a
 * hole: ADR-0019 clause 1 calls mid "today's bake, unchanged", so the ordinary
 * shape of a kit is a base spec that *is* the mid band, with overview and close
 * saying how they differ from it.
 *
 * @param {object} spec a kit spec, as authored on disk
 * @param {string|null} bandId a band from the shared table, or null for no band
 * @returns {object} a new spec — the input is never mutated
 */
export function bandLookSpec(spec = {}, bandId = null) {
  assertBandBlock(spec);
  if (bandId != null && !BAND_IDS.includes(bandId)) {
    throw new Error(`unknown band: ${bandId}`);
  }
  const { bands, ...base } = spec;
  const look = bandId == null ? null : bands?.[bandId];
  return look ? mergeKitSpec(base, look) : base;
}
