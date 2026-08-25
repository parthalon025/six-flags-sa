/**
 * Optional Postgres pool for PostDB and factory I/O.
 * Without DATABASE_URL callers use file fixtures (dev/tests).
 */

const URL = process.env.DATABASE_URL || '';

/** @type {import('pg').Pool | null} */
let pool = null;
let poolInit = null;

export function usingPostgres() {
  return Boolean(URL);
}

export function requirePostgres() {
  if (!usingPostgres()) {
    throw new Error('DATABASE_URL required for PostDB factory verbs (ADR-0024)');
  }
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

/** Cheap round trip for readiness probes. */
export async function pingPostgres() {
  if (!URL) return { ok: true, backend: 'memory' };
  try {
    const p = await getPool();
    await p.query('SELECT 1');
    return { ok: true, backend: 'postgres' };
  } catch (err) {
    return { ok: false, backend: 'postgres', error: String(err?.message || err) };
  }
}
