/**
 * Bake-certification drift — is a committed `bakes.<kit>.signature` row in
 * a venue's `display-certification.json` still what a fresh bake of that
 * kit would produce?
 *
 * `bakes.<kit>.signature` (display-pack.mjs `foldBakeCerts`) is folded in
 * from whatever style-cert.json happened to sit in gitignored
 * `artifacts/display-bake/` the last time someone ran `venues:bake` +
 * `venues:display --bake`, or the `Build a venue` workflow's bake step. Ship
 * that file and later change a kit definition, a reference profile, or the
 * compositor itself, and the committed row keeps claiming a pass nothing
 * re-checks — the staleness this module exists to catch (#509).
 *
 * The signature (lib/display-style-contract.mjs `signature`) is an FNV-1a
 * hash over every sampled bake pixel, so it changes the moment a fresh
 * render would look different. Reproducing it costs one Chromium bake per
 * kit (bin/display-bake.mjs) — the render `venues:bake` already pays, run
 * again rather than trusted. This module stays pure: it only compares two
 * signature maps a caller supplies, so the comparison itself is testable
 * without Chromium.
 */
import path from 'node:path';
import { OVERRIDE_DIR, readJson } from '../lib/venue-io.mjs';

/**
 * Committed bake signatures for one venue, keyed by kit id — the `bakes`
 * block `display-pack.mjs` writes into `display-certification.json`. `{}`
 * when the venue has never been baked (nothing to drift-check).
 */
export function readCommittedBakes(id) {
  const file = path.join(OVERRIDE_DIR, id, 'display', 'display-certification.json');
  return readJson(file, { bakes: {} }).bakes || {};
}

/**
 * Diff committed bake signatures against a fresh set for one venue. Pure —
 * no disk, no child process — so the drift rule itself can be proven with a
 * manufactured mismatch, independent of whether a real re-bake ran clean.
 *
 * @param {string} venue
 * @param {Record<string, {signature: string, certified?: boolean}>} committed rows already shipped (readCommittedBakes)
 * @param {Record<string, {signature: string, certified?: boolean}>} fresh rows from a bake taken right now, keyed by the same kit ids
 * @returns {{venue: string, kit: string, committedSignature: string|null, freshSignature: string, reason: string}[]}
 *   one row per kit whose fresh signature no longer matches what shipped
 */
export function driftedBakes(venue, committed, fresh) {
  const rows = [];
  for (const [kit, freshRow] of Object.entries(fresh)) {
    const committedRow = committed[kit];
    if (!committedRow) {
      rows.push({
        venue, kit, committedSignature: null, freshSignature: freshRow.signature,
        reason: 'kit has no committed bake certification to compare against',
      });
      continue;
    }
    if (committedRow.signature !== freshRow.signature) {
      rows.push({
        venue, kit, committedSignature: committedRow.signature, freshSignature: freshRow.signature,
        reason: 'fresh bake signature no longer matches the committed one',
      });
    }
  }
  return rows;
}
