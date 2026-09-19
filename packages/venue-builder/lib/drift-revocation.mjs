/**
 * OSM drift → certification revocation (#400).
 *
 * When a fleet drift watch finds venues that would change on rebuild, stamp their
 * committed certification.json as revoked so drifted parks stop presenting as certified
 * until a human rebuilds and re-runs venues:certify.
 */

export const DRIFT_REVOCATION_REASON = 'osm_drift';
export const DRIFT_REVOCATION_SOURCE = 'venues:drift-watch';

/** @param {object|null|undefined} doc */
export function hasDriftRevocation(doc) {
  return doc?.revocation?.reason === DRIFT_REVOCATION_REASON;
}

/**
 * @param {object|null} prior committed certification.json (may be null)
 * @param {{ id: string, detectedAt: string, detail?: string, log?: string }} drift
 * @returns {object} updated certification document
 */
export function revokeCertificationFromDrift(prior, drift) {
  const detail = drift.detail
    || (drift.log ? drift.log.trim().slice(-240) : 'Rebuild dry-run would change shipped bundle');
  const base = prior && typeof prior === 'object'
    ? prior
    : {
      version: 1,
      venue: { id: drift.id },
      checks: [],
      bundleFingerprint: null,
      ask: null,
    };
  return {
    ...base,
    certified: false,
    certifiedAt: base.certifiedAt ?? null,
    revocation: {
      reason: DRIFT_REVOCATION_REASON,
      source: DRIFT_REVOCATION_SOURCE,
      detectedAt: drift.detectedAt,
      detail,
    },
  };
}

/**
 * Apply drift revocations for exactly the drifted rows in a drift-watch report.
 *
 * @param {{ rows?: Array<{ id: string, changed?: boolean, log?: string }>, generated?: string }} report
 * @param {{ detectedAt?: string, readCert: (id: string) => object|null, writeCert: (id: string, doc: object) => void }} io
 * @returns {{ revoked: string[], skipped: string[], alreadyRevoked: string[] }}
 */
export function applyDriftRevocations(report, io) {
  const detectedAt = io.detectedAt || report.generated || new Date().toISOString();
  const rows = Array.isArray(report.rows) ? report.rows : [];
  const revoked = [];
  const skipped = [];
  const alreadyRevoked = [];
  for (const row of rows) {
    if (!row?.id) continue;
    if (!row.changed) {
      skipped.push(row.id);
      continue;
    }
    const prior = io.readCert(row.id);
    if (hasDriftRevocation(prior) && prior?.certified === false) {
      alreadyRevoked.push(row.id);
      continue;
    }
    const next = revokeCertificationFromDrift(prior, {
      id: row.id,
      detectedAt,
      log: row.log,
    });
    io.writeCert(row.id, next);
    revoked.push(row.id);
  }
  return { revoked, skipped, alreadyRevoked };
}

/**
 * Preserve an OSM drift revocation on failed re-certify; drop it once checks pass.
 *
 * @param {object|null} prior committed certification.json
 * @param {{ certified: boolean } & Record<string, unknown>} doc freshly computed certification
 */
export function attachDriftRevocation(prior, doc) {
  if (doc.certified || !hasDriftRevocation(prior)) return doc;
  return { ...doc, revocation: prior.revocation };
}
