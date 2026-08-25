/**
 * Delivery delta sync — Slice 1 stub (ticket 16).
 *
 * Ticket 17 implements `?since=<revision_id>` filtering. Until then the
 * Delivery origin always answers with the full hash-addressed bundle.
 * The phone keeps using `planBundleSync` (hash match); this module is the
 * server-side query contract only.
 *
 * Spec: `.scratch/factories-to-app/issues/16-delivery-export-slice1.md`
 * Follow-up: `.scratch/factories-to-app/issues/17-delivery-delta-api.md`
 */

/** Query param name for ticket 17. */
export const SINCE_QUERY = 'since';

/** Slice 1 always returns the full file list. */
export const DELTA_STATUS = 'stub';

/**
 * @param {URLSearchParams} searchParams
 * @returns {{ since: string|null, mode: 'full', stub?: true }}
 */
export function parseSinceParam(searchParams) {
  const since = searchParams.get(SINCE_QUERY);
  if (!since) return { since: null, mode: 'full' };
  return { since, mode: 'full', stub: true };
}

/**
 * Files the client should sync. Ticket 17 will return a subset when `since`
 * is a known prior revision; Slice 1 always returns the full list.
 *
 * @param {{ files?: object[] }|null} bundle
 * @param {string|null} since
 * @returns {{ mode: 'full', stub: boolean, files: object[] }}
 */
export function filesForSync(bundle, since) {
  return {
    mode: 'full',
    stub: Boolean(since),
    files: bundle?.files ?? [],
  };
}
