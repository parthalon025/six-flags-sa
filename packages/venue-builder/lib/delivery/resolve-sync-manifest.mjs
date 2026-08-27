/**
 * Resolve a wear-time bundle manifest for sync — full or delta by revision.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { usingPostdb, revisionExists, readTruth } from '../postdb-io.mjs';
import { assembleBundleAtRevision } from './export-from-postdb.mjs';
import { VENUE_DIR } from './delivery-io.mjs';
import { manifestForSync, parseSinceParam } from './delta-sync.mjs';

function readSeedBundle(venueDir, venueId) {
  const file = path.join(venueDir, `${venueId}.bundle.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function loadCurrentBundle(venueId, venueDir) {
  if (usingPostdb()) {
    const truth = await readTruth(venueId);
    const assembled = await assembleBundleAtRevision(venueId, truth.revisionId, {
      displayDir: path.join(venueDir, venueId, 'display'),
    });
    return assembled?.bundle ?? null;
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

  const priorAssembly = await assembleBundleAtRevision(venueId, since, {
    displayDir: path.join(venueDir, venueId, 'display'),
  });
  const prior = priorAssembly?.bundle ?? null;
  return manifestForSync(current, { since, prior, priorKnown: true });
}
