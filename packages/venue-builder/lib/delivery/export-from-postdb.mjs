/**
 * Delivery export — PostDB head → hash-addressed phone bundle (ADR-0024).
 *
 * The factory program writes; the app program only reads the exported
 * `/venues/<id>.bundle.json` contract. Binaries still on disk ride along
 * until artifact_blobs storage_uri is filled (same-origin URLs for now).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { serializeVenue } from '../venue-io.mjs';
import {
  listDisplayPacks,
  readTruth,
  registerArtifactBlobs,
  usingPostdb,
} from '../postdb-io.mjs';
import { buildBundleManifest, shippedDisplayFiles } from '../venue-bundle.mjs';
import { bundlePath, VENUE_DIR } from './delivery-io.mjs';

function truthBuffers(venueId, map, pois, gaps) {
  const meta = map?.meta ?? { id: venueId };
  const { meta: _ignored, ...layers } = map || {};
  const bytes = serializeVenue({ meta, map: layers, pois, gaps });
  return {
    map: Buffer.from(bytes.map),
    pois: Buffer.from(bytes.pois),
    gaps: Buffer.from(bytes.gaps),
  };
}

/**
 * Pure: assemble the phone bundle from factory artifacts.
 *
 * @param {{
 *   venueId: string,
 *   revisionId: string,
 *   generated?: string|null,
 *   map: object,
 *   pois: object[],
 *   gaps?: object|null,
 *   displaySpecs?: Record<string, object>,
 *   extraFiles?: Map<string, Buffer>,
 * }} input
 */
export function assembleExportBundle({
  venueId,
  revisionId,
  generated = null,
  map,
  pois,
  gaps = null,
  displaySpecs = {},
  extraFiles = new Map(),
}) {
  const stamp = generated ?? map?.meta?.generated ?? null;
  const basedOn = { map: stamp, revisionId };
  const files = new Map();
  const bufs = truthBuffers(venueId, map, pois, gaps);
  files.set(`/venues/${venueId}.map.json`, bufs.map);
  files.set(`/venues/${venueId}.pois.json`, bufs.pois);
  files.set(`/venues/${venueId}.gaps.json`, bufs.gaps);
  for (const [skinId, spec] of Object.entries(displaySpecs)) {
    files.set(
      `/venues/${venueId}/display/${skinId}.visual.json`,
      Buffer.from(`${JSON.stringify(spec, null, 2)}\n`),
    );
  }
  for (const [urlPath, buf] of extraFiles) {
    if (!files.has(urlPath)) files.set(urlPath, buf);
  }
  return {
    basedOn,
    files,
    bundle: buildBundleManifest({ id: venueId, basedOn, files }),
  };
}

function extraDisplayFiles(venueId, displayDir) {
  const extra = new Map();
  for (const name of shippedDisplayFiles(displayDir)) {
    if (name.endsWith('.visual.json')) continue;
    extra.set(
      `/venues/${venueId}/display/${name}`,
      readFileSync(path.join(displayDir, name)),
    );
  }
  return extra;
}

/**
 * Export the published PostDB head to the wear-time origin directory.
 *
 * @param {string} venueId
 * @param {{ venueDir?: string, displayDir?: string, outFile?: string }} [opts]
 * @returns {Promise<{ revisionId: string, basedOn: object, bundle: object, files: Map<string, Buffer>, written: string[] }|null>}
 */
export async function exportFromPostdb(venueId, opts = {}) {
  if (!usingPostdb()) return null;

  const venueDir = opts.venueDir || VENUE_DIR;
  const displayDir = opts.displayDir || path.join(venueDir, venueId, 'display');
  const outFile = opts.outFile || path.join(venueDir, `${venueId}.bundle.json`);

  const truth = await readTruth(venueId);
  const packs = await listDisplayPacks(venueId);
  const displaySpecs = Object.fromEntries(packs.map((p) => [p.skinId, p.body]));
  const extraFiles = existsSync(displayDir) ? extraDisplayFiles(venueId, displayDir) : new Map();

  const assembled = assembleExportBundle({
    venueId,
    revisionId: truth.revisionId,
    generated: truth.generated ?? truth.map?.meta?.generated ?? null,
    map: truth.map,
    pois: truth.pois,
    gaps: truth.gaps,
    displaySpecs,
    extraFiles,
  });

  const written = [];
  for (const [urlPath, buf] of assembled.files) {
    const dest = path.join(venueDir, urlPath.replace(/^\/venues\//, ''));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    written.push(dest);
  }
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(assembled.bundle, null, 2)}\n`);
  written.push(outFile);

  await registerArtifactBlobs(
    venueId,
    assembled.bundle.files.map((entry) => ({
      path: entry.path,
      sha256: entry.sha256,
      bytes: entry.bytes,
      storageUri: entry.path,
    })),
  );

  return {
    revisionId: truth.revisionId,
    basedOn: assembled.basedOn,
    bundle: assembled.bundle,
    files: assembled.files,
    written,
    path: outFile,
  };
}

export { bundlePath, VENUE_DIR };
