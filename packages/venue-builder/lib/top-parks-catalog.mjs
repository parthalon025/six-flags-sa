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

/** Park kinds that legitimately publish no height-gated attractions (#428). */
export const HEIGHT_LESS_KINDS = new Set(['water-park', 'zoo']);

/** @typedef {{ rank: number, name: string, place: string, locality: string, kind?: string, allowNoHeights?: boolean, id?: string, skip?: boolean, note?: string }} ParkEntry */

/**
 * Whether a catalog row defaults to tolerating zero official height rules.
 * Does not consider CLI overrides — use resolveAllowNoHeights for batch runs.
 *
 * @param {ParkEntry} park
 */
export function catalogAllowsNoHeights(park) {
  if (park.allowNoHeights === true) return true;
  if (park.allowNoHeights === false) return false;
  return HEIGHT_LESS_KINDS.has(park.kind || 'theme-park');
}

/**
 * Resolve allow-no-heights for one park in a batch/catalog run.
 * Precedence: CLI --allow-no-heights > CLI --strict-heights > catalog default > strict.
 *
 * @param {ParkEntry} park
 * @param {{ cliAllow?: boolean, cliStrict?: boolean }} [cli]
 */
export function resolveAllowNoHeights(park, cli = {}) {
  if (cli.cliAllow) return true;
  if (cli.cliStrict) return false;
  return catalogAllowsNoHeights(park);
}

/**
 * Whether the heights stage may proceed when zero rules are sourced (#428).
 * Geometry-only CLI mode always optional; otherwise uses catalog resolution.
 *
 * @param {ParkEntry} park
 * @param {{ allowNoHeights?: boolean, strictHeights?: boolean }} args catalog CLI args
 */
export function catalogHeightsOptional(park, args = {}) {
  if (args.allowNoHeights === true) return true;
  return resolveAllowNoHeights(park, { cliStrict: args.strictHeights === true });
}

/**
 * Heights-stage gate: abort when zero rules are sourced unless optional (#428).
 *
 * @param {number} ruleCount
 * @param {boolean} heightsOptional
 * @returns {'continue' | 'allow-empty' | 'abort'}
 */
export function zeroHeightsGate(ruleCount, heightsOptional) {
  if (ruleCount > 0) return 'continue';
  return heightsOptional ? 'allow-empty' : 'abort';
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
