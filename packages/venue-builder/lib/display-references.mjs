/**
 * Reference profiles — the bake's output contract.
 *
 * A profile names what a design language must LOOK like, derived from
 * pinned reference images (PR #447's reference-derived visual profiles,
 * widened to every bake terrain class, carrying ADR-0012's testable
 * rules). Kits ship with a profile or they don't certify; the certifier
 * (lib/display-style-contract.mjs) samples real bake pixels at
 * truth-derived points and holds them to these families and rules.
 *
 * Reference images ride their own ledger (references/images.json) with
 * the same sha256-pin grammar as the asset ledger. Rows marked
 * `committed: false` are third-party works we may not redistribute: the
 * bytes live gitignored under assets/reference/, placed by hand, and the
 * pin still guarantees every reviewer compares against the same image.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { BUILDER_ROOT, OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { BUILDING_STYLES, TRACK_STYLES, TERRAIN_NAMES } from './display-bake.mjs';
import { rgbToLab, hexToRgb, deltaE } from './display-style-contract.mjs';
import { BANDS } from '@party-tracker/shared/zoomBands.js';
import {
  AXES, DERIVATION_LICENSES, GROUNDING_BANDS, GROUNDING_CLASSES, GROUNDING_SOURCES, MAX_GROUPS,
  MIN_WORLD_CONTRAST,
} from './display-grounding.mjs';

const REFS_DIR = path.join(OVERRIDE_DIR, '..', 'display', 'references');
const IMAGES_FILE = path.join(REFS_DIR, 'images.json');

const FAMILY_KEYS = new Set([...Object.values(TERRAIN_NAMES), 'structure', 'badge']);

const BAND_IDS = new Set(BANDS.map((b) => b.id));

/** Keys a per-band profile overlay may carry (mirrors the kit band vocabulary in
 *  `display-kit-bands.mjs`, which is `BAND_LOOK_BLOCKS` on the kit side). */
const BAND_BLOCK_KEYS = new Set(['colorFamilies', 'withdrawChecks', 'ground']);

/** Keys the optional per-profile `iso` block may carry. */
const ISO_BLOCK_KEYS = new Set(['notes', 'appliesUnchanged', 'toleranceOverrides', 'structures']);

/** Mechanical style-contract check keys iso.appliesUnchanged may name. */
const STYLE_CHECK_KEYS = new Set([
  'style_terrain_palette', 'style_road_hierarchy', 'style_water_legibility',
  'style_outside_distinct', 'style_structure_presence', 'style_track_presence',
  'style_annotation_on_top', 'style_badge_dedup', 'style_bake_deterministic',
  'style_cross_kit_distinct', 'style_world_geo',
]);

/**
 * Validate a profile's optional `iso` block — the iso tier reuses the flat
 * families, so the block only documents which rows apply unchanged and
 * carries iso-specific tolerance overrides. Returns problems.
 */
function validateIsoBlock(profile) {
  const problems = [];
  const iso = profile.iso;
  if (iso == null) return problems;
  if (typeof iso !== 'object' || Array.isArray(iso)) {
    problems.push(`${profile.id}: iso block must be an object`);
    return problems;
  }
  for (const key of Object.keys(iso)) {
    if (!ISO_BLOCK_KEYS.has(key)) problems.push(`${profile.id}: unknown iso key "${key}"`);
  }
  if (iso.notes != null && typeof iso.notes !== 'string') {
    problems.push(`${profile.id}: iso.notes must be a string`);
  }
  if (iso.appliesUnchanged != null) {
    if (!Array.isArray(iso.appliesUnchanged)) {
      problems.push(`${profile.id}: iso.appliesUnchanged must be an array of check keys`);
    } else {
      for (const key of iso.appliesUnchanged) {
        if (!STYLE_CHECK_KEYS.has(key)) {
          problems.push(`${profile.id}: iso.appliesUnchanged names unknown check "${key}"`);
        }
      }
    }
  }
  for (const [key, value] of Object.entries(iso.toleranceOverrides || {})) {
    if (!FAMILY_KEYS.has(key)) {
      problems.push(`${profile.id}: iso.toleranceOverrides names unknown family "${key}"`);
    } else if (!(value > 0 && value <= 50)) {
      problems.push(`${profile.id}: iso.toleranceOverrides.${key} deltaE out of range`);
    }
  }
  if (iso.structures != null) {
    for (const key of Object.keys(iso.structures)) {
      if (key !== 'coasterVsUnderlay') problems.push(`${profile.id}: unknown iso.structures key "${key}"`);
    }
    const m = iso.structures.coasterVsUnderlay?.minDeltaE;
    if (m != null && !(m > 0 && m <= 50)) {
      problems.push(`${profile.id}: iso.structures.coasterVsUnderlay.minDeltaE out of range`);
    }
  }
  return problems;
}

/** Structural validation of per-band overlays on a reference profile. */
function validateBandsBlock(profile) {
  const problems = [];
  const bands = profile.bands;
  if (bands == null) return problems;
  if (typeof bands !== 'object' || Array.isArray(bands)) {
    problems.push(`${profile.id}: bands block must be an object`);
    return problems;
  }
  for (const [bandId, block] of Object.entries(bands)) {
    if (!BAND_IDS.has(bandId)) {
      problems.push(`${profile.id}: unknown band "${bandId}" in bands`);
      continue;
    }
    if (typeof block !== 'object' || Array.isArray(block)) {
      problems.push(`${profile.id}: bands.${bandId} must be an object`);
      continue;
    }
    for (const key of Object.keys(block)) {
      if (!BAND_BLOCK_KEYS.has(key)) problems.push(`${profile.id}: unknown bands.${bandId} key "${key}"`);
    }
    for (const [key, family] of Object.entries(block.colorFamilies || {})) {
      if (key === 'draft') continue;
      if (!FAMILY_KEYS.has(key)) problems.push(`${profile.id}: bands.${bandId} unknown color family "${key}"`);
      else if (!family.anchor) problems.push(`${profile.id}: bands.${bandId} family "${key}" has no anchor`);
      else if (!(family.deltaE > 0 && family.deltaE <= 50)) {
        problems.push(`${profile.id}: bands.${bandId} family "${key}" deltaE out of range`);
      }
    }
    if (block.withdrawChecks != null) {
      if (!Array.isArray(block.withdrawChecks)) {
        problems.push(`${profile.id}: bands.${bandId}.withdrawChecks must be an array of check keys`);
      } else {
        for (const key of block.withdrawChecks) {
          if (!STYLE_CHECK_KEYS.has(key)) {
            problems.push(`${profile.id}: bands.${bandId}.withdrawChecks names unknown check "${key}"`);
          }
        }
      }
    }
    const outside = block.ground?.outsideVsInside?.minDeltaE;
    if (outside != null && !(outside > 0 && outside <= 50)) {
      problems.push(`${profile.id}: bands.${bandId}.ground.outsideVsInside.minDeltaE out of range`);
    }
    const water = block.ground?.waterVsVegetation?.minDeltaE;
    if (water != null && !(water > 0 && water <= 50)) {
      problems.push(`${profile.id}: bands.${bandId}.ground.waterVsVegetation.minDeltaE out of range`);
    }
  }
  return problems;
}

/** All reference profiles on disk, keyed by kit id. */
export function readReferenceProfiles(dir = REFS_DIR) {
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'images.json') continue;
    const profile = readJson(path.join(dir, f), null);
    if (profile) {
      profile.id = profile.id || f.replace(/\.json$/, '');
      out[profile.kit || profile.id] = profile;
    }
  }
  return out;
}

export const profileForKit = (kitId, profiles = readReferenceProfiles()) => profiles[kitId] || null;

/** Structural validation; returns problems, empty means green. */
export function validateProfile(profile, imageLedger = readReferenceImageLedger()) {
  const problems = [];
  if (!profile.kit) problems.push(`${profile.id}: no kit binding`);
  for (const [key, family] of Object.entries(profile.colorFamilies || {})) {
    if (key === 'draft') continue;
    if (!FAMILY_KEYS.has(key)) problems.push(`${profile.id}: unknown color family "${key}"`);
    else if (!family.anchor) problems.push(`${profile.id}: family "${key}" has no anchor`);
    else if (!(family.deltaE > 0 && family.deltaE <= 50)) {
      problems.push(`${profile.id}: family "${key}" deltaE out of range`);
    }
  }
  const bStyle = profile.structures?.buildingStyle;
  if (bStyle && !BUILDING_STYLES.includes(bStyle)) problems.push(`${profile.id}: unknown buildingStyle "${bStyle}"`);
  const tStyle = profile.structures?.trackStyle;
  if (tStyle && !TRACK_STYLES.includes(tStyle)) problems.push(`${profile.id}: unknown trackStyle "${tStyle}"`);
  if (!profile.roads?.vsGround && !profile.roads?.centerlineVsPaper) {
    problems.push(`${profile.id}: roads need vsGround or centerlineVsPaper`);
  }
  problems.push(...validateIsoBlock(profile));
  problems.push(...validateBandsBlock(profile));
  for (const id of profile.inspiration?.images || []) {
    if (!imageLedger[id]) problems.push(`${profile.id}: inspiration image "${id}" not in the reference-image ledger`);
  }
  if (!Array.isArray(profile.agentReview) || !profile.agentReview.length) {
    problems.push(`${profile.id}: no agentReview items — pixels alone cannot judge genre`);
  }
  for (const item of profile.agentReview || []) {
    if (typeof item.prompt !== 'string' || !item.prompt) {
      problems.push(`${profile.id}: agentReview items carry {key, prompt}, not bare strings`);
    } else if (item.key && !/^[a-z][a-z0-9_]*$/.test(item.key)) {
      problems.push(`${profile.id}: agentReview key "${item.key}" is not a slug`);
    }
  }
  return problems;
}

/** The reference-image ledger, keyed by image id. */
export function readReferenceImageLedger(file = IMAGES_FILE) {
  const doc = readJson(file, { images: {} });
  for (const [id, row] of Object.entries(doc.images)) row.id = id;
  return doc.images;
}

export const referenceImagePath = (row) => path.join(BUILDER_ROOT, row.path);

/**
 * Verify every reference-image pin. Committed rows must resolve and match;
 * uncommitted rows may be absent (reported, never a throw — vendored by
 * hand), but present bytes must match the pin exactly.
 */
export function verifyReferenceImages(ledger = readReferenceImageLedger()) {
  const problems = [];
  const reports = [];
  for (const [id, row] of Object.entries(ledger)) {
    const file = referenceImagePath(row);
    if (!existsSync(file)) {
      if (row.committed) problems.push(`${id}: committed reference missing at ${row.path}`);
      else reports.push(`${id}: not vendored — place the bytes by hand at ${row.path}`);
      continue;
    }
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sha !== row.sha256) problems.push(`${id}: sha256 drift (${sha.slice(0, 12)}… ≠ pinned)`);
  }
  return { problems, reports };
}

/* ------------------------------------------------------- grounding section
 *
 * ADR-0020's consequence — "the venue reference profile gains a grounding
 * section" — as code. `lib/display-grounding.mjs` measures a World's real
 * material relationships off aerial imagery; this half is what a reference
 * profile does with them.
 *
 * The load-bearing rule is ADR-0020 clause 4: **design owns treatment, the
 * venue owns relationships.** A Skin's palette always wins on treatment —
 * saturation budget, temperature, quantization — and the harvest wins on
 * relationships: which roofs are the blue ones, which paths are asphalt rather
 * than gravel. So `groundKit` never introduces a colour; it decides which of
 * the Skin's *own* declared colours each group of real roofs is painted in.
 * Every Skin stays distinct, and every Skin stays unmistakably that park.
 *
 * Where a Skin's declared palette inverts a relationship the park really has,
 * that is *disclosed* rather than corrected. Repainting the Skin to match the
 * ground is the colour-swap failure mode ADR-0020 rejects by name; the reverse
 * — pretending the park's lawn is lighter than its lot because the Skin says
 * so — is the harvest lying about what it measured. A row in `disagreements`
 * is neither.
 */

/** One World's grounding record — the venue reference profile's own file. */
export const groundingFile = (venueId) => path.join(OVERRIDE_DIR, venueId, 'display', 'grounding.json');

/** A World's grounding, or null. A World without one still bakes: grounding
 *  makes a Skin recognisably that park, and its absence costs recognition
 *  rather than function. */
export const readVenueGrounding = (venueId) => readJson(groundingFile(venueId), null);

/** Structural validation of a grounding record; returns problems, empty means
 *  green. The walls the harvest enforces on the way in are re-checked here,
 *  because a record on disk outlives the run that made it. */
export function validateGrounding(record) {
  const problems = [];
  const at = record?.venue ? `${record.venue} grounding` : 'grounding';
  if (!record || typeof record !== 'object') return [`${at}: not a record`];
  if (!record.venue) problems.push(`${at}: names no World`);

  const bands = record.bands || [];
  for (const band of bands) {
    if (!GROUNDING_BANDS.includes(band)) {
      problems.push(`${at}: band "${band}" is not grounded — ADR-0021 clause 8 scopes grounding to ${GROUNDING_BANDS.join(' and ')}`);
    }
  }
  if (!bands.length) problems.push(`${at}: names no bands`);

  const src = record.source || {};
  if (!GROUNDING_SOURCES.includes(src.source)) {
    problems.push(`${at}: "${src.source}" is not a derivation-licensed grounding source`);
  }
  if (!DERIVATION_LICENSES.includes(src.license)) {
    problems.push(`${at}: licence "${src.license}" does not permit derivation`);
  }
  if (!/^[0-9a-f]{64}$/.test(String(src.sha256 || ''))) {
    problems.push(`${at}: no sha256 pin on the raster it read`);
  }

  const observed = [];
  const classRows = Object.entries(record.classes || {});
  for (const [cls, row] of classRows) {
    if (!GROUNDING_CLASSES.includes(cls)) problems.push(`${at}: unknown grounding class "${cls}"`);
    if (!(row.sampleShare > 0 && row.sampleShare <= 1)) problems.push(`${at}: class "${cls}" sampleShare out of range`);
    if (!(row.samples > 0)) problems.push(`${at}: class "${cls}" was never sampled`);
    for (const axis of AXES) {
      if (!Number.isFinite(row[axis])) problems.push(`${at}: class "${cls}" has no ${axis}`);
    }
    if (/^#[0-9a-fA-F]{6}$/.test(String(row.observed || ''))) observed.push(hexToRgb(row.observed));
    else problems.push(`${at}: class "${cls}" carries no observed colour, so its contrast cannot be re-checked`);
  }

  // Wall 5, and the emptiness under it. `harvestGrounding` refuses a record
  // that measured nothing and one that reads the same everywhere; both are
  // re-checked here because a record on disk outlives the run that made it,
  // and a hand-edit or an older harvest leaves exactly these shapes behind.
  // The re-check runs off `observed` — the measured medians the record carries
  // as provenance — rather than trusting the `contrasts` the record asserts
  // about itself.
  if (!classRows.length) {
    problems.push(`${at}: no usable ground was read — a record of no classes grounds every Skin in nothing`);
  }
  let widest = 0;
  for (let i = 0; i < observed.length; i += 1) {
    for (let j = i + 1; j < observed.length; j += 1) {
      widest = Math.max(widest, deltaE(observed[i], observed[j]));
    }
  }
  if (observed.length > 1 && widest < MIN_WORLD_CONTRAST) {
    problems.push(
      `${at}: this frame told the harvest nothing about this World — its widest contrast across `
        + `${observed.length} classes is ΔE ${widest.toFixed(2)}, under ${MIN_WORLD_CONTRAST}`,
    );
  }

  for (const [cls, block] of Object.entries(record.groups || {})) {
    if (!record.classes?.[cls]) problems.push(`${at}: groups name unharvested class "${cls}"`);
    if (!AXES.includes(block.axis)) problems.push(`${at}: "${cls}" groups split on unknown axis "${block.axis}"`);
    const groups = block.groups || [];
    if (groups.length > MAX_GROUPS) problems.push(`${at}: "${cls}" split into more groups than a Skin can spend`);
    const seen = new Set();
    for (const group of groups) {
      if (!group.members?.length) problems.push(`${at}: "${cls}" group ${group.rank} has no members`);
      for (const key of group.members || []) {
        if (seen.has(key)) problems.push(`${at}: "${cls}" member ${key} is in two groups`);
        seen.add(key);
      }
    }
  }
  return problems;
}

/**
 * The Skin's own colours a class may be painted in, coolest-to-warmest order
 * decided by the caller. Only structures give a Skin more than one: a terrain
 * class declares a single base, and painting half a park's paths in a colour
 * the Skin never declared is exactly the override ADR-0020 rejects. Those
 * relationships reach the Skin through `disagreements` instead.
 */
const kitSlotsFor = (kit, cls) => (cls === 'structure' ? kit?.sprites?.building?.roofs || [] : []);

const axisValue = (hex, axis) => rgbToLab(hexToRgb(hex))[AXES.indexOf(axis)];

/** Lab units a relationship must clear at the park before a Skin can be said
 *  to disagree with it — below this the park has no opinion to contradict. */
const MIN_RELATION = 3;

/**
 * Re-express one World's grounding inside one Skin.
 *
 * @param kit       the kit spec (`data/display/kits/<id>.json`)
 * @param grounding that World's grounding record
 * @param band      which band this is being resolved for; grounding covers
 *                  overview and mid only
 * @returns the kit, unedited, plus a `grounding` section
 * @throws if asked for a band grounding does not reach
 */
export function groundKit({ kit, grounding, band = 'mid' }) {
  if (!GROUNDING_BANDS.includes(band)) {
    throw new Error(
      `grounding does not reach the "${band}" band — ADR-0021 clause 8 grounds ${GROUNDING_BANDS.join(' and ')} `
        + 'only; close-band specificity comes from kit vocabulary positioned by Places truth',
    );
  }

  const slots = {};
  const review = [];
  for (const [cls, block] of Object.entries(grounding?.groups || {})) {
    // An out-of-vocabulary axis is not a slot ordering with a shrug in it:
    // `axisValue` would index Lab at -1, every comparison would be NaN, and
    // the Skin's colours would land on the park's roof families in whatever
    // order the sort happened to leave them. `validateGrounding` catches this
    // on disk; this catches it on a record that never went through validation.
    if (!AXES.includes(block?.axis)) {
      throw new Error(
        `"${cls}" grounding splits on unknown axis "${block?.axis}" — a group ordering can only be read `
          + `along ${AXES.join(', ')}`,
      );
    }
    const palette = kitSlotsFor(kit, cls);
    if (palette.length < 1) continue;
    const ranked = [...palette].sort((a, b) => axisValue(a, block.axis) - axisValue(b, block.axis));
    const groups = block.groups || [];
    // Rank onto slot, both ordered along the axis the park actually splits on.
    // More groups than slots collapses proportionally rather than truncating:
    // a park with three roof families and two slots still gets its extremes
    // at opposite ends of the Skin's range.
    const slotFor = (rank) => (groups.length < 2
      ? ranked[0]
      : ranked[Math.round((rank * (ranked.length - 1)) / (groups.length - 1))]);
    slots[cls] = {
      axis: block.axis,
      groups: groups.map((group) => ({
        rank: group.rank,
        color: slotFor(group.rank),
        sampleShare: group.sampleShare,
        members: group.members,
      })),
    };
    if (groups.length > 1) {
      review.push({
        key: `grounding_${cls}`,
        prompt: `This World's ${cls === 'structure' ? 'roofs' : cls} fall into ${groups.length} real families, `
          + `split on ${block.axis}. In this Skin they are painted `
          + `${slots[cls].groups.map((g) => g.color).join(' and ')} — does the split still read as the same `
          + 'distinction a visitor would make standing in the park?',
      });
    }
  }

  const disagreements = [];
  const classes = Object.keys(grounding?.classes || {}).filter((c) => kit?.terrain?.[c]?.base).sort();
  for (let i = 0; i < classes.length; i += 1) {
    for (let j = i + 1; j < classes.length; j += 1) {
      const [a, b] = [classes[i], classes[j]];
      for (const axis of AXES) {
        const world = grounding.classes[a][axis] - grounding.classes[b][axis];
        if (Math.abs(world) < MIN_RELATION) continue;
        const skin = axisValue(kit.terrain[a].base, axis) - axisValue(kit.terrain[b].base, axis);
        if (Math.sign(world) === Math.sign(skin)) continue;
        disagreements.push({
          pair: [a, b],
          axis,
          world: world < 0 ? `${a} < ${b}` : `${a} > ${b}`,
          skin: skin < 0 ? `${a} < ${b}` : `${a} > ${b}`,
          worldDelta: world,
          skinDelta: skin,
        });
      }
    }
  }

  return {
    ...kit,
    grounding: {
      venue: grounding?.venue ?? null,
      band,
      source: grounding?.source ?? null,
      slots,
      disagreements,
      review,
    },
  };
}
