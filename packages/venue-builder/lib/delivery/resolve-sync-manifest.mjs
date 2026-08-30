/**
 * Resolve a wear-time bundle manifest for sync — full or delta by revision.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { usingPostdb, revisionExists, readTruth } from '../postdb-io.mjs';
import { assembleBundleAtRevision, overlayShippedTruthBytes } from './export-from-postdb.mjs';
import { VENUE_DIR } from './delivery-io.mjs';
import { manifestForSync, parseSinceParam } from './delta-sync.mjs';

function readSeedBundle(venueDir, venueId) {
  const file = path.join(venueDir, `${venueId}.bundle.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function loadCurrentBundle(venueId, venueDir) {
  if (usingPostdb()) {
    try {
      const truth = await readTruth(venueId);
      const assembled = await assembleBundleAtRevision(venueId, truth.revisionId, {
        displayDir: path.join(venueDir, venueId, 'display'),
      });
      // Same pin the export path applies: the head manifest must hash the bytes this
      // origin serves, not a JSONB round-trip of them (see overlayShippedTruthBytes).
      if (assembled?.bundle) return overlayShippedTruthBytes(venueId, venueDir, assembled).bundle;
    } catch {
      // Shipped seed bundles answer when this venue has no PostDB head yet.
    }
  }
  return readSeedBundle(venueDir, venueId);
}

/**
 * @param {string} venueId
 * @param {URLSearchParams} searchParams
 * @param {{ venueDir?: string }} [opts]
 */
export async function resolveSyncManifest(venueId, searchParams, opts = {}) {
  const venueDir = opts.venueDir || VENUE_DIR;
  const { since } = parseSinceParam(searchParams);
  const current = await loadCurrentBundle(venueId, venueDir);
  if (!current) return { mode: 'full', manifest: null };

  if (!since) {
    return manifestForSync(current, { since: null });
  }

  if (!usingPostdb()) {
    return manifestForSync(current, { since, prior: null, priorKnown: false });
  }

  const known = await revisionExists(venueId, since);
  if (!known) {
    return manifestForSync(current, { since, prior: null, priorKnown: false });
  }

  // Deliberately NOT overlaid with shipped bytes: disk holds the head's truth, not this
  // older revision's. Pinning it here would make prior and current hash alike and drop a
  // real truth change out of the delta. Reconstructed-vs-shipped bytes differ, so the trio
  // reads as changed and is re-fetched — a wasted fetch the phone then verifies, which is
  // the safe direction to be wrong in.
  const priorAssembly = await assembleBundleAtRevision(venueId, since, {
    displayDir: path.join(venueDir, venueId, 'display'),
  });
  const prior = priorAssembly?.bundle ?? null;
  return manifestForSync(current, { since, prior, priorKnown: true });
}
