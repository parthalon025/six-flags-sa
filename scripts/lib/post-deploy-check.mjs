/**
 * Post-deploy smoke checks — readiness, migration ledger, Clerk webhook route (#443).
 */
import { migrationFiles } from './lakebase-config.mjs';

const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * @param {string[]} expected
 * @param {string[]} applied
 */
export function migrationDrift(expected, applied) {
  const missing = expected.filter((name) => !applied.includes(name));
  return { ok: missing.length === 0, missing };
}

/**
 * @param {(sql: string) => Promise<{ rows: Array<{ name: string }> }>} query
 */
export async function readAppliedMigrations(query) {
  const result = await query('SELECT name FROM schema_migrations ORDER BY name');
  return result.rows.map((row) => row.name);
}

/**
 * @param {{ query: (sql: string) => Promise<{ rows: Array<{ name: string }> }>, expectedFiles?: string[] }}
 */
export async function checkMigrationSchema({ query, expectedFiles = migrationFiles() }) {
  try {
    const applied = await readAppliedMigrations(query);
    const drift = migrationDrift(expectedFiles, applied);
    if (!drift.ok) {
      return {
        ok: false,
        error: `schema behind repo: missing ${drift.missing.join(', ')}`,
        missing: drift.missing,
      };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

/**
 * @param {string} baseUrl
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function checkReady(baseUrl, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl.replace(/\/$/, '')}/api/ready`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    const body = await response.json();
    if (!response.ok || !body?.ready) {
      const detail = body?.error ?? `HTTP ${response.status}`;
      return { ok: false, error: `ready: ${detail}` };
    }
    if (body.postgres?.configured && !body.postgres?.ok) {
      return { ok: false, error: `ready: postgres ${body.postgres.error ?? 'unhealthy'}` };
    }
    if (body.clerk?.mandatory && !body.clerk?.configured) {
      return { ok: false, error: 'ready: clerk not configured' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `ready: ${String(err?.message || err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} baseUrl
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [opts]
 */
export async function checkClerkWebhook(baseUrl, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = `${baseUrl.replace(/\/$/, '')}/api/webhooks/clerk`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (response.status === 404) {
      return { ok: false, error: 'clerk webhook: route not found (404)' };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `clerk webhook: ${String(err?.message || err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {{
 *   baseUrl: string,
 *   fetchFn?: typeof fetch,
 *   query?: (sql: string) => Promise<{ rows: Array<{ name: string }> }>,
 *   expectedMigrations?: string[],
 *   skipMigrations?: boolean,
 * }}
 */
export async function runPostDeployChecks(opts) {
  const failures = [];
  const ready = await checkReady(opts.baseUrl, { fetchFn: opts.fetchFn });
  if (!ready.ok) failures.push(ready.error);

  if (!opts.skipMigrations && opts.query) {
    const migrations = await checkMigrationSchema({
      query: opts.query,
      expectedFiles: opts.expectedMigrations,
    });
    if (!migrations.ok) failures.push(migrations.error);
  }

  const clerk = await checkClerkWebhook(opts.baseUrl, { fetchFn: opts.fetchFn });
  if (!clerk.ok) failures.push(clerk.error);

  return { ok: failures.length === 0, failures };
}
