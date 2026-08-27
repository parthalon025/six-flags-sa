/**
 * Delivery entry — export the current venue head to a hash-addressed manifest.
 *
 * With DATABASE_URL: export from PostDB (ADR-0024). Without: read the
 * already-exported seed files (unit tests and flagship bundles).
 */

import path from 'node:path';
import { readJson } from '../venue-io.mjs';
import { usingPostdb } from '../postdb-io.mjs';
import { bundlePath, reindex, VENUE_DIR } from './delivery-io.mjs';
import { exportFromPostdb } from './export-from-postdb.mjs';

function readManifest(venueDir, opts) {
  if (opts.skipReindex) {
    return readJson(path.join(venueDir, 'manifest.json'), { venues: [] });
  }
  return reindex({ preferredDefault: opts.preferredDefault });
}

function artifact(venueId, { path: outPath, manifest, bundle, revisionId = null }) {
  const row = manifest?.venues?.find((v) => v.id === venueId) ?? null;
  return {
    id: `${venueId}.bundle`,
    kind: 'artifact',
    path: outPath,
    certified: Boolean(bundle?.files?.length),
    manifest,
    bundle,
    generated: row?.generated ?? bundle?.basedOn?.map ?? null,
    revisionId: revisionId ?? bundle?.basedOn?.revisionId ?? null,
  };
}

/**
 * @param {string} venueId
 * @param {{ preferredDefault?: string, skipReindex?: boolean, filesOnly?: boolean, venueDir?: string, displayDir?: string, outFile?: string }} [opts]
 * @returns {Promise<import('../factory-types.mjs').CertifiableArtifact & { manifest: object, bundle: object|null, revisionId: string|null }>}
 */
export async function publishBundle(venueId, opts = {}) {
  const venueDir = opts.venueDir || VENUE_DIR;
  const outPath = opts.outFile || path.join(venueDir, `${venueId}.bundle.json`);

  if (usingPostdb() && !opts.filesOnly) {
    const exported = await exportFromPostdb(venueId, opts);
    const manifest = readManifest(venueDir, opts);
    return artifact(venueId, {
      path: exported?.path || outPath,
      manifest,
      bundle: exported?.bundle ?? null,
      revisionId: exported?.revisionId ?? null,
    });
  }

  const manifest = readManifest(venueDir, opts);
  const bundle = readJson(outPath);
  return artifact(venueId, { path: outPath, manifest, bundle, revisionId: null });
}

export { VENUE_DIR };
