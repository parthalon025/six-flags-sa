/**
 * Sprite atlas — pack ledger icons into one content-addressed sheet.
 *
 * The atlas is an artifact, never a source: bin/display-atlas.mjs renders
 * it from the ledger's icon rows into a cache directory keyed by content
 * (same icons + same size + same packer version ⇒ same key ⇒ cache hit).
 * The layout is a plain shelf grid — deterministic, order-insensitive —
 * and the sprite index follows MapLibre's sprite-json shape so the vector
 * tier can reference `icon-image` names straight from the pack.
 */

import { createHash } from 'node:crypto';
import { assetContentHash } from './display-assets.mjs';

/** Bump when the packer's layout or rasterization changes meaning. */
export const ATLAS_VERSION = 1;

/**
 * Shelf-grid layout for a set of asset ids at one square frame size.
 * Pure: sorted ids in, identical plan out, whatever the input order.
 */
export function atlasPlan(ids, { px = 32 } = {}) {
  const sorted = [...new Set(ids)].sort();
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const frames = {};
  sorted.forEach((id, i) => {
    frames[id] = { x: (i % cols) * px, y: Math.floor(i / cols) * px, w: px, h: px };
  });
  return {
    px,
    width: cols * px,
    height: Math.ceil(sorted.length / cols) * px,
    frames,
  };
}

/**
 * MapLibre sprite index for a plan. Style names drop the `parkbound-`
 * prefix (styles say `badge-gate`, the ledger says `parkbound-badge-gate`).
 * Coordinates are in the rendered image's pixels, so a @2x sheet passes
 * `pixelRatio: 2` and every rect scales with it.
 */
export function mapLibreSpriteJson(plan, { pixelRatio = 1 } = {}) {
  const out = {};
  for (const [id, f] of Object.entries(plan.frames)) {
    out[id.replace(/^parkbound-/, '')] = {
      x: f.x * pixelRatio,
      y: f.y * pixelRatio,
      width: f.w * pixelRatio,
      height: f.h * pixelRatio,
      pixelRatio,
    };
  }
  return out;
}

/**
 * Content-addressed cache key: icon bytes + import settings + frame size
 * + packer version. Rebuild only when one of those moves.
 */
export function atlasCacheKey(ids, { ledger, px = 32, version = ATLAS_VERSION }) {
  const h = createHash('sha256');
  for (const id of [...new Set(ids)].sort()) {
    const row = ledger[id];
    if (!row) throw new Error(`Unknown asset id "${id}"`);
    h.update(id).update(assetContentHash(row, version)).update('\n');
  }
  h.update(`px:${px};v:${version}`);
  return h.digest('hex').slice(0, 16);
}
