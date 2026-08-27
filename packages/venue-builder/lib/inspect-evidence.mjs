/**
 * Evidence review map paths for venues:inspect — serves validation output as-is.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OVERRIDE_DIR } from './venue-io.mjs';

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 */
export function evidenceReviewPath(venueId, opts = {}) {
  const base = opts.overrideDir || OVERRIDE_DIR;
  return path.join(base, venueId, 'evidence.html');
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {{ venueId: string, available: boolean }}
 */
export function evidenceReviewStatus(venueId, opts = {}) {
  const file = evidenceReviewPath(venueId, opts);
  return { venueId, available: existsSync(file) };
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {string | null}
 */
export function readEvidenceReviewHtml(venueId, opts = {}) {
  const file = evidenceReviewPath(venueId, opts);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

/**
 * @param {string} venueId
 */
export function renderEvidenceMissingPage(venueId) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${venueId} — evidence not generated</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 2rem; line-height: 1.5; color: #24292f; }
    p { color: #57606a; }
  </style>
</head>
<body>
  <h1>Evidence review map not generated</h1>
  <p>Venue <code>${venueId}</code> has no <code>evidence.html</code> sidecar yet. Run the validation stage to produce the evidence review map.</p>
</body>
</html>`;
}
