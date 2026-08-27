/**
 * Seed PostDB from shipped file truth before delivery export (ticket 16).
 *
 * Idempotent: when the on-disk truth trio matches the published head's
 * outputs_hash, the existing revision is reused — seed bundles keep a stable
 * revisionId until truth actually changes.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { OVERRIDE_DIR as BUILDER_VENUES } from '../../src/paths.mjs';
import { readTruthFromFiles } from '../map-factory/map-io.mjs';
import { mirrorTruthToPostdb } from '../map-factory/postdb-sync.mjs';
import { mirrorDisplayPacksToPostdb } from '../visual-factory/postdb-sync.mjs';
import { readJson } from '../venue-io.mjs';
import {
  getHeadOutputsHash,
  getHeadRevisionId,
  outputsHash,
  usingPostdb,
} from '../postdb-io.mjs';

/**
 * @param {string} venueId
 * @returns {Record<string, { spec: object }>}
 */
export function displaySpecsFromBuilder(venueId) {
  const displayDir = path.join(BUILDER_VENUES, venueId, 'display');
  if (!existsSync(displayDir)) return {};
  const packs = {};
  for (const file of readdirSync(displayDir).sort()) {
    if (!file.endsWith('.visual.json')) continue;
    const skinId = file.slice(0, -'.visual.json'.length);
    const spec = readJson(path.join(displayDir, file));
    if (spec) packs[skinId] = { spec };
  }
  return packs;
}

/**
 * Ensure PostDB head matches shipped file truth; mirror display specs to that revision.
 *
 * @param {string} venueId
 * @returns {Promise<{ revisionId: string, created: boolean }|null>}
 */
export async function seedVenueFromFiles(venueId) {
  if (!usingPostdb()) return null;

  const truth = readTruthFromFiles(venueId);
  const hash = outputsHash({ map: truth.map, pois: truth.pois, gaps: truth.gaps });
  const headHash = await getHeadOutputsHash(venueId);

  let revisionId;
  let created = false;
  if (headHash === hash) {
    revisionId = await getHeadRevisionId(venueId);
    if (!revisionId) {
      ({ revisionId } = await mirrorTruthToPostdb(venueId, truth));
      created = true;
    }
  } else {
    ({ revisionId } = await mirrorTruthToPostdb(venueId, truth));
    created = true;
  }

  const packs = displaySpecsFromBuilder(venueId);
  if (Object.keys(packs).length) {
    await mirrorDisplayPacksToPostdb(venueId, packs, revisionId);
  }

  return { revisionId, created };
}
