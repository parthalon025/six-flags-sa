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

const REFS_DIR = path.join(OVERRIDE_DIR, '..', 'display', 'references');
const IMAGES_FILE = path.join(REFS_DIR, 'images.json');

const FAMILY_KEYS = new Set([...Object.values(TERRAIN_NAMES), 'structure', 'badge']);

/** Keys the optional per-profile `iso` block may carry. */
const ISO_BLOCK_KEYS = new Set(['notes', 'appliesUnchanged', 'toleranceOverrides', 'structures']);

/** Mechanical style-contract check keys iso.appliesUnchanged may name. */
const STYLE_CHECK_KEYS = new Set([
  'style_terrain_palette', 'style_road_hierarchy', 'style_water_legibility',
  'style_outside_distinct', 'style_structure_presence', 'style_track_presence',
  'style_annotation_on_top', 'style_badge_dedup', 'style_bake_deterministic',
  'style_cross_kit_distinct',
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
