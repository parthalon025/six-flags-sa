/**
 * Ride report → observation row mapping (E7.2).
 *
 * Pure transforms at the public seam: party ride down/open and queue-band taps
 * become the shared observation shape the #327 bridge posts.
 */

import { validateObservationAppend } from '@party-tracker/shared/observations.js';

/** Queue-band taps map to representative wait minutes (short / medium / long). */
export const QUEUE_BAND_WAIT_MIN = {
  short: 15,
  medium: 45,
  long: 90,
  confirmed: 15,
  changed: 45,
  issue: 90,
};

/**
 * @param {{ id?: string, venueId?: string, rideId?: string, placeId?: string, status?: string|null, ts?: number|string, authorId?: string, confidence?: string }} report
 * @returns {object|null}
 */
export function observationFromRideReport(report) {
  if (!report || typeof report !== 'object') return null;
  const status = report.status;
  if (status !== 'down' && status !== 'open') return null;

  const body = {
    id: report.id,
    venueId: report.venueId,
    placeId: report.placeId || report.rideId,
    ts: report.ts,
    status,
    source: 'party-report',
    confidence: report.confidence || 'low',
    authorId: report.authorId,
  };
  const parsed = validateObservationAppend(body);
  return parsed.ok ? parsed.observation : null;
}

/**
 * @param {{ id?: string, venueId?: string, rideId?: string, placeId?: string, band?: string, ts?: number|string, authorId?: string, confidence?: string }} report
 * @returns {object|null}
 */
export function observationFromQueueBandReport(report) {
  if (!report || typeof report !== 'object') return null;
  const band = String(report.band || '').trim();
  const waitMin = QUEUE_BAND_WAIT_MIN[band];
  if (waitMin == null) return null;

  const body = {
    id: report.id,
    venueId: report.venueId,
    placeId: report.placeId || report.rideId,
    ts: report.ts,
    waitMin,
    source: 'party-queue',
    confidence: report.confidence || 'low',
    authorId: report.authorId,
  };
  const parsed = validateObservationAppend(body);
  return parsed.ok ? parsed.observation : null;
}
