'use client';

/**
 * Side Quests' outbox → the durable contributions API (E9.1). The one place
 * a queued report gets a second chance: `questQueue.js` fills the outbox and
 * never re-reads it; this is the reader. A flush walks every pending report,
 * re-tries the same upload seam `handleContribution` uses, and only removes
 * a report once the server has actually accepted it — keyed by the report's
 * own id, so a repeat flush after a partial failure re-sends the same id
 * instead of minting a duplicate.
 *
 * Never throws. A caller fires this on mount, on sign-in, or on the browser
 * regaining a network signal, and does not want a network hiccup to become
 * an unhandled rejection.
 */

import { STATUS_PENDING } from './questQueue.js';
import { contributionFromGapSubmit, FIELD_TYPES } from '../overlay.js';

/** Only Overlay's durable Field Research kinds sync here. Live Ride reports
 *  (`ride_status`, `queue_band`) already went over the party mesh at submit
 *  time — the contributions API rejects them as ephemeral, so there is
 *  nothing for this flush to retry. */
const SYNCABLE_KINDS = new Set(FIELD_TYPES);

function contributionFor(report) {
  if (!report || !SYNCABLE_KINDS.has(report.kind)) return null;
  return contributionFromGapSubmit({
    id: report.id,
    type: report.kind,
    placeId: report.placeId,
    venueId: report.venueId,
    authorId: report.userId,
    payload: report.payload,
    lat: report.lat,
    lng: report.lng,
    now: report.createdAt,
  });
}

/**
 * @param {{ load: () => Promise<object[]>, remove: (id: string) => Promise<void> }} queue
 * @param {{ enqueue: (contribution: object) => Promise<unknown> }} upload
 * @returns {Promise<{ flushed: number, failed: number }>}
 */
export async function flushQuestQueue(queue, upload) {
  const result = { flushed: 0, failed: 0 };
  if (!queue || !upload) return result;
  let reports;
  try {
    reports = await queue.load();
  } catch {
    return result;
  }
  for (const report of Array.isArray(reports) ? reports : []) {
    if (report?.status !== STATUS_PENDING) continue;
    const contribution = contributionFor(report);
    if (!contribution) continue;
    try {
      await upload.enqueue(contribution);
      await queue.remove(report.id);
      result.flushed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
