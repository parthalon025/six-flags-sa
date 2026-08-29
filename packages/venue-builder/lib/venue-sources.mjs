/**
 * The venue's source catalogue — what besides OpenStreetMap this build uses.
 *
 * Every venue can carry `data/venues/<id>/sources.json` inside its package.
 * The builder reads it to wire merge, trace, and imagery datasets into the run,
 * and to assemble the credit line the app prints under the height slider.
 *
 * The file is facts about provenance, not generated output: it survives rebuilds
 * and is replayed from the recipe's `sources` field when one is recorded.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
// Imported from venue-fs.mjs, not venue-io.mjs: venue-io.mjs imports readSources
// etc. from this file, so importing back from venue-io.mjs would be a cycle (#32).
import { OVERRIDE_DIR, readJson, resolveBuilderPath, venueSidecar } from './venue-fs.mjs';

const ROOT = path.dirname(path.dirname(OVERRIDE_DIR));

export const sourcesFile = (id) => venueSidecar(id, 'sources.json');

/**
 * Adapters that need API secrets. Scaffolded offline catalogues omit these;
 * venues that have bounds may still declare them explicitly. Sync records a
 * gap (ok) when the token is absent so CI without secrets still passes.
 *
 * Kept as a static list (not imported from implementations) to avoid a cycle:
 * venue-sources → implementations → parks-api → venue-judge → venue-sources.
 */
export const TOKEN_GATED_ADAPTERS = Object.freeze([
  'mapillary-api',
  'accessibility-cloud',
  'openrouteservice',
  'google-places',
]);

/**
 * Known runnable external adapter ids (mirrors implementations.mjs, minus
 * playwright — and minus any venue-agnostic Display adapter, e.g.
 * poly-haven, which has no per-venue sync/gap concept and stays out of this
 * list on purpose).
 * Duplicated here deliberately — see TOKEN_GATED_ADAPTERS note.
 */
export const KNOWN_EXTERNAL_ADAPTER_IDS = Object.freeze([
  'parks-api',
  'queue-times',
  'ropedrop',
  'wikidata',
  'accessibility-cloud',
  'rcdb',
  'open-meteo',
  'openhistoricalmap',
  'project-sidewalk',
  'mapillary-api',
  'mapillary-tools',
  'esa-worldcover',
  'overture-buildings',
  'naip-planetary',
  'openrouteservice',
  'google-places',
]);

/**
 * Adapters a venue must ask for by name. Each is runnable and each is a bad
 * default for its own reason:
 *   ropedrop          — Disney/Universal open data only, wrong parks entirely.
 *   mapillary-tools   — needs a walkthrough video supplied by hand (ctx.videoPath).
 *   overture-buildings — needs the `duckdb` CLI, ~2 minutes per venue.
 *   naip-planetary    — a venue window is tens of MB of aerial pixels, and the
 *                       extraction lane that would read evidence out of them is
 *                       a later slice. Defaulting it would also put the id in
 *                       every newly scaffolded sources.json, where certification
 *                       then wants a cache or a gap note for it.
 */
const OPT_IN_ADAPTERS = Object.freeze([
  'ropedrop',
  'mapillary-tools',
  'overture-buildings',
  'naip-planetary',
  'google-places',
]);

/**
 * Default open-data adapters for a theme-park venue when scaffolding offline —
 * everything known, minus the opt-in list above and minus token-gated adapters.
 */
export const DEFAULT_EXTERNAL_ADAPTERS = KNOWN_EXTERNAL_ADAPTER_IDS.filter(
  (id) => !OPT_IN_ADAPTERS.includes(id) && !TOKEN_GATED_ADAPTERS.includes(id),
);

/**
 * Full theme-park catalogue pattern including optional a11y / Mapillary / ORS.
 */
export const THEME_PARK_EXTERNAL_ADAPTERS = KNOWN_EXTERNAL_ADAPTER_IDS.filter(
  (id) => id !== 'ropedrop',
);

/** Adapter ids listed in sources.json datasets.external (validated against registry). */
export function externalAdaptersFromCatalog(catalog, { fallback = DEFAULT_EXTERNAL_ADAPTERS } = {}) {
  const listed = catalog?.datasets?.external;
  if (!Array.isArray(listed) || !listed.length) return [...fallback];
  const known = new Set(KNOWN_EXTERNAL_ADAPTER_IDS);
  return listed.filter((id) => known.has(String(id)));
}

/**
 * Ensure `datasets.external` is present and registry-validated.
 * Missing lists get the offline-safe default; unknown ids are dropped.
 */
export function ensureExternalDatasets(catalog) {
  if (!catalog || typeof catalog !== 'object') return catalog;
  if (!catalog.datasets || typeof catalog.datasets !== 'object') catalog.datasets = {};
  const listed = catalog.datasets.external;
  if (!Array.isArray(listed) || !listed.length) {
    catalog.datasets.external = [...DEFAULT_EXTERNAL_ADAPTERS];
  } else {
    catalog.datasets.external = externalAdaptersFromCatalog(catalog, { fallback: [] });
  }
  return catalog;
}

/** Declared adapter gaps from sources.json (`gaps.adapters` or `gaps.<id>`). */
export function adapterGapNotes(catalog) {
  const gaps = catalog?.gaps;
  if (!gaps || typeof gaps !== 'object') return {};
  if (gaps.adapters && typeof gaps.adapters === 'object') {
    return Object.fromEntries(
      Object.entries(gaps.adapters).map(([k, v]) => [k, String(v)]),
    );
  }
  const out = {};
  for (const [k, v] of Object.entries(gaps)) {
    if (k === 'adapters' || typeof v === 'object') continue;
    out[k] = String(v);
  }
  return out;
}

const relativise = (value) => {
  const rel = path.relative(ROOT, path.resolve(String(value)));
  return rel.startsWith('..') ? String(value) : rel;
};

/** Read a venue's source catalogue, if one exists. */
export function readSources(id, explicit = null) {
  let file = explicit ? path.resolve(String(explicit)) : sourcesFile(id);
  let data = readJson(file);
  if (!data && explicit) {
    // Recipes record paths relative to the builder package root; cwd may be the monorepo root.
    file = resolveBuilderPath(explicit);
    data = readJson(file);
  }
  if (!data) return { file: null, data: null };
  return { file: relativise(file), data };
}

/** Collect a flag that may be repeated on the command line or in a recipe. */
function collect(existing, added) {
  const resolveDataset = (value) => {
    const resolved = resolveBuilderPath(value);
    return relativise(existsSync(resolved) ? resolved : value);
  };
  const have = new Set(
    []
      .concat(existing || [])
      .map((f) => resolveDataset(f)),
  );
  const out = existing ? [].concat(existing).map(resolveDataset) : [];
  for (const file of [].concat(added || [])) {
    const rel = resolveDataset(file);
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

  /* datasets.external is consumed by syncExternalSources / research — not by
     geometry flags — but we surface the resolved list on the catalog view. */
  out.externalAdapters = externalAdaptersFromCatalog(data);

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
