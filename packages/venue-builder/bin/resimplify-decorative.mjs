#!/usr/bin/env node
/**
 * Re-simplify decorative map layers already on disk without hitting Overpass.
 *
 * Walkable path/service/queue geometry is left alone — those feed the route
 * graph. Grass/wood/park/sea/parking/sand are fill-only and dominate Cedar Point
 * payload size; a coarser RDP pass shrinks park-wifi downloads without a full
 * rebuild.
 *
 * Writes through the app venues dir (builder output). Prefer a full
 * `venues:rebuild` with `--decorativeTolerance` when Overpass is available.
 *
 *   node packages/venue-builder/bin/resimplify-decorative.mjs
 *   node packages/venue-builder/bin/resimplify-decorative.mjs cedar-point --metres 4
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { simplify } from '../lib/geometry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const venuesDir = join(root, 'apps/party-tracker/public/venues');

const DECORATIVE = new Set(['grass', 'wood', 'park', 'sea', 'parking', 'sand']);

const args = process.argv.slice(2);
const metresIdx = args.indexOf('--metres');
const metres = metresIdx >= 0 ? Number(args[metresIdx + 1]) : 4;
const skip = new Set();
if (metresIdx >= 0) {
  skip.add(metresIdx);
  skip.add(metresIdx + 1);
}
const only = args.find((a, i) => !skip.has(i) && !a.startsWith('--'));

function simplifyFeature(f, tol) {
  if (!f?.r || !Array.isArray(f.r) || f.r.length < 3) return f;
  const next = simplify(f.r, tol);
  if (!next || next.length < 3) return f;
  if (next.length >= f.r.length) return f;
  return { ...f, r: next };
}

function processFile(file) {
  const id = file.replace(/\.map\.json$/, '');
  if (only && only !== id) return null;
  const path = join(venuesDir, file);
  const map = JSON.parse(readFileSync(path, 'utf8'));
  let before = 0;
  let after = 0;
  let changed = 0;
  for (const layer of DECORATIVE) {
    const list = map[layer];
    if (!Array.isArray(list) || !list.length) continue;
    before += JSON.stringify(list).length;
    map[layer] = list.map((f) => {
      const out = simplifyFeature(f, metres);
      if (out !== f) changed += 1;
      return out;
    });
    after += JSON.stringify(map[layer]).length;
  }
  if (!changed) return { id, changed: 0, before, after, bytes: 0 };
  const json = `${JSON.stringify(map)}\n`;
  writeFileSync(path, json);
  return { id, changed, before, after, bytes: json.length };
}

const files = readdirSync(venuesDir).filter((f) => f.endsWith('.map.json'));
const results = [];
for (const file of files) {
  const r = processFile(file);
  if (r) results.push(r);
}

for (const r of results) {
  if (!r.changed) {
    console.log(`${r.id}: no change at ${metres}m`);
    continue;
  }
  const saved = r.before - r.after;
  console.log(
    `${r.id}: ${r.changed} rings, decorative JSON ${r.before} → ${r.after} (−${saved} B), file ${r.bytes} B`,
  );
}
