/**
 * Optional Postgres pool for E0 profiles/contributions.
 * Without DATABASE_URL the app uses in-memory contribution storage (dev/tests).
 */

import { checkProductionPostgresGuard } from '../productionPostgresGuard.js';

const URL = process.env.DATABASE_URL || '';

/** @type {import('pg').Pool | null} */
let pool = null;
let poolInit = null;

export function usingPostgres() {
  return Boolean(URL);
}

export async function getPool() {
  if (!URL) return null;
  if (pool) return pool;
  if (!poolInit) {
    poolInit = (async () => {
      const { default: pg } = await import('pg');
      pool = new pg.Pool({
        connectionString: URL,
        max: Number(process.env.PG_POOL_MAX || 4),
        idleTimeoutMillis: 30_000,
      });
      return pool;
    })();
  }
  return poolInit;
}

/** Cheap round trip for /api/ready. */
export async function pingPostgres() {
  if (!URL) {
    const guard = checkProductionPostgresGuard();
    if (!guard.ok) return { ok: false, backend: 'memory', error: guard.reason };
    return { ok: true, backend: 'memory' };
  }
  try {
    const p = await getPool();
    await p.query('SELECT 1');
    return { ok: true, backend: 'postgres' };
  } catch (err) {
    return { ok: false, backend: 'postgres', error: String(err?.message || err) };
  }
}
