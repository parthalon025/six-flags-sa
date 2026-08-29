/**
 * Height rules beside the bundle — provenance and seasons without shipping
 * evidence to the phone.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson, venueSidecar } from './venue-io.mjs';
import { addressBook, resolveOverride } from './venue-ids.mjs';
import { atLeast } from './evidence.mjs';

const heightsFile = (id) => venueSidecar(id, 'heights.json');

const heightFromRule = (rule) => rule?.h ?? rule;

/**
 * Apply height rules from the sidecar onto places, keyed by name or id.
 *
 * `unresolved` names the rules that landed on nothing. They used to be silently
 * skipped, and that silence hid both readings of the same shape: a ride the park
 * still gates on that has fallen off the shipped map — invisible to a guest, its
 * height rule unable to reach anyone — and a ride that closed while its rule
 * stayed behind. Cedar Point's Snake River Falls was the second, and it took a
 * count assertion in an unrelated suite to notice at all (#30). A rule this
 * venue has retired belongs in `retired`, where it is neither applied nor lost.
 *
 * @returns {{ pois, applied: number, skipped: number, unresolved: string[] }}
 */
export function applyHeightsSidecar(pois, id) {
  const sidecar = readJson(heightsFile(id));
  if (!sidecar?.rules) return { pois, applied: 0, skipped: 0, unresolved: [] };
  const floor = sidecar.publish_at || 'moderate';
  const book = addressBook(pois);
  let applied = 0;
  let skipped = 0;
  const unresolved = [];
  for (const [key, rule] of Object.entries(sidecar.rules)) {
    const h = heightFromRule(rule);
    if (!h) continue;
    const band = rule.confidence || 'moderate';
    if (!atLeast(band, floor)) {
      skipped += 1;
      continue;
    }
    const targets = resolveOverride(book, key, rule) || [];
    if (!targets.length) {
      unresolved.push(key);
      continue;
    }
    for (const t of targets) {
      t.h = h;
      if (rule.note && !t.note) t.note = rule.note;
      applied += 1;
    }
  }
  return { pois, applied, skipped, unresolved };
}
