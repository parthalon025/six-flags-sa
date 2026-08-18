/**
 * Asset ledger — the display factory's asset library, engine-style.
 *
 * Concepts borrowed from game-engine asset pipelines and enforced here:
 * stable ids (kits reference GUID keys, never paths), import settings
 * beside the asset (tile geometry lives in the ledger row), license +
 * provenance per row (CC0/original/licensed only; AGPL rejected), a
 * credits manifest emitted per bake, and content-addressable cache keys
 * (source bytes + import settings + baker version).
 *
 * The vendored bytes live under packages/venue-builder/assets/vendor/,
 * fetched once by bin/vendor-assets.mjs (never at CI time) and pinned by
 * sha256 — verifyAssetHashes() is the gate that notices drift.
 *
 * Row schema notes: `kind` is tilesheet | sprite | icon; `target` names the
 * render target a variant serves (flat now, iso when the isometric tier
 * lands) so one label can carry per-target art without new ids.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { ALLOWED_LICENSES } from './display-pack.mjs';

const BUILDER_PKG_ROOT = path.join(OVERRIDE_DIR, '..', '..');
const LEDGER_FILE = path.join(OVERRIDE_DIR, '..', 'display', 'assets.json');

export const assetPath = (row) => path.join(BUILDER_PKG_ROOT, row.path);

/** Asset ledger, keyed by stable GUID. */
export function readAssetLedger(file = LEDGER_FILE) {
  const doc = readJson(file, { assets: {} });
  for (const [id, row] of Object.entries(doc.assets)) row.id = id;
  return doc.assets;
}

/**
 * Verify every ledger row: license allowed, provenance present, bytes on
 * disk matching the pinned sha256. Returns problems; empty means green.
 */
export function verifyAssetHashes(ledger = readAssetLedger()) {
  const problems = [];
  for (const [id, row] of Object.entries(ledger)) {
    if (!ALLOWED_LICENSES.includes(row.license)) {
      problems.push(`${id}: license "${row.license}" not allowed`);
    }
    if (!row.source?.url) problems.push(`${id}: no source url`);
    const file = assetPath(row);
    if (!existsSync(file)) {
      problems.push(`${id}: missing bytes at ${row.path} — run bin/vendor-assets.mjs`);
      continue;
    }
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sha !== row.sha256) problems.push(`${id}: sha256 drift (${sha.slice(0, 12)}… ≠ pinned)`);
  }
  return problems;
}

/** Per-bake credits + license-audit manifest for the asset ids used. */
export function creditsManifest(usedIds, ledger = readAssetLedger()) {
  const rows = [...new Set(usedIds)].sort().map((id) => {
    const row = ledger[id];
    if (!row) throw new Error(`Unknown asset id "${id}"`);
    return {
      id,
      label: row.label,
      license: row.license,
      source: row.source.url,
      attribution: row.attribution || null,
    };
  });
  return { version: 1, assets: rows };
}

/**
 * Content-addressable cache key: same bytes + same import settings + same
 * baker version ⇒ same processed artifact.
 */
export function assetContentHash(row, bakerVersion = 1) {
  const bytes = readFileSync(assetPath(row));
  return createHash('sha256')
    .update(bytes)
    .update(JSON.stringify(row.import || {}))
    .update(String(bakerVersion))
    .digest('hex');
}
