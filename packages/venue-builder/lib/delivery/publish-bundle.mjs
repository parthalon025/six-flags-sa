/**
 * Delivery entry — export the current venue head to a hash-addressed manifest.
 */

import { readJson } from '../venue-io.mjs';
import { bundlePath, reindex, VENUE_DIR } from './delivery-io.mjs';

/**
 * @param {string} venueId
 * @param {{ preferredDefault?: string }} [opts]
 * @returns {import('../factory-types.mjs').CertifiableArtifact & { manifest: object, bundle: object|null }}
 */
export function publishBundle(venueId, opts = {}) {
  const manifest = reindex({ preferredDefault: opts.preferredDefault });
  const row = manifest.venues.find((v) => v.id === venueId) ?? null;
  const bundle = readJson(bundlePath(venueId));
  return {
    id: `${venueId}.bundle`,
    kind: 'artifact',
    path: bundlePath(venueId),
    certified: Boolean(bundle?.files?.length),
    manifest,
    bundle,
    generated: row?.generated ?? bundle?.basedOn?.map ?? null,
  };
}

export { VENUE_DIR };
