/**
 * Height rules beside the bundle — provenance and seasons without shipping
 * evidence to the phone.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { addressBook, resolveOverride } from './venue-ids.mjs';
import { atLeast } from './evidence.mjs';

const heightsFile = (id) => path.join(OVERRIDE_DIR, `${id}.heights.json`);

const heightFromRule = (rule) => rule?.h ?? rule;

/** Apply height rules from the sidecar onto places, keyed by name or id. */
export function applyHeightsSidecar(pois, id) {
  const sidecar = readJson(heightsFile(id));
  if (!sidecar?.rules) return { pois, applied: 0, skipped: 0 };
  const floor = sidecar.publish_at || 'moderate';
  const book = addressBook(pois);
  let applied = 0;
  let skipped = 0;
  for (const [key, rule] of Object.entries(sidecar.rules)) {
    const h = heightFromRule(rule);
    if (!h) continue;
    const band = rule.confidence || 'moderate';
    if (!atLeast(band, floor)) {
      skipped += 1;
      continue;
    }
    const targets = resolveOverride(book, key, rule) || [];
    for (const t of targets) {
      t.h = h;
      if (rule.note && !t.note) t.note = rule.note;
      applied += 1;
    }
  }
  return { pois, applied, skipped };
}
