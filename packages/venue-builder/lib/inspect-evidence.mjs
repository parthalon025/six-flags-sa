/**
 * Evidence review map paths for venues:inspect — serves validation output as-is.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OVERRIDE_DIR } from './venue-io.mjs';

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {string | null} resolved file path, or null when venueId escapes the tree
 */
export function resolveEvidenceReviewPath(venueId, opts = {}) {
  const base = path.resolve(opts.overrideDir || OVERRIDE_DIR);
  const file = path.resolve(base, venueId, 'evidence.html');
  if (!file.startsWith(`${base}${path.sep}`) && file !== base) return null;
  return file;
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 */
export function evidenceReviewPath(venueId, opts = {}) {
  return resolveEvidenceReviewPath(venueId, opts);
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {{ venueId: string, available: boolean }}
 */
export function evidenceReviewStatus(venueId, opts = {}) {
  const file = resolveEvidenceReviewPath(venueId, opts);
  if (!file) return { venueId, available: false };
  return { venueId, available: existsSync(file) };
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {string | null}
 */
export function readEvidenceReviewHtml(venueId, opts = {}) {
  const file = resolveEvidenceReviewPath(venueId, opts);
  if (!file || !existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

/**
 * @param {string} venueId
 */
export function renderEvidenceMissingPage(venueId) {
  const id = esc(venueId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${id} — evidence not generated</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #24292f; }
    p { color: #57606a; }
  </style>
</head>
<body>
  <h1>Evidence review map not generated</h1>
  <p>Venue <code>${id}</code> has no <code>evidence.html</code> sidecar yet. Run the validation stage to produce the evidence review map.</p>
</body>
</html>`;
}
