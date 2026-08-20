/**
 * Venue bundle manifest — the download contract (ADR-0018; ADR-0013 item 5).
 *
 * One venue is one bundle: the truth trio (`map` / `pois` / `gaps`) plus the
 * shipped display-pack files, each pinned by sha256 + bytes. The phone trusts
 * this one file — `/venues/<id>.bundle.json` — and downloads by it: a byte
 * that did not change hashes the same and is never fetched twice, which is
 * what keeps per-guest bandwidth at "what actually changed".
 *
 * Display files are deliberately not a hardcoded list. They are enumerated
 * from the display pack itself:
 *   - every tier row of the pack's `manifest.json` that names a file
 *     (vector `base.pmtiles` today; `world:<skin>` images when the world
 *     tier lands — new tiers ride in with no change here),
 *   - every per-Skin stage output on disk (`*.visual.json` / `*.style.json`),
 *   - the generic sidecar rule: a shipped binary's same-stem `.json` ships
 *     with it (`trail.world.png` → `trail.world.json`),
 *   - files a visual spec names by reference (`terrain.hillshade.file`).
 * Builder evidence (`display-certification.json`) and bake inputs
 * (`theme.json`) stay builder-side: the phone paints, it does not audit.
 *
 * Deliberately self-contained (fs + crypto only, no venue-io import):
 * `reindex()` calls into this module, and a cycle here would trip the
 * no-circular boundary.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

export const BUNDLE_VERSION = 1;

/** Lowercase hex sha256 — the address half of "hash-addressed". */
export const sha256Of = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Pure: one manifest row. `urlPath` is the URL the phone fetches — the
 * manifest speaks the deployed origin's language, not the builder's disk.
 */
export function bundleEntry(urlPath, buf) {
  return { path: urlPath, bytes: buf.length, sha256: sha256Of(buf) };
}

/**
 * Pure: which files a display tier manifest ships. Generic on purpose — any
 * tier row that names a file is a candidate, so a tier added by a future
 * pipeline stage flows into the bundle without touching this module. Gap
 * rows carry no file and enumerate to nothing.
 */
export function tierFileNames(tiers) {
  const names = Object.values(tiers?.tiers || {})
    .map((row) => row?.file)
    .filter((f) => typeof f === 'string' && f.length);
  return [...new Set(names)];
}

/**
 * Pure, deterministic: assemble the bundle manifest from named buffers.
 * Entries sort by path so a no-op rerun is byte-identical.
 *
 * @param {{ id: string, basedOn?: object|null, files: Map<string, Buffer> }} deps
 */
export function buildBundleManifest({ id, basedOn = null, files }) {
  const entries = [...files.entries()]
    .map(([urlPath, buf]) => bundleEntry(urlPath, buf))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return {
    version: BUNDLE_VERSION,
    venue: id,
    basedOn,
    bytes: entries.reduce((total, e) => total + e.bytes, 0),
    files: entries,
  };
}

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/**
 * The display-pack files that ship in the bundle, as basenames inside
 * `displayDir`. See the module comment for the enumeration contract; every
 * rule checks the file actually exists, so a tier recorded on a machine that
 * built it never smuggles an absent file into another machine's manifest.
 */
export function shippedDisplayFiles(displayDir) {
  if (!displayDir || !existsSync(displayDir)) return [];
  const names = new Set();

  const tiers = readJson(path.join(displayDir, 'manifest.json'));
  if (tiers) names.add('manifest.json');
  for (const name of tierFileNames(tiers)) {
    if (existsSync(path.join(displayDir, name))) names.add(name);
  }

  // Per-Skin stage outputs, from disk rather than a skin list: a new active
  // Skin is new files, not new code.
  for (const f of readdirSync(displayDir)) {
    if (f.endsWith('.visual.json') || f.endsWith('.style.json')) names.add(f);
  }

  // Sidecar rule: a shipped binary's same-stem .json rides with it.
  for (const name of [...names]) {
    const ext = path.extname(name);
    if (ext === '.json') continue;
    const sidecar = `${name.slice(0, -ext.length)}.json`;
    if (existsSync(path.join(displayDir, sidecar))) names.add(sidecar);
  }

  // Files a visual spec names by reference (the hillshade overlay).
  for (const name of [...names].filter((n) => n.endsWith('.visual.json'))) {
    const spec = readJson(path.join(displayDir, name));
    const hillshade = spec?.terrain?.hillshade?.file;
    if (hillshade && existsSync(path.join(displayDir, hillshade))) names.add(hillshade);
  }

  return [...names].sort();
}

/**
 * Read one venue's bundle files into `Map<urlPath, Buffer>`: the truth trio
 * from `venueDir` plus the shipped display files from `displayDir`. A file
 * that is not on disk is not in the bundle — the manifest never promises a
 * byte the origin cannot serve.
 */
export function collectVenueBundle(id, { venueDir, displayDir }) {
  const files = new Map();
  for (const kind of ['gaps', 'map', 'pois']) {
    const file = path.join(venueDir, `${id}.${kind}.json`);
    if (existsSync(file)) files.set(`/venues/${id}.${kind}.json`, readFileSync(file));
  }
  for (const name of shippedDisplayFiles(displayDir)) {
    files.set(`/venues/${id}/display/${name}`, readFileSync(path.join(displayDir, name)));
  }
  return files;
}

/**
 * Collect, pin, write. `generated` is the venue truth stamp the bundle is
 * based on (`map.meta.generated`) — the same pin the display packs carry, so
 * the freshness gate can hold every shipped artifact to one clock.
 *
 * @param {string} id venue id
 * @param {{ venueDir: string, displayDir?: string, outFile: string, generated?: string|null }} opts
 * @returns {object} the manifest written
 */
export function writeBundleManifest(id, { venueDir, displayDir, outFile, generated = null }) {
  const files = collectVenueBundle(id, { venueDir, displayDir });
  const basedOn = { map: generated ?? readJson(path.join(venueDir, `${id}.map.json`))?.meta?.generated ?? null };
  const manifest = buildBundleManifest({ id, basedOn, files });
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}
