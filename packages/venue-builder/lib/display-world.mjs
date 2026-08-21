/**
 * World tier — the visual factory's baked Skin worlds, placed in the pack.
 *
 * ADR-0016: worlds are baked, overlays are live. For every active Skin whose
 * skins.json row names a `bakeKit`, the certified bake PNG moves INTO the
 * venue's display pack as `<skin>.world.png` plus a `<skin>.world.json`
 * sidecar (truth-derived bounds, projection, kit id, credits ref). The phone
 * draws the image on its truth bounds — the exact mechanism hillshade already
 * uses — under the live overlay. No tiling: venues are park-bbox scale.
 *
 * This tier is what retired lib/display-raster.mjs: the raster-PMTiles seam
 * recorded a permanent gap on every path, and ADR-0016 closes it with direct
 * image placement instead of a tiler.
 *
 * Publishing stays human-gated: buildWorldTier writes builder data only;
 * publishWorlds copies a named Skin's pack files (its baked world and its
 * visual spec) to the app's public/venues/<id>/display/ and the PR that
 * commits them is the gate.
 */

import path from 'node:path';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { APP_ROOT, readJson, venueSidecar, writeJson } from './venue-io.mjs';

export const WORLD_VERSION = 1;

/**
 * Projections a world may declare. `top-down` is the flat plate the app
 * places straight on truth bounds; `iso` names per-rotation images whose
 * app-side placement rides the iso pack tier (Phase C) — the sidecar shape
 * is fixed now so the app can already branch on it.
 */
export const WORLD_PROJECTIONS = ['top-down', 'iso'];

/**
 * Pure: one world's sidecar. Every coordinate it carries is the bake
 * model's crop-window bounds — derived from truth geometry by the bake,
 * echoed here, never invented (the no_repositioning rule's spirit for
 * files that must place an image).
 */
export function worldSidecar({ skin, kit, bounds, projection = 'top-down', file, credits = null }) {
  if (!WORLD_PROJECTIONS.includes(projection)) {
    throw new Error(`Unknown world projection "${JSON.stringify(projection)}"`);
  }
  if (!bounds || ![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) {
    throw new Error(`World "${skin}" has no truth-derived bounds — rebake with the current builder`);
  }
  return {
    version: WORLD_VERSION,
    skin,
    kit,
    projection,
    bounds,
    file,
    ...(credits ? { credits } : {}),
  };
}

/**
 * Build the world tier for one venue: for each active Skin bound to a
 * bakeKit, place that kit's bake into the pack as `<skin>.world.png` +
 * `<skin>.world.json`. A Skin whose kit has not baked (or whose cert
 * carries no bounds) is a recorded gap, never a silent absence.
 *
 * @param {{ id: string, templates: object, bakeDir: string,
 *           bakeCerts: {kit: string, cert: object}[], outDir: string, write?: boolean }} deps
 * @returns {{ entries: object[], worlds: object, written: string[] }}
 *   entries feed tierManifest (`world:<skin>` rows); worlds maps skin → sidecar.
 */
export function buildWorldTier({ id, templates, bakeDir, bakeCerts, outDir, write = true }) {
  const certByKit = new Map(bakeCerts.map(({ kit, cert }) => [kit, cert]));
  const entries = [];
  const worlds = {};
  const written = [];
  const bound = Object.keys(templates).sort()
    .map((skinId) => templates[skinId])
    .filter((t) => t.status === 'active' && t.bakeKit);
  for (const template of bound) {
    const skin = template.id;
    const kit = template.bakeKit;
    const name = `world:${skin}`;
    const cert = certByKit.get(kit);
    const bakePng = path.join(bakeDir, `${id}--${kit}.png`);
    if (!cert || !existsSync(bakePng)) {
      entries.push({ name, gap: true, reason: `kit "${kit}" not baked — run venues:bake first` });
      continue;
    }
    if (!cert.bounds) {
      entries.push({ name, gap: true, reason: `bake of "${kit}" carries no geo bounds — rebake with the current builder` });
      continue;
    }
    const file = `${skin}.world.png`;
    const creditsName = `${id}--${kit}.credits.json`;
    const sidecar = worldSidecar({
      skin,
      kit,
      bounds: cert.bounds,
      projection: 'top-down',
      file,
      credits: existsSync(path.join(bakeDir, creditsName)) ? creditsName : null,
    });
    worlds[skin] = sidecar;
    if (write) {
      mkdirSync(outDir, { recursive: true });
      const pngOut = path.join(outDir, file);
      copyFileSync(bakePng, pngOut);
      written.push(pngOut);
      const sidecarFile = path.join(outDir, `${skin}.world.json`);
      writeJson(sidecarFile, sidecar, true);
      written.push(sidecarFile);
    }
    entries.push({
      name,
      file: path.join(outDir, file),
      meta: { kit, projection: sidecar.projection, certified: Boolean(cert.certified) },
    });
  }
  // fileEntry-shaped: resolve bytes for real files so tierManifest can list sizes.
  return {
    entries: entries.map((e) => (e.file && existsSync(e.file)
      ? { name: e.name, file: path.basename(e.file), bytes: statSync(e.file).size, meta: e.meta }
      : e.file
        ? { name: e.name, gap: true, reason: `${path.basename(e.file)} not built` }
        : e)),
    worlds,
    written,
  };
}

/**
 * Copy a Skin's pack files from a venue's display pack into the app's public
 * venue directory. Deliberately minimal and explicit: the caller names the
 * Skins the app actually consumes, and the PR committing the copies is the
 * gate.
 *
 * Two kinds of file travel. The baked world (`<skin>.world.png` plus its
 * sidecar) is what the phone draws instead of the OSM base. The visual spec
 * (`<skin>.visual.json`) is what the phone reads to paint Zones in this
 * Skin's own colours — the Visual factory's answer, published rather than
 * re-derived in app code. A Skin with neither is reported missing rather
 * than silently skipped; a Palette with a spec but no bake publishes its
 * spec alone, which is exactly what Trail and Park Midnight need.
 *
 * `kinds` narrows what travels — a spec is a few kilobytes and a baked world
 * is megabytes, so publishing a Skin's tones must not drag a re-bake along
 * with it.
 *
 * @param {string} id venue id
 * @param {string[]} skinIds skins whose pack files publish
 * @param {{ outDir?: string, publicDir?: string, kinds?: ('spec'|'world')[] }} [opts]
 * @returns {{ published: string[], missing: string[] }}
 */
export function publishWorlds(id, skinIds, opts = {}) {
  const outDir = opts.outDir || venueSidecar(id, 'display');
  const publicDir = opts.publicDir || path.join(APP_ROOT, 'public', 'venues', id, 'display');
  const kinds = new Set(opts.kinds?.length ? opts.kinds : ['spec', 'world']);
  const published = [];
  const missing = [];
  for (const skin of skinIds) {
    const names = [];
    if (kinds.has('spec') && existsSync(path.join(outDir, `${skin}.visual.json`))) {
      names.push(`${skin}.visual.json`);
    }
    const sidecar = kinds.has('world') ? readJson(path.join(outDir, `${skin}.world.json`), null) : null;
    if (sidecar && existsSync(path.join(outDir, sidecar.file))) {
      names.push(`${skin}.world.json`, sidecar.file);
    }
    if (!names.length) {
      missing.push(skin);
      continue;
    }
    mkdirSync(publicDir, { recursive: true });
    for (const name of names) {
      const dest = path.join(publicDir, name);
      copyFileSync(path.join(outDir, name), dest);
      published.push(dest);
    }
  }
  return { published, missing };
}
