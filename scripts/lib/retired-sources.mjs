/**
 * Source labels that were renamed and must not count twice.
 *
 * Commit a318e6c moved `osm_named_queue` to `osm_queue_name` and gave the old
 * label to a different detector. Evidence under the retired label is orphaned
 * and double-counts if left in place.
 */
export const RETIRED_SOURCES = new Set(['osm_named_queue']);

/** Drop evidence entries whose source label has been retired. */
export function purgeRetiredEvidence(record) {
  let changed = false;
  for (const slot of Object.values(record.features || {})) {
    if (!slot?.evidence?.length) continue;
    const next = slot.evidence.filter((e) => !RETIRED_SOURCES.has(e.source));
    if (next.length !== slot.evidence.length) {
      slot.evidence = next;
      changed = true;
    }
  }
  return changed;
}
