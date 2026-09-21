/**
 * Action-log → observation row bridge (E7.1).
 *
 * The local IndexedDB log records ride/wait facts; this module maps qualifying
 * entries to the shared observation shape and flushes them through the server
 * append seam. Never throws — callers fire on reconnect like questSync.
 */

import { validateObservationAppend } from '@party-tracker/shared/observations.js';

const QUALIFYING_KINDS = new Set(['ride', 'report', 'ride-status', 'queue']);

/**
 * @param {{ id?: string, ts?: number, kind?: string, detail?: object } | null | undefined} entry
 * @returns {object | null}
 */
export function observationFromActionLogEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const kind = String(entry.kind || '').trim();
  if (!QUALIFYING_KINDS.has(kind)) return null;

  const detail = entry.detail && typeof entry.detail === 'object' ? entry.detail : {};
  const source =
    detail.source ||
    (kind === 'queue' ? 'party-queue' : 'party-report');

  const body = {
    id: entry.id,
    venueId: detail.venueId,
    placeId: detail.placeId || detail.rideId,
    ts: entry.ts,
    waitMin: detail.waitMin ?? detail.wait,
    status: detail.status,
    source,
    confidence: detail.confidence || 'low',
    authorId: detail.authorId || detail.userId,
  };

  const parsed = validateObservationAppend(body);
  return parsed.ok ? parsed.observation : null;
}

/**
 * @param {{ load: () => Promise<object[]>, remove: (id: string) => Promise<void> }} queue
 * @param {{ append: (row: object) => Promise<unknown> }} upload
 * @returns {Promise<{ flushed: number, failed: number }>}
 */
export async function flushActionLog(queue, upload) {
  const result = { flushed: 0, failed: 0 };
  if (!queue || !upload) return result;
  let entries;
  try {
    entries = await queue.load();
  } catch {
    return result;
  }
  for (const entry of Array.isArray(entries) ? entries : []) {
    const row = observationFromActionLogEntry(entry);
    if (!row) continue;
    try {
      await upload.append(row);
      if (entry.id) await queue.remove(entry.id);
      result.flushed += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

/**
 * Browser-side upload helper — POST /api/observations with the shared shape.
 * @param {object} row
 * @param {{ fetch?: typeof fetch, origin?: string }} [opts]
 */
export async function postObservation(row, opts = {}) {
  const fetchFn = opts.fetch || globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('fetch unavailable');
  const origin = opts.origin || globalThis.window?.location?.origin || '';
  const res = await fetchFn(`${origin}/api/observations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `observation POST failed (${res.status})`);
  }
  return res.json();
}
