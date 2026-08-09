/**
 * Height rules beside the bundle — provenance and seasons without shipping
 * evidence to the phone.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { addressBook, resolveOverride } from './venue-ids.mjs';

const heightsFile = (id) => path.join(OVERRIDE_DIR, `${id}.heights.json`);

/** Apply height rules from the sidecar onto places, keyed by name or id. */
export function applyHeightsSidecar(pois, id) {
  const sidecar = readJson(heightsFile(id));
  if (!sidecar?.rules) return { pois, applied: 0 };
  const book = addressBook(pois);
  let applied = 0;
  for (const [key, rule] of Object.entries(sidecar.rules)) {
    const targets = resolveOverride(book, key, rule) || [];
    for (const t of targets) {
      t.h = rule.h ?? rule;
      applied += 1;
    }
  }
  return { pois, applied };
}
