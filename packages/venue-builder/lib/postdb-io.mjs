/**
 * PostDB I/O facade — truth revisions, display packs, and venue heads.
 *
 * Append-only truth (`truth_revisions`) with a promotable head (`venue_heads`).
 * File fixtures are for unit tests; factory verbs require DATABASE_URL (ADR-0024).
 */

import { createHash } from 'node:crypto';
import { getPool, usingPostgres } from './db/postgres.mjs';

export function usingPostdb() {
  return usingPostgres();
}

/** True when factory verbs must fail closed without DATABASE_URL (ADR-0024). */
export function postdbRequired() {
  return process.env.POSTDB_REQUIRED === '1' || Boolean(process.env.CI);
}

export function requirePostdb() {
  if (!usingPostdb()) {
    throw new Error('DATABASE_URL required for PostDB factory verbs (ADR-0024)');
  }
}

/** Fail closed for factory CLIs in CI / when POSTDB_REQUIRED=1. */
export function assertPostdbAvailable() {
  if (postdbRequired() && !usingPostdb()) {
    throw new Error('DATABASE_URL required for PostDB factory verbs (ADR-0024)');
  }
}

/**
 * Stable sha256 over the published truth trio bodies.
 * @param {{ map: object, pois: object[], gaps?: object|null }} truth
 */
export function outputsHash({ map, pois, gaps = null }) {
  const canonical = JSON.stringify({
    map,
    pois,
    gaps: gaps ?? [],
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * @param {string} venueId
 * @returns {Promise<{ map: object, pois: object[], gaps: object|null, revisionId: string, generated: string|null }>}
 */
export async function readTruth(venueId) {
  requirePostdb();
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT tr.revision_id, tr.generated_at, tr.map_body, tr.pois_body, tr.gaps_body
     FROM venue_heads vh
     JOIN truth_revisions tr ON tr.revision_id = vh.truth_revision_id
     WHERE vh.venue_id = $1`,
    [venueId],
  );
  if (!rows.length) {
    throw new Error(`Venue "${venueId}" has no published truth head in PostDB`);
  }
  const row = rows[0];
  const map = row.map_body;
  const gaps = row.gaps_body;
  const emptyGaps = Array.isArray(gaps) && gaps.length === 0;
  return {
    map,
    pois: row.pois_body,
    gaps: emptyGaps ? null : gaps,
    revisionId: row.revision_id,
    generated: map?.meta?.generated ?? row.generated_at?.toISOString?.() ?? null,
  };
}

/**
 * @param {string} venueId
 * @param {{ map: object, pois: object[], gaps?: object|null, factory?: string, routeId?: string }} truth
 * @returns {Promise<{ revisionId: string }>}
 */
export async function writeTruth(venueId, truth) {
  requirePostdb();
  const pool = await getPool();
  const { map, pois, gaps = null, factory, routeId } = truth;
  const gapsBody = gaps ?? [];
  const hash = outputsHash({ map, pois, gaps: gapsBody });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let runId = null;
    if (factory && routeId) {
      const run = await client.query(
        `INSERT INTO factory_runs (venue_id, factory, route_id, status, finished_at)
         VALUES ($1, $2, $3, 'succeeded', now())
         RETURNING run_id`,
        [venueId, factory, routeId],
      );
      runId = run.rows[0].run_id;
    }
    const rev = await client.query(
      `INSERT INTO truth_revisions (
         venue_id, map_body, pois_body, gaps_body, outputs_hash, created_by_run
       ) VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5, $6)
       RETURNING revision_id`,
      [venueId, JSON.stringify(map), JSON.stringify(pois), JSON.stringify(gapsBody), hash, runId],
    );
    const revisionId = rev.rows[0].revision_id;
    await client.query(
      `INSERT INTO venue_heads (venue_id, truth_revision_id, published_at)
       VALUES ($1, $2, now())
       ON CONFLICT (venue_id) DO UPDATE
         SET truth_revision_id = EXCLUDED.truth_revision_id,
             published_at = EXCLUDED.published_at`,
      [venueId, revisionId],
    );
    await client.query('COMMIT');
    return { revisionId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * @param {string} venueId
 * @returns {Promise<string|null>}
 */
export async function getHeadRevisionId(venueId) {
  requirePostdb();
  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT truth_revision_id FROM venue_heads WHERE venue_id = $1',
    [venueId],
  );
  return rows[0]?.truth_revision_id ?? null;
}

/**
 * @param {string} venueId
 * @param {string} skinId
 * @returns {Promise<{ body: object, packId: string, basedOnRevisionId: string }|null>}
 */
export async function readDisplayPack(venueId, skinId) {
  requirePostdb();
  const pool = await getPool();
  const { rows } = await pool.query(
    `SELECT pack_id, based_on_revision_id, body
     FROM display_packs
     WHERE venue_id = $1 AND skin_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [venueId, skinId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  return {
    body: row.body,
    packId: row.pack_id,
    basedOnRevisionId: row.based_on_revision_id,
  };
}

/**
 * @param {string} venueId
 * @param {string} skinId
 * @param {object} body
 * @param {string} basedOnRevisionId
 * @returns {Promise<{ packId: string }>}
 */
export async function writeDisplayPack(venueId, skinId, body, basedOnRevisionId) {
  requirePostdb();
  const pool = await getPool();
  const { rows } = await pool.query(
    `INSERT INTO display_packs (venue_id, skin_id, based_on_revision_id, body)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (venue_id, skin_id, based_on_revision_id) DO UPDATE
       SET body = EXCLUDED.body
     RETURNING pack_id`,
    [venueId, skinId, basedOnRevisionId, JSON.stringify(body)],
  );
  return { packId: rows[0].pack_id };
}

/**
 * Repoint the venue head to an existing truth revision (rollback / promote).
 * @param {string} venueId
 * @param {string} revisionId
 */
export async function publishHead(venueId, revisionId) {
  requirePostdb();
  const pool = await getPool();
  const { rows } = await pool.query(
    'SELECT revision_id FROM truth_revisions WHERE venue_id = $1 AND revision_id = $2',
    [venueId, revisionId],
  );
  if (!rows.length) {
    throw new Error(`Revision "${revisionId}" not found for venue "${venueId}"`);
  }
  await pool.query(
    `INSERT INTO venue_heads (venue_id, truth_revision_id, published_at)
     VALUES ($1, $2, now())
     ON CONFLICT (venue_id) DO UPDATE
       SET truth_revision_id = EXCLUDED.truth_revision_id,
           published_at = EXCLUDED.published_at`,
    [venueId, revisionId],
  );
}
