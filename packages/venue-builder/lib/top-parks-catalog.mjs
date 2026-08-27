/**
 * Curated list of the top 100 theme parks in the United States by attendance.
 *
 * Rankings follow the 2024 TEA Global Experience Index for the top tier, extended
 * with major regional parks from Cedar Fair, Six Flags, Herschend, SeaWorld, and
 * independent operators. Each entry is a Nominatim-friendly place query the builder
 * can resolve without hand-typed bounding boxes.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJson, slugify } from './venue-io.mjs';
import { recipeFile } from './venue-recipe.mjs';
import { BUILDER_ROOT } from '../src/paths.mjs';

export const CATALOG_FILE = path.join(BUILDER_ROOT, 'data', 'top-100-us-theme-parks.json');

/** @typedef {{ rank: number, name: string, place: string, locality: string, kind?: string, id?: string, skip?: boolean, note?: string, 'allow-no-heights'?: boolean }} ParkEntry */

/** Park kinds that legitimately ship without height-gated attractions. */
export const HEIGHT_LESS_KINDS = new Set(['zoo', 'water-park']);

/**
 * Whether this catalog row should skip the heights gate in a batch run.
 * Precedence: CLI --allow-no-heights > explicit catalog flag > kind default > strict.
 *
 * @param {ParkEntry} park
 * @param {{ cliAllowNoHeights?: boolean }} opts
 */
export function resolveAllowNoHeights(park, { cliAllowNoHeights = false } = {}) {
  if (cliAllowNoHeights) return true;
  if (park['allow-no-heights'] === true) return true;
  if (park['allow-no-heights'] === false) return false;
  if (park.kind && HEIGHT_LESS_KINDS.has(park.kind)) return true;
  return false;
}

/** Pipeline stages skipped when allow-no-heights is active for a park. */
export function pipelineSkipForAllowNoHeights(allowNoHeights) {
  return allowNoHeights ? ['research', 'aliases', 'heights', 'rebuild', 'agent'] : [];
}

/**
 * @returns {{ version: number, source: string, generated: string, parks: ParkEntry[] }}
 */
export function loadCatalog(file = CATALOG_FILE) {
  const data = readJson(file);
  if (!data?.parks?.length) {
    throw new Error(`No park catalog at ${file}`);
  }
  return data;
}

/**
 * Attach a stable venue id to every catalog row.
 * @param {ParkEntry[]} parks
 */
export function withIds(parks) {
  const seen = new Map();
  return parks.map((park) => {
    const id = park.id || slugify(park.name);
    if (seen.has(id)) {
      throw new Error(`Duplicate venue id "${id}" for ${park.name} and ${seen.get(id)}`);
    }
    seen.set(id, park.name);
    return { ...park, id };
  });
}

/**
 * @param {ParkEntry[]} parks
 * @param {{ skipExisting?: boolean, from?: number, to?: number, only?: string[] }} opts
 */
export function selectParks(parks, opts = {}) {
  let rows = withIds(parks);
  if (opts.only?.length) {
    const want = new Set(opts.only);
    rows = rows.filter((p) => want.has(p.id));
  }
  if (opts.from != null) rows = rows.filter((p) => p.rank >= opts.from);
  if (opts.to != null) rows = rows.filter((p) => p.rank <= opts.to);
  if (opts.skipExisting) {
    rows = rows.filter((p) => !recipeExists(p.id));
  }
  rows = rows.filter((p) => !p.skip);
  return rows;
}

export function recipeExists(id) {
  return existsSync(recipeFile(id));
}
