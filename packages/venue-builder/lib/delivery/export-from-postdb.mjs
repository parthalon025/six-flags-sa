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
  readTruthAtRevision,
  listDisplayPacksAtRevision,
  revisionExists,
} from '../postdb-io.mjs';
import { buildBundleManifest, shippedDisplayFiles } from '../venue-bundle.mjs';
import { bundlePath, VENUE_DIR } from './delivery-io.mjs';

const TRUTH_KINDS = ['map', 'pois', 'gaps'];

function truthUrlPaths(venueId) {
  return new Set(TRUTH_KINDS.map((kind) => `/venues/${venueId}.${kind}.json`));
}

/**
 * Pin bundle hashes to the bytes already on disk when the truth trio is shipped.
 *
 * A manifest's hashes must describe the bytes the *origin will serve*, and for the
 * truth trio the origin serves `public/venues/<id>.<kind>.json` verbatim. Rebuilding
 * those bytes from PostDB cannot reproduce them: `map_body` / `pois_body` / `gaps_body`
 * are JSONB, and JSONB does not preserve object key order — it normalises keys to
 * (length, then bytewise). A shipped POI reads `{i, n, lat, lng, c, a}` on disk and
 * `{a, c, i, n, lat, lng}` out of the column, so `serializeVenue` over a round-tripped
 * body yields the same key set, near-identical length, and a completely different
 * sha256. A phone that fetched the disk file would hash it, mismatch the pin, and
 * refuse to commit the manifest — permanently, since the next launch replans the same way.
 *
 * Apply this to a **head** assembly only. Overlaying disk bytes onto a *prior* revision
 * would make prior and current truth hash alike and hide a genuine truth change from the
 * delta, which is the opposite failure: the phone would stop re-fetching updated truth.
 */
export function overlayShippedTruthBytes(venueId, venueDir, assembled) {
  const files = new Map(assembled.files);
  for (const kind of TRUTH_KINDS) {
    const diskPath = path.join(venueDir, `${venueId}.${kind}.json`);
    if (!existsSync(diskPath)) continue;
    files.set(`/venues/${venueId}.${kind}.json`, readFileSync(diskPath));
  }
  return {
    ...assembled,
    files,
    bundle: buildBundleManifest({
      id: venueId,
      basedOn: assembled.basedOn,
      files,
    }),
  };
}

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
 * Assemble the phone bundle for a truth revision without writing to disk.
 *
 * @param {string} venueId
 * @param {string} revisionId
 * @param {{ displayDir?: string, extraFiles?: Map<string, Buffer> }} [opts]
 */
export async function assembleBundleAtRevision(venueId, revisionId, opts = {}) {
  const truth = await readTruthAtRevision(venueId, revisionId);
  if (!truth) return null;
  const packs = await listDisplayPacksAtRevision(venueId, revisionId);
  const displaySpecs = Object.fromEntries(packs.map((p) => [p.skinId, p.body]));
  const displayDir = opts.displayDir || path.join(VENUE_DIR, venueId, 'display');
  const extraFiles = opts.extraFiles ?? (existsSync(displayDir) ? extraDisplayFiles(venueId, displayDir) : new Map());
  return assembleExportBundle({
    venueId,
    revisionId: truth.revisionId,
    generated: truth.generated ?? truth.map?.meta?.generated ?? null,
    map: truth.map,
    pois: truth.pois,
    gaps: truth.gaps,
    displaySpecs,
    extraFiles,
  });
}

export { revisionExists, readTruthAtRevision, listDisplayPacksAtRevision };

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

  const assembled = overlayShippedTruthBytes(
    venueId,
    venueDir,
    assembleExportBundle({
      venueId,
      revisionId: truth.revisionId,
      generated: truth.generated ?? truth.map?.meta?.generated ?? null,
      map: truth.map,
      pois: truth.pois,
      gaps: truth.gaps,
      displaySpecs,
      extraFiles,
    }),
  );

  const skipWrite = truthUrlPaths(venueId);
  const written = [];
  for (const [urlPath, buf] of assembled.files) {
    const dest = path.join(venueDir, urlPath.replace(/^\/venues\//, ''));
    if (skipWrite.has(urlPath) && existsSync(dest)) continue;
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
