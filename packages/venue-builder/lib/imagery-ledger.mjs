/**
 * Imagery tile ledger — the provenance no imagery claim can exist without.
 *
 * ADR-0020 clause 1 makes imagery an evidence class rather than a picture:
 * anything extracted from it (a path edge, a tree, a surface class) carries
 * the source tile, the capture date, a sha256 over the ingested bytes and a
 * licence class. Clause 2 restricts the sources to derivation-licensed ones
 * and rejects the Google, Bing and Esri basemaps outright — "viewable is not
 * derivable". This module owns three questions and nothing else:
 *
 *   what a ledger row is          the required keys, and where the bytes are
 *   whether a row is admissible   rowProblems / verifyImageryLedger
 *   whether a claim is covered    claimCoverage
 *
 * The grammar is the one this repo already pins assets with — a keyed JSON
 * ledger, a sha256 per row, a `problems` array where empty means green (see
 * display-assets.mjs and display-references.mjs). It is deliberately the
 * fourth use of the same shape rather than a fourth shape.
 *
 * Two gates, not one, and that separation is the whole point. A licence class
 * says what the imagery *is*; `served_via` says what channel it arrived
 * through. Clause 2's rejection is about the channel: a public-domain county
 * orthophoto and Esri's own basemap can both be described as "aerial imagery,
 * public domain-ish" while only one of them may be derived from. A row that
 * passes the licence gate can still fail the vendor gate, and the live
 * Okaloosa row in data/imagery-ledger.json is exactly that case.
 *
 * What this module does NOT do is adjudicate. It reports; a human decides.
 * Nothing here exempts a row, and there is no allowlist override — an
 * unadjudicated row stays visibly unadjudicated in the problems it raises.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { BUILDER_ROOT } from '../src/paths.mjs';

/** The committed, hand-reviewed ledger. */
export const IMAGERY_LEDGER_FILE = path.join(BUILDER_ROOT, 'data', 'imagery-ledger.json');

/**
 * Licence classes an ingested tile may carry, per ADR-0020 clause 2's named
 * sources: `public-domain` covers NAIP and USGS 3DEP (US federal works),
 * `cc-by` and `cc-by-sa` cover the attribution-licensed rest.
 *
 * `cc-by-sa` is admissible for *ingest* only. ADR-0021's open list still
 * records "Mapillary's share-alike reach into derived venue data" as
 * un-reviewed, so a share-alike tile clearing this gate is not a finding that
 * whatever is derived from it may ship unencumbered.
 */
export const DERIVATION_LICENSES = ['public-domain', 'cc-by', 'cc-by-sa'];

/**
 * Serving channels ADR-0020 clause 2 rejects for derivation, named exactly as
 * the clause names them. This is a name gate over a declared channel, not a
 * licence oracle: it catches a row that says out loud where its pixels came
 * from. It cannot catch a row that declares a channel dishonestly or by an
 * unfamiliar name, which is why an unrecognised channel is not treated as
 * proof of anything — only a recorded channel that matches one of these is.
 */
export const REJECTED_FOR_DERIVATION = ['google', 'bing', 'esri'];

/** Keys ADR-0020 clause 1 requires on every row, and the prose for a missing one. */
const REQUIRED = [
  ['source', 'no source'],
  ['captured', 'no capture date'],
  ['sha256', 'no sha256 — clause 1 pins the bytes that were ingested'],
  ['license', 'no licence class'],
  ['served_via', 'no serving channel recorded'],
];

const rowLabel = (row) => row?.id || row?.tile || '(unkeyed row)';

/** Where a row's bytes sit, if it vendors any. Relative to the builder package. */
export const imageryTilePath = (row, root = BUILDER_ROOT) => path.join(root, row.path);

/**
 * The rejected basemap vendor a serving channel names, or null.
 *
 * Whole-word so a channel is matched by its vendor name rather than by an
 * accidental substring — "Esri World Imagery" matches, a hypothetical
 * "Bingham County GIS" does not match `bing`.
 */
export function rejectedVendor(servedVia) {
  const text = String(servedVia || '');
  for (const vendor of REJECTED_FOR_DERIVATION) {
    if (new RegExp(`\\b${vendor}\\b`, 'i').test(text)) return vendor;
  }
  return null;
}

/**
 * Everything wrong with one row. Empty means admissible: this tile may be
 * derived from, and a claim that names it is covered.
 */
export function rowProblems(row) {
  const id = rowLabel(row);
  const problems = [];
  if (!row || typeof row !== 'object') return [`${id}: not a ledger row`];

  for (const [key, prose] of REQUIRED) {
    if (row[key] === null || row[key] === undefined || row[key] === '') problems.push(`${id}: ${prose}`);
  }

  if (row.license != null && row.license !== '' && !DERIVATION_LICENSES.includes(row.license)) {
    problems.push(
      `${id}: licence class "${row.license}" is not derivation-licensed ` +
        `(ADR-0020 clause 2 allows ${DERIVATION_LICENSES.join(', ')})`,
    );
  }

  const vendor = rejectedVendor(row.served_via);
  if (vendor) {
    problems.push(
      `${id}: served via "${row.served_via}" — ADR-0020 clause 2 rejects ${vendor} for derivation ` +
        `("viewable is not derivable"); a human must adjudicate this row`,
    );
  }

  return problems;
}

/**
 * The ledger, keyed by tile id, with each row stamped with its own key.
 *
 * Throws rather than falling back to an empty ledger. The other ledgers in
 * this package default to `{}` on a read failure, which is right for an asset
 * library — a missing texture is visible. Here an empty ledger silently means
 * "no imagery claim is covered anywhere", which reads as a licence result and
 * is really a broken file.
 */
export function readImageryLedger(file = IMAGERY_LEDGER_FILE) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`imagery ledger unreadable at ${file}: ${err.message}`);
  }
  const tiles = doc?.tiles;
  if (!tiles || typeof tiles !== 'object') throw new Error(`imagery ledger at ${file} carries no tiles map`);
  for (const [id, row] of Object.entries(tiles)) row.id = id;
  return tiles;
}

/** Admissibility across the whole ledger. Empty means every row may be derived from. */
export function verifyImageryLedger(ledger = readImageryLedger()) {
  return Object.values(ledger).flatMap((row) => rowProblems(row));
}

/**
 * Hold every vendored tile to its pin.
 *
 * `problems` are rows whose bytes are declared and wrong or absent. `reports`
 * are rows pinned without vendoring the bytes, which is the normal case for a
 * raster: lib/adapters/naip-planetary.mjs hashes the window it read and then
 * deliberately keeps the pixels in memory rather than persisting them, so its
 * sha256 is a claim about bytes nothing on disk can be held against. Such a
 * pin is re-checkable only by reading the same window again — worth recording,
 * not something this function can verify. Mirrors verifyReferenceImages()'s
 * problems/reports split for references vendored by hand.
 */
export function verifyImageryBytes(ledger = readImageryLedger(), { root = BUILDER_ROOT } = {}) {
  const problems = [];
  const reports = [];
  for (const row of Object.values(ledger)) {
    const id = rowLabel(row);
    if (!row.sha256) continue; // clause 1's missing pin is rowProblems' finding, not a byte mismatch
    if (!row.path) {
      reports.push(`${id}: pinned but not vendored here — nothing on disk to re-check the digest against`);
      continue;
    }
    const file = imageryTilePath(row, root);
    if (!existsSync(file)) {
      problems.push(`${id}: missing bytes at ${row.path}`);
      continue;
    }
    const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (sha !== row.sha256) problems.push(`${id}: sha256 drift (${sha.slice(0, 12)}… ≠ pinned)`);
  }
  return { problems, reports };
}

/**
 * The ledger tile a claim rests on, or null when it names none.
 *
 * Two shapes reach here and they disagree about the word "source". A feature
 * signed by lib/venue-imagery.mjs carries `src: {by, source}` where `by` is the
 * evidence class ("aerial") and `source` is the dataset id. A claim from
 * lib/adapters/naip-planetary.mjs carries a top-level `source` that is the
 * evidence class itself. Reading `source` unconditionally would turn the second
 * into a lookup for a tile called "aerial" and report a missing row for what is
 * really an unsigned claim, so `source` counts as a tile id only inside a `src`
 * block that also names its class. A row id under `tile` is read either way.
 */
export function tileIdFor(claim) {
  const src = claim?.src && typeof claim.src === 'object' ? claim.src : claim;
  if (typeof src?.tile === 'string' && src.tile) return src.tile;
  if (src?.by && typeof src?.source === 'string' && src.source) return src.source;
  return null;
}

/**
 * Whether a claim is backed by an admissible ledger row.
 *
 * `ok` is true only when the claim names a tile, that tile is in the ledger,
 * and the row clears clauses 1 and 2. An imagery claim that fails this has no
 * provenance to stand on, whatever its coordinates look like.
 */
export function claimCoverage(claim, ledger = readImageryLedger()) {
  const label = claim?.n || claim?.name || claim?.label || 'claim';
  const tile = tileIdFor(claim);
  if (!tile) return { ok: false, tile: null, row: null, problems: [`${label}: claim names no imagery tile`] };

  const row = ledger[tile];
  if (!row) {
    return {
      ok: false,
      tile,
      row: null,
      problems: [`${label}: tile "${tile}" is not in the imagery ledger`],
    };
  }

  const problems = rowProblems(row);
  return { ok: problems.length === 0, tile, row, problems };
}
