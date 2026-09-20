/**
 * Observation persistence — Postgres when DATABASE_URL is set, else in-memory.
 * Append-only: no update or delete paths.
 */

import { usingPostgres, getPool } from '../db/postgres.js';

const mem =
  globalThis.__parkboundObservations ??
  (globalThis.__parkboundObservations = {
    rows: new Map(),
  });

const HEX = '0123456789abcdef';

function newId(prefix) {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  let out = prefix;
  for (let i = 0; i < 8; i += 1) out += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return out;
}

function rowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    venueId: row.venue_id ?? row.venueId,
    placeId: row.place_id ?? row.placeId,
    ts: (row.ts ?? row.created_at)?.toISOString?.() || String(row.ts ?? row.created_at ?? ''),
    waitMin: row.wait_min ?? row.waitMin ?? undefined,
    status: row.status ?? undefined,
    source: row.source,
    confidence: row.confidence,
    authorId: row.author_id ?? row.authorId ?? undefined,
    createdAt: (row.created_at ?? row.createdAt)?.toISOString?.()
      || String(row.created_at ?? row.createdAt ?? ''),
  };
}

/** @param {object} input */
export async function insertObservation(input) {
  const id = input.id || newId('obs_');
  const ts = input.ts ? new Date(input.ts) : new Date();
  const now = new Date();
  const row = {
    id,
    venue_id: input.venueId,
    place_id: input.placeId,
    ts,
    wait_min: input.waitMin ?? null,
    status: input.status ?? null,
    source: input.source,
    confidence: input.confidence || 'low',
    author_id: input.authorId ?? null,
    created_at: now,
  };

  if (usingPostgres()) {
    const pool = await getPool();
    const res = await pool.query(
      `INSERT INTO observations
        (id, venue_id, place_id, ts, wait_min, status, source, confidence, author_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING
       RETURNING *`,
      [
        row.id,
        row.venue_id,
        row.place_id,
        row.ts,
        row.wait_min,
        row.status,
        row.source,
        row.confidence,
        row.author_id,
        row.created_at,
      ],
    );
    if (res.rows[0]) return rowToApi(res.rows[0]);
    return getObservation(id);
  }

  if (mem.rows.has(id)) return rowToApi(mem.rows.get(id));
  mem.rows.set(id, { ...row });
  return rowToApi(row);
}

export async function getObservation(id) {
  if (usingPostgres()) {
    const pool = await getPool();
    const res = await pool.query('SELECT * FROM observations WHERE id = $1', [id]);
    return rowToApi(res.rows[0]);
  }
  return rowToApi(mem.rows.get(id));
}

/**
 * @param {{ venueId?: string, placeId?: string, limit?: number }} [opts]
 */
export async function listObservations(opts = {}) {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 2000);
  if (usingPostgres()) {
    const pool = await getPool();
    const clauses = [];
    const args = [];
    if (opts.venueId) {
      args.push(opts.venueId);
      clauses.push(`venue_id = $${args.length}`);
    }
    if (opts.placeId) {
      args.push(opts.placeId);
      clauses.push(`place_id = $${args.length}`);
    }
    args.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT * FROM observations ${where} ORDER BY ts DESC LIMIT $${args.length}`,
      args,
    );
    return res.rows.map(rowToApi);
  }
  let rows = [...mem.rows.values()];
  if (opts.venueId) rows = rows.filter((r) => r.venue_id === opts.venueId);
  if (opts.placeId) rows = rows.filter((r) => r.place_id === opts.placeId);
  rows.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
  return rows.slice(0, limit).map(rowToApi);
}
