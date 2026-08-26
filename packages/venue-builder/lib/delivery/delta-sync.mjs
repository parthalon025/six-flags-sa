/**
 * Delivery delta sync — `?since=<revision_id>` manifest filtering (ticket 17).
 *
 * The phone keeps using `planBundleSync` (hash match); this module is the
 * server-side query contract. When `since` names a known prior revision and
 * the head advanced, only changed or new files are returned.
 *
 * Spec: `.scratch/factories-to-app/issues/17-delivery-delta-api.md`
 */

/** Query param name for revision cursor sync. */
export const SINCE_QUERY = 'since';

/** Slice 1 stub removed — delta filtering is live. */
export const DELTA_STATUS = 'live';

/** @param {URLSearchParams|{ get(name: string): string|null }} searchParams */
export function parseSinceParam(searchParams) {
  const since = searchParams.get(SINCE_QUERY);
  if (!since) return { since: null, mode: 'full' };
  return { since, mode: 'delta' };
}

/** path → sha256 for a bundle manifest. */
export function bundleIndexFromManifest(manifest) {
  const index = new Map();
  for (const f of manifest?.files || []) {
    if (f?.path && f?.sha256) index.set(f.path, f.sha256);
  }
  return index;
}

/**
 * Pure: files whose hash changed or were added since `prior`.
 *
 * @param {{ files?: object[] }|null} current
 * @param {{ files?: object[] }|null} prior
 */
export function changedFiles(current, prior) {
  const priorIndex = bundleIndexFromManifest(prior);
  const priorPaths = new Set((prior?.files || []).map((f) => f.path));
  return (current?.files || []).filter((f) => {
    if (!f?.path || !f?.sha256) return false;
    if (!priorPaths.has(f.path)) return true;
    return priorIndex.get(f.path) !== f.sha256;
  });
}

/**
 * Pure: full or delta manifest for a sync request.
 *
 * @param {{ basedOn?: { revisionId?: string }, files?: object[] }|null} current
 * @param {{ since?: string|null, prior?: object|null, priorKnown?: boolean }} [opts]
 */
export function manifestForSync(current, { since = null, prior = null, priorKnown = true } = {}) {
  if (!current) return { mode: 'full', manifest: null };
  const headRevision = current.basedOn?.revisionId ?? null;
  if (!since) return { mode: 'full', manifest: current };
  if (!priorKnown || !prior) return { mode: 'full', manifest: current };
  if (headRevision && since === headRevision) {
    return { mode: 'delta', manifest: { ...current, files: [] }, upToDate: true };
  }
  const files = changedFiles(current, prior);
  return {
    mode: 'delta',
    manifest: { ...current, files },
    since,
    headRevision,
  };
}

/**
 * Files the client should sync for this bundle request.
 *
 * @param {{ files?: object[] }|null} bundle
 * @param {string|null} since
 * @param {{ files?: object[] }|null} [prior]
 * @param {boolean} [priorKnown]
 */
export function filesForSync(bundle, since, prior = null, priorKnown = true) {
  const { mode, manifest, upToDate } = manifestForSync(bundle, { since, prior, priorKnown });
  return {
    mode,
    stub: false,
    upToDate: Boolean(upToDate),
    files: manifest?.files ?? [],
  };
}
