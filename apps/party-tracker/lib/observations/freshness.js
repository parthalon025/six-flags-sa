/**
 * Observation freshness by volatility class (E7.3).
 *
 * Status changes fast; waits drift; confirms and imports age slowly. The tier
 * drives green / yellow / red UI and gates the LIVE vocabulary — stale rows are
 * never labelled live.
 */

import { RIDE_REPORT_TTL_MS, RIDE_STALE_AFTER_MS } from '../core/state.js';

/** @typedef {'status' | 'wait' | 'dwell' | 'confirm' | 'import'} VolatilityClass */
/** @typedef {'fresh' | 'aging' | 'stale'} FreshnessTier */

const MIN = 60 * 1000;

/** Fresh / aging / TTL windows per volatility class (ms). */
export const STATUS_WINDOWS_MS = Object.freeze({
  status: Object.freeze({
    fresh: 15 * MIN,
    aging: RIDE_STALE_AFTER_MS,
    ttl: RIDE_REPORT_TTL_MS,
  }),
  wait: Object.freeze({
    fresh: 20 * MIN,
    aging: 45 * MIN,
    ttl: 120 * MIN,
  }),
  dwell: Object.freeze({
    fresh: 30 * MIN,
    aging: 60 * MIN,
    ttl: 180 * MIN,
  }),
  confirm: Object.freeze({
    fresh: 45 * MIN,
    aging: 90 * MIN,
    ttl: 240 * MIN,
  }),
  import: Object.freeze({
    fresh: 60 * MIN,
    aging: 120 * MIN,
    ttl: 360 * MIN,
  }),
});

const SOURCE_VOLATILITY = Object.freeze({
  'party-report': 'status',
  'party-queue': 'wait',
  dwell: 'dwell',
  confirm: 'confirm',
  import: 'import',
});

/**
 * @param {{ source?: string, waitMin?: number|null } | null | undefined} obs
 * @returns {VolatilityClass}
 */
export function volatilityForObservation(obs) {
  if (!obs) return 'status';
  if (obs.waitMin != null && Number.isFinite(obs.waitMin)) return 'wait';
  return SOURCE_VOLATILITY[obs.source] || 'status';
}

function parseTs(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const ms = Date.parse(String(raw));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {{ source?: string, ts?: number|string, waitMin?: number|null } | null | undefined} obs
 * @param {number} [now]
 * @returns {{
 *   tier: FreshnessTier,
 *   tone: 'ok' | 'warn' | 'bad',
 *   live: boolean,
 *   css: FreshnessTier,
 *   volatility: VolatilityClass,
 *   ageMs: number,
 * }}
 */
export function freshnessFor(obs, now = Date.now()) {
  const ts = parseTs(obs?.ts);
  if (!obs || ts == null) {
    return {
      tier: 'stale',
      tone: 'bad',
      live: false,
      css: 'stale',
      volatility: 'status',
      ageMs: Infinity,
    };
  }

  const ageMs = Math.max(0, now - ts);
  const volatility = volatilityForObservation(obs);
  const win = STATUS_WINDOWS_MS[volatility];

  if (ageMs >= win.ttl || ageMs >= win.aging) {
    return { tier: 'stale', tone: 'bad', live: false, css: 'stale', volatility, ageMs };
  }
  if (ageMs >= win.fresh) {
    return { tier: 'aging', tone: 'warn', live: true, css: 'aging', volatility, ageMs };
  }
  return { tier: 'fresh', tone: 'ok', live: true, css: 'fresh', volatility, ageMs };
}

/** Map an in-party ride report to the observation shape freshness reads. */
export function observationShapeFromReport(report, source = 'party-report') {
  if (!report || !Number.isFinite(report.ts)) return null;
  const row = { source, status: report.status, ts: report.ts };
  const wait = report.waitMin ?? report.wait;
  if (wait != null && Number.isFinite(wait)) row.waitMin = wait;
  return row;
}

const LIVE_KIND = Object.freeze({
  ride_status: 'LIVE · RIDE REPORT',
  queue_band: 'LIVE · QUEUE',
  amenity_outage: 'LIVE · AMENITY',
});

/**
 * Eyebrow copy for live quests — stale observations drop the LIVE prefix.
 *
 * @param {string} questId
 * @param {{ live?: boolean } | null | undefined} freshness
 */
export function liveKindFor(questId, freshness) {
  const base = LIVE_KIND[questId] || 'LIVE';
  if (freshness && !freshness.live) return base.replace(/^LIVE · /, '');
  return base;
}
