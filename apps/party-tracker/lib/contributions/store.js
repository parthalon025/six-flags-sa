/**
 * Contribution persistence — Postgres when DATABASE_URL is set, else in-memory.
 */

import { usingPostgres, getPool } from '../db/postgres.js';

const mem =
  globalThis.__parkboundContributions ??
  (globalThis.__parkboundContributions = {
    rows: new Map(),
    confirmations: new Map(),
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
    authorId: row.author_id ?? row.authorId,
    venueId: row.venue_id ?? row.venueId,
    placeId: row.place_id ?? row.placeId ?? undefined,
    kind: row.kind,
    status: row.status,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload || {},
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    createdAt: (row.created_at ?? row.createdAt)?.toISOString?.()
      || String(row.created_at ?? row.createdAt ?? ''),
    resolvedAt: row.resolved_at ?? row.resolvedAt ?? undefined,
  };
}

/** @param {object} input */
export async function insertContribution(input) {
  const id = input.id || newId('c_');
  const now = new Date();
  const row = {
    id,
    author_id: input.authorId,
    venue_id: input.venueId,
    place_id: input.placeId || null,
    kind: input.kind,
    status: input.status || 'pending',
    payload: input.payload || {},
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    created_at: now,
    resolved_at: null,
  };

  if (usingPostgres()) {
    const pool = await getPool();
    await pool.query(
      `INSERT INTO contributions
        (id, author_id, venue_id, place_id, kind, status, payload, lat, lng, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        row.id,
        row.author_id,
        row.venue_id,
        row.place_id,
        row.kind,
        row.status,
        JSON.stringify(row.payload),
        row.lat,
        row.lng,
        row.created_at,
      ],
    );
    return rowToApi(row);
  }

  mem.rows.set(id, { ...row, payload: { ...row.payload } });
  return rowToApi(row);
}

export async function getContribution(id) {
  if (usingPostgres()) {
    const pool = await getPool();
    const res = await pool.query('SELECT * FROM contributions WHERE id = $1', [id]);
    return rowToApi(res.rows[0]);
  }
  return rowToApi(mem.rows.get(id));
}

/**
 * @param {{ venueId?: string, status?: string, limit?: number }} [opts]
 */
export async function listContributions(opts = {}) {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 2000);
  if (usingPostgres()) {
    const pool = await getPool();
    const clauses = [];
    const args = [];
    if (opts.venueId) {
      args.push(opts.venueId);
      clauses.push(`venue_id = $${args.length}`);
    }
    if (opts.status) {
      args.push(opts.status);
      clauses.push(`status = $${args.length}`);
    }
    args.push(limit);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const res = await pool.query(
      `SELECT * FROM contributions ${where} ORDER BY created_at DESC LIMIT $${args.length}`,
      args,
    );
    return res.rows.map(rowToApi);
  }

  let rows = [...mem.rows.values()].map(rowToApi);
  if (opts.venueId) rows = rows.filter((r) => r.venueId === opts.venueId);
  if (opts.status) rows = rows.filter((r) => r.status === opts.status);
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return rows.slice(0, limit);
}

/** Accepted durable rows for consolidate export. */
export async function listConsolidateCandidates() {
  const rows = await listContributions({ status: 'accepted', limit: 2000 });
  return rows;
}
