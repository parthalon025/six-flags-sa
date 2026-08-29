/**
 * display-schema.json gate — visual spec shape regression guard (ticket 18).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/display-schema.json');

let cachedSchema = null;

export function loadDisplaySchema() {
  if (!cachedSchema) {
    cachedSchema = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  }
  return cachedSchema;
}

/**
 * Minimal structural validation without pulling @maplibre/maplibre-gl-style-spec.
 *
 * @param {object} spec
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
export function validateDisplaySpec(spec) {
  const schema = loadDisplaySchema();
  const errors = [];
  for (const key of schema.required || []) {
    if (spec?.[key] === undefined || spec?.[key] === null) {
      errors.push(`missing required field "${key}"`);
    }
  }
  if (typeof spec?.version !== 'number' || spec.version < 1) {
    errors.push('version must be a positive integer');
  }
  if (typeof spec?.venue !== 'string' || !spec.venue.length) {
    errors.push('venue must be a non-empty string');
  }
  if (typeof spec?.skin !== 'string' || !spec.skin.length) {
    errors.push('skin must be a non-empty string');
  }
  if (!spec?.basedOn || typeof spec.basedOn.map !== 'string') {
    errors.push('basedOn.map must be a string');
  }
  if (!spec?.tokens || typeof spec.tokens !== 'object') {
    errors.push('tokens must be an object');
  }
  if (!spec?.surfaces || typeof spec.surfaces !== 'object' || !Object.keys(spec.surfaces).length) {
    errors.push('surfaces must be a non-empty object');
  }
  errors.push(...landToneErrors(spec?.landTones));
  return errors.length ? { ok: false, errors } : { ok: true };
}

/** The modes a Zone tone may be keyed by — one Skin paints one of them. */
const TONE_MODES = ['day', 'night'];

/** The roles a Zone tone carries, since 5e2cebc gave the Visual factory Zone tone. */
const TONE_ROLES = ['fill', 'stroke', 'label'];

const isHex = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

/**
 * `landTones` in the shape the renderer reads: zone → mode → {fill, stroke, label}.
 *
 * The retired shape is zone → mode → hex, and `apps/party-tracker/lib/zoneTones.js`
 * degrades a tone it cannot read to "no tone" rather than throwing. So a spec
 * compiled before 5e2cebc renders its Zones untinted — a silent visual
 * downgrade no test could see, which is how pixel-tycoon's pack sat on the old
 * shape unnoticed (#31). A retired shape is a gate failure here instead.
 */
export function landToneErrors(landTones) {
  if (landTones === undefined) return [];
  if (!landTones || typeof landTones !== 'object' || Array.isArray(landTones)) {
    return ['landTones must be an object keyed by Zone name'];
  }
  const errors = [];
  for (const [zone, byMode] of Object.entries(landTones)) {
    if (!byMode || typeof byMode !== 'object' || Array.isArray(byMode)) {
      errors.push(`landTones["${zone}"] must be keyed by mode (${TONE_MODES.join(' or ')})`);
      continue;
    }
    for (const [mode, tone] of Object.entries(byMode)) {
      const at = `landTones["${zone}"].${mode}`;
      if (!TONE_MODES.includes(mode)) {
        errors.push(`${at}: "${mode}" is not a mode a Skin paints`);
        continue;
      }
      if (isHex(tone)) {
        errors.push(
          `${at}: retired flat shape — a bare hex, not { ${TONE_ROLES.join(', ')} }. `
            + 'Recompile the pack (venues:display); the renderer degrades this to no tone rather than throwing.',
        );
        continue;
      }
      if (!tone || typeof tone !== 'object' || Array.isArray(tone)) {
        errors.push(`${at}: must be an object of ${TONE_ROLES.join(', ')}`);
        continue;
      }
      for (const role of TONE_ROLES) {
        if (!isHex(tone[role])) errors.push(`${at}.${role}: not a #rrggbb hex`);
      }
    }
  }
  return errors;
}
