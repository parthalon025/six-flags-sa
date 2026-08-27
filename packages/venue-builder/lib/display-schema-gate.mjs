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
  return errors.length ? { ok: false, errors } : { ok: true };
}
