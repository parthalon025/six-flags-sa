/**
 * Poly Haven — CC0 PBR material library for the Display pipeline (PR #471).
 * https://polyhaven.com/textures
 *
 * Display-layer, not Truth-layer: this never touches evidence.mjs or
 * evidence_sources. It writes a small, committed ledger of real Poly Haven
 * assets (id, license, per-resolution file URLs) — the same "committed
 * materials.json ledger (license + provenance)" shape PR #471 describes —
 * not the texture bytes themselves, which are fetched at build time and
 * never belong in git. Venue-agnostic: one ledger, shared by every venue's
 * Display pack, cached under data/display/ rather than data/venues/<id>/.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../venue-io.mjs';
import { fetchJson, UA } from './_cache.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DISPLAY_DIR = path.join(HERE, '..', '..', 'data', 'display');
// Sibling of materials.json (the surface-binding ledger display-pack.mjs
// reads): this file is the Poly Haven source catalog those bindings can
// draw from — two schemas, two files.
const materialsLedgerFile = () => path.join(DISPLAY_DIR, 'polyhaven-materials.json');

/**
 * Curated, real Poly Haven slugs per land-cover category this product needs
 * (matches ESA WorldCover's built-up/tree-cover classes and the entrance-map
 * midway/roofing/foliage vocabulary already used elsewhere in the builder).
 * No `water` entry: Poly Haven's texture catalogue has no static PBR water
 * asset (water reads as a shader property, not a tileable photo texture) —
 * left as a documented gap rather than a fabricated slug.
 */
export const CATEGORY_SLUGS = {
  asphalt: 'asphalt_02',
  roofing: 'grey_roof_01',
  foliage: 'leafy_grass',
};

const POLY_HAVEN_API = 'https://api.polyhaven.com';

/** One category's real metadata + file URLs from Poly Haven's own API. */
export async function fetchMaterial(category, slug, { resolution = '2k', format = 'jpg', fetch = fetchJson } = {}) {
  const info = await fetch(`${POLY_HAVEN_API}/info/${slug}`, { headers: { 'User-Agent': UA } });
  const files = await fetch(`${POLY_HAVEN_API}/files/${slug}`, { headers: { 'User-Agent': UA } });

  const maps = {};
  for (const [mapName, byResolution] of Object.entries(files)) {
    const chosen = byResolution?.[resolution]?.[format];
    if (chosen) maps[mapName] = { url: chosen.url, size: chosen.size, md5: chosen.md5 };
  }

  return {
    category,
    slug,
    name: info.name,
    license: 'CC0',
    source: `https://polyhaven.com/a/${slug}`,
    categories: info.categories || [],
    resolution,
    format,
    maps,
  };
}

/** Pure: assemble the committed ledger shape from fetched materials. */
export function buildLedger(materials, { fetched } = {}) {
  return {
    version: 1,
    fetched: fetched || new Date().toISOString().slice(0, 10),
    license: 'CC0',
    source: 'https://polyhaven.com',
    note: 'Display-layer PBR materials. Ledger only — texture bytes fetched at build time, never committed.',
    materials,
  };
}

export async function run(ctx = {}, { fetch = fetchJson } = {}) {
  const file = materialsLedgerFile();
  if (ctx.offline) {
    const cached = readJson(file);
    return { adapterId: 'poly-haven', ok: Boolean(cached), data: cached, artifacts: cached ? [file] : [] };
  }

  try {
    const materials = [];
    for (const [category, slug] of Object.entries(CATEGORY_SLUGS)) {
      materials.push(await fetchMaterial(category, slug, { fetch }));
    }
    const ledger = buildLedger(materials);
    writeJson(file, ledger, true);
    return {
      adapterId: 'poly-haven',
      ok: materials.length === Object.keys(CATEGORY_SLUGS).length,
      meta: { count: materials.length, categories: Object.keys(CATEGORY_SLUGS) },
      artifacts: [file],
      data: ledger,
    };
  } catch (err) {
    return { adapterId: 'poly-haven', ok: false, error: err.message };
  }
}
