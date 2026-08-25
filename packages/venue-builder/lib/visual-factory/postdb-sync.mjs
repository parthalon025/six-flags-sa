/**
 * PostDB sync — mirror compiled display packs to the factory bus.
 */

import {
  getHeadRevisionId,
  usingPostdb,
  writeDisplayPack,
} from '../postdb-io.mjs';

/**
 * Write each skin's compiled spec to PostDB, pinned to the venue truth head.
 *
 * @param {string} venueId
 * @param {Record<string, { spec: object }>} packs display stage packs keyed by skin id
 * @param {string} [revisionId] truth revision to pin; defaults to current head
 * @returns {Promise<Array<{ skinId: string, packId: string }>>}
 */
export async function mirrorDisplayPacksToPostdb(venueId, packs, revisionId) {
  if (!usingPostdb()) return [];

  const head = revisionId ?? await getHeadRevisionId(venueId);
  if (!head) {
    throw new Error(`Venue "${venueId}" has no published truth head in PostDB`);
  }

  const mirrored = [];
  for (const [skinId, pack] of Object.entries(packs)) {
    const { packId } = await writeDisplayPack(venueId, skinId, pack.spec, head);
    mirrored.push({ skinId, packId });
  }
  return mirrored;
}
