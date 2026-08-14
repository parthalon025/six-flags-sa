/**
 * Which contributions graduate into the batch consolidate queue (E0.5).
 * Shared by the admin export API, Databricks jobs, and Node consolidate.
 */

/** Kinds that never bake into builder inputs. */
export const EPHEMERAL_CONTRIBUTION_KINDS = Object.freeze([
  'experience',
  'status',
  'queue_band',
  'ride_status',
]);

const EPHEMERAL = new Set(EPHEMERAL_CONTRIBUTION_KINDS);

/**
 * @param {{ status?: string, kind?: string } | null | undefined} row
 * @returns {boolean}
 */
export function isDurableForConsolidate(row) {
  if (!row || row.status !== 'accepted') return false;
  const kind = String(row.kind || '');
  if (EPHEMERAL.has(kind)) return false;
  return kind.length > 0;
}

/**
 * @param {Array<object>} contributions
 * @returns {Array<object>}
 */
export function filterConsolidateExport(contributions) {
  return (contributions || []).filter(isDurableForConsolidate);
}

/**
 * Export envelope consumed by consolidate.mjs and Databricks gold exports.
 * @param {Array<object>} contributions
 * @param {{ runId?: string, exportedAt?: string }} [meta]
 */
export function buildConsolidateExport(contributions, meta = {}) {
  return {
    contributions: filterConsolidateExport(contributions),
    exportedAt: meta.exportedAt || new Date().toISOString(),
    runId: meta.runId || null,
  };
}
