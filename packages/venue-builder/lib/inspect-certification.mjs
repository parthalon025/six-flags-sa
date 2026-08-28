/**
 * Certification dashboard data for venues:inspect — reads certification.json
 * sidecars and renders markdown via the certify module (#424).
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OVERRIDE_DIR, readJson } from './venue-io.mjs';
import { renderCertificationMarkdown } from './certification-markdown.mjs';
import { readManifest } from '../src/compare.mjs';
import { MANIFEST_FILE } from '../src/paths.mjs';

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 * @returns {string | null}
 */
export function certificationFilePath(venueId, opts = {}) {
  const base = path.resolve(opts.overrideDir || OVERRIDE_DIR);
  const file = path.resolve(base, venueId, 'certification.json');
  if (!file.startsWith(`${base}${path.sep}`) && file !== base) return null;
  return file;
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 */
export function readCertificationDoc(venueId, opts = {}) {
  const file = certificationFilePath(venueId, opts);
  if (!file || !existsSync(file)) return null;
  return readJson(file, null);
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 */
export function certificationVenueSummary(venueId, opts = {}) {
  const doc = readCertificationDoc(venueId, opts);
  if (!doc) {
    return {
      venueId,
      name: venueId,
      available: false,
      certified: false,
      blockingChecks: [],
      blockingAsks: [],
      checksPassed: 0,
      checksTotal: 0,
    };
  }
  const checks = doc.checks || [];
  const blockingChecks = checks.filter((c) => !c.pass).map((c) => c.key);
  const blockingAsks = (doc.ask?.requests || []).filter((r) => r.blocking);
  return {
    venueId: doc.venue?.id || venueId,
    name: doc.venue?.name || venueId,
    available: true,
    certified: Boolean(doc.certified),
    blockingChecks,
    blockingAsks: blockingAsks.map(({ key, need, why }) => ({ key, need, why })),
    checksPassed: checks.filter((c) => c.pass).length,
    checksTotal: checks.length,
  };
}

/**
 * @param {{ overrideDir?: string, manifestPath?: string }} [opts]
 */
export function certificationDashboard(opts = {}) {
  const manifestFile = opts.manifestPath || MANIFEST_FILE;
  const manifest = existsSync(manifestFile)
    ? JSON.parse(readFileSync(manifestFile, 'utf8'))
    : readManifest();
  const venues = (manifest.venues || []).map((v) =>
    certificationVenueSummary(v.id, opts),
  );
  const certified = venues.filter((v) => v.available && v.certified).length;
  const uncertified = venues.filter((v) => v.available && !v.certified).length;
  const missing = venues.filter((v) => !v.available).length;
  return {
    total: venues.length,
    certified,
    uncertified,
    missing,
    venues,
  };
}

/**
 * @param {string} venueId
 * @param {{ overrideDir?: string }} [opts]
 */
export function certificationDetail(venueId, opts = {}) {
  const doc = readCertificationDoc(venueId, opts);
  if (!doc) {
    return { venueId, available: false, certified: false, markdown: null };
  }
  return {
    venueId: doc.venue?.id || venueId,
    available: true,
    certified: Boolean(doc.certified),
    markdown: renderCertificationMarkdown(doc),
    summary: certificationVenueSummary(venueId, opts),
  };
}
