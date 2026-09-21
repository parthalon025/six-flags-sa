'use client';

/**
 * Ride-report observations: queue locally, flush when online (E7.2).
 *
 * Mirrors questSync — never throws; callers fire on report and on `online`.
 */

import { newMemberId } from '../core/ids.js';
import { flushActionLog, postObservation } from './bridge.js';
import { observationFromRideReport, observationFromQueueBandReport } from './rideReport.js';

/**
 * In-memory/test stand-in for actionLog when IndexedDB is unavailable.
 * Production uses createActionLogQueue() below.
 */
export function createMemoryRideReportQueue() {
  let entries = [];
  return {
    async load() {
      return [...entries].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    },
    async append(entry) {
      if (entries.some((e) => e.id === entry.id)) return;
      entries.push(entry);
    },
    async remove(id) {
      entries = entries.filter((e) => e.id !== id);
    },
  };
}

/**
 * @returns {Promise<{ load: () => Promise<object[]>, append: (entry: object) => Promise<void>, remove: (id: string) => Promise<void> }>}
 */
export async function createActionLogQueue() {
  const { load, append, remove } = await import('../actionLog.js');
  return { load, append, remove };
}

function entryFromRideReport(params) {
  const id = params.id || `obs_${newMemberId()}`;
  const ts = params.ts ?? Date.now();
  if (params.waitMin != null || params.band) {
    const row = observationFromQueueBandReport({ ...params, id, ts });
    if (!row) return null;
    return {
      id,
      ts,
      kind: 'queue',
      detail: {
        venueId: row.venueId,
        placeId: row.placeId,
        waitMin: row.waitMin,
        source: row.source,
        confidence: row.confidence,
        authorId: row.authorId,
      },
    };
  }
  const row = observationFromRideReport({ ...params, id, ts });
  if (!row) return null;
  return {
    id,
    ts,
    kind: 'ride',
    detail: {
      venueId: row.venueId,
      placeId: row.placeId,
      status: row.status,
      source: row.source,
      confidence: row.confidence,
      authorId: row.authorId,
    },
  };
}

/**
 * Queue a ride or queue-band report and try to post immediately.
 * @param {object} params
 * @param {{ queue?: object, append?: (row: object) => Promise<unknown>, fetch?: typeof fetch, origin?: string }} [opts]
 */
export async function recordRideReportObservation(params, opts = {}) {
  const entry = entryFromRideReport(params);
  if (!entry) return { queued: false, posted: false };

  const queue = opts.queue || (await createActionLogQueue());
  try {
    await queue.append(entry);
  } catch {
    // Duplicate id — entry already queued; still try to post.
  }

  const upload = opts.append || ((row) => postObservation(row, opts));
  try {
    const row =
      entry.kind === 'queue'
        ? observationFromQueueBandReport({ ...params, id: entry.id, ts: entry.ts })
        : observationFromRideReport({ ...params, id: entry.id, ts: entry.ts });
    if (!row) return { queued: true, posted: false };
    await upload(row);
    await queue.remove(entry.id);
    return { queued: true, posted: true };
  } catch {
    return { queued: true, posted: false };
  }
}

/**
 * @param {{ queue?: object, append?: (row: object) => Promise<unknown>, fetch?: typeof fetch, origin?: string }} [opts]
 */
export async function flushRideReportObservations(opts = {}) {
  const queue = opts.queue || (await createActionLogQueue());
  const upload = opts.append || ((row) => postObservation(row, opts));
  return flushActionLog(queue, { append: upload });
}
