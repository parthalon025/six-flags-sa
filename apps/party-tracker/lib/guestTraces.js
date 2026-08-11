/**
 * Server-side store for anonymised guest walk traces.
 *
 * Traces never write public/venues JSON. They sit in Redis (or process memory
 * in dev) until an operator dumps them into data/venues/<id>.guest-traces-cache.json
 * for the venue builder's guest-traces adapter.
 */

import { redisCommand, usingRedis } from './serverStore.js';

const TRACE_TTL_S = 90 * 24 * 60 * 60; // 90 days
const MAX_PER_VENUE = 500;

const mem =
  globalThis.__kiGuestTraces ??
  (globalThis.__kiGuestTraces = {
    byVenue: new Map(), // venueId -> { traces: [], updatedAt }
  });

const listKey = (venueId) => `ki:guest-traces:${venueId}`;

export async function appendGuestTraces(traces) {
  const byVenue = new Map();
  for (const t of traces) {
    if (!t?.venueId) continue;
    if (!byVenue.has(t.venueId)) byVenue.set(t.venueId, []);
    byVenue.get(t.venueId).push(t);
  }

  let stored = 0;
  for (const [venueId, batch] of byVenue) {
    if (usingRedis) {
      const key = listKey(venueId);
      for (const trace of batch) {
        await redisCommand(['LPUSH', key, JSON.stringify(trace)]);
        stored += 1;
      }
      await redisCommand(['LTRIM', key, 0, MAX_PER_VENUE - 1]);
      await redisCommand(['EXPIRE', key, TRACE_TTL_S]);
    } else {
      const row = mem.byVenue.get(venueId) || { traces: [], updatedAt: 0 };
      for (const trace of batch) {
        row.traces.unshift(trace);
        stored += 1;
      }
      while (row.traces.length > MAX_PER_VENUE) row.traces.pop();
      row.updatedAt = Date.now();
      mem.byVenue.set(venueId, row);
    }
  }
  return { stored, venues: [...byVenue.keys()] };
}

export async function listGuestTraces(venueId, { limit = 100 } = {}) {
  const n = Math.min(Math.max(1, limit), MAX_PER_VENUE);
  if (!venueId) return [];

  if (usingRedis) {
    const rows = await redisCommand(['LRANGE', listKey(venueId), 0, n - 1]);
    return (rows || [])
      .map((raw) => {
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : raw;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  const row = mem.byVenue.get(venueId);
  return (row?.traces || []).slice(0, n);
}

export async function guestTraceStats(venueId) {
  if (usingRedis) {
    const len = await redisCommand(['LLEN', listKey(venueId)]);
    return { venueId, count: Number(len) || 0, backend: 'redis' };
  }
  const row = mem.byVenue.get(venueId);
  return { venueId, count: row?.traces?.length || 0, backend: 'memory' };
}

/** FeatureCollection for dumping into the builder cache. */
export function tracesToFeatureCollection(traces) {
  return {
    type: 'FeatureCollection',
    properties: {
      source: 'parkbound_guest_movement',
      exportedAt: new Date().toISOString(),
      count: traces.length,
    },
    features: traces.map((t) => ({
      type: 'Feature',
      properties: {
        kind: 'guest_trace',
        venueId: t.venueId,
        sessionId: t.id,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        metres: t.metres,
        pointCount: t.pointCount,
        receivedAt: t.receivedAt,
        source: 'parkbound_guest_movement',
      },
      geometry: {
        type: 'LineString',
        coordinates: (t.points || []).map((p) => [p.lng, p.lat]),
      },
    })),
  };
}
