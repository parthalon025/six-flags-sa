/**
 * The venue's source catalogue — what besides OpenStreetMap this build uses.
 *
 * Every venue can carry `data/venues/<id>.sources.json` beside its overrides.
 * The builder reads it to wire merge, trace, and imagery datasets into the run,
 * and to assemble the credit line the app prints under the height slider.
 *
 * The file is facts about provenance, not generated output: it survives rebuilds
 * and is replayed from the recipe's `sources` field when one is recorded.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';

const ROOT = path.dirname(path.dirname(OVERRIDE_DIR));

export const sourcesFile = (id) => path.join(OVERRIDE_DIR, `${id}.sources.json`);

const relativise = (value) => {
  const rel = path.relative(ROOT, path.resolve(String(value)));
  return rel.startsWith('..') ? String(value) : rel;
};

/** Read a venue's source catalogue, if one exists. */
export function readSources(id, explicit = null) {
  const file = explicit ? path.resolve(String(explicit)) : sourcesFile(id);
  const data = readJson(file);
  if (!data) return { file: null, data: null };
  return { file: relativise(file), data };
}

/** Collect a flag that may be repeated on the command line or in a recipe. */
function collect(existing, added) {
  const have = new Set(
    []
      .concat(existing || [])
      .map((f) => relativise(f)),
  );
  const out = existing ? [].concat(existing).map(relativise) : [];
  for (const file of [].concat(added || [])) {
    const rel = relativise(file);
    if (have.has(rel)) continue;
    have.add(rel);
    out.push(rel);
  }
  return out.length ? out : undefined;
}

/**
 * Wire a source catalogue into build arguments.
 *
 * Datasets named in the catalogue are folded into `merge`, `trace`, and
 * `imagery` unless the same path was already given on the command line.
 * The catalogue file itself is recorded on `args.sources` when present.
 */
export function wireSources(id, args = {}) {
  const { file, data } = readSources(id, args.sources);
  if (!data) return { args, catalog: null, file: null };

  const out = { ...args, sources: file };
  const datasets = data.datasets || {};

  for (const key of ['merge', 'trace', 'imagery']) {
    const fromCatalog = datasets[key];
    if (!fromCatalog) continue;
    const wired = collect(out[key], fromCatalog);
    if (wired) out[key] = wired;
  }

  return { args: out, catalog: data, file };
}

/**
 * Gaps OpenStreetMap left that imagery datasets are meant to fill.
 *
 * Named track with no place of its own is handled elsewhere; this catches the
 * names that still have no POI after that pass.
 */
export function osmGaps({ pois, layers }) {
  const names = new Set(pois.map((p) => String(p.n).toLowerCase()));
  const missingRides = [];
  for (const layer of ['coaster', 'slide']) {
    for (const way of layers[layer] || []) {
      const n = way.n?.trim();
      if (!n || names.has(n.toLowerCase())) continue;
      missingRides.push(n);
    }
  }
  return { missingRides: [...new Set(missingRides)] };
}

/**
 * The credit line shown in the app for non-OSM data.
 *
 * Overrides win — that is where the research lives. The catalogue may append a
 * standard imagery line when overrides do not already mention it.
 */
export function resolveCredits({ args, overrides, existingMeta, catalog }) {
  const base =
    (overrides?.credits && String(overrides.credits)) ||
    (args.credits && String(args.credits)) ||
    existingMeta?.credits ||
    null;
  const extra = catalog?.credits_append ? String(catalog.credits_append).trim() : null;
  if (!extra) return base;
  if (!base) return extra;
  if (base.includes(extra)) return base;
  return `${base} ${extra}`;
}
