/**
 * Human review gate — recorded approvals write back to sidecars.
 *
 * Wave 4: the model proposes; a person decides; the decision becomes data.
 */

import path from 'node:path';
import { OVERRIDE_DIR, readJson, writeJson } from './venue-io.mjs';

export const REVIEW_FILE = (id) => path.join(OVERRIDE_DIR, `${id}.review.json`);

/**
 * Record an approval or rejection for a claim key.
 */
export function recordReview(venueId, { key, decision, who, why, claimType = 'general' }) {
  if (!['approve', 'reject'].includes(decision)) {
    throw new Error(`decision must be approve or reject, got "${decision}"`);
  }
  const file = REVIEW_FILE(venueId);
  const doc = readJson(file, {
    version: 1,
    venue: venueId,
    decisions: [],
  });
  doc.decisions.push({
    key,
    claimType,
    decision,
    who: who || 'maintainer',
    why: why || '',
    at: new Date().toISOString(),
  });
  doc.updated = new Date().toISOString();
  writeJson(file, doc, true);
  return doc;
}

/** Whether every required review key is approved. */
export function reviewGatePassed(venueId, requiredKeys = []) {
  const doc = readJson(REVIEW_FILE(venueId), { decisions: [] });
  const approved = new Set(
    doc.decisions.filter((d) => d.decision === 'approve').map((d) => d.key),
  );
  const rejected = doc.decisions.filter((d) => d.decision === 'reject').map((d) => d.key);
  if (rejected.length) return { pass: false, reason: `rejected: ${rejected.join(', ')}` };
  if (!requiredKeys.length) return { pass: true };
  const missing = requiredKeys.filter((k) => !approved.has(k));
  return missing.length
    ? { pass: false, reason: `awaiting approval: ${missing.join(', ')}` }
    : { pass: true };
}

/** Merge certification failures into required review keys for uncertified parks. */
export function requiredKeysFromCertification(cert) {
  if (cert?.certified) return [];
  return (cert?.checks || []).filter((c) => !c.pass).map((c) => `certify-${c.key}`);
}
