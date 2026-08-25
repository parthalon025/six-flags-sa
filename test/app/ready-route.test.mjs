#!/usr/bin/env node
/**
 * /api/ready — postgres production guard (#436) + parallel probes (#437).
 *
 * Seam: GET handler HTTP contract with shimmed store and postgres backends.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const HTTP_SHIM_SRC = `
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export { json };
`;
const httpShimUrl = `data:text/javascript;base64,${Buffer.from(HTTP_SHIM_SRC).toString('base64')}`;

const CLERK_SHIM_SRC = `
export const clerkConfigured = () => true;
export const clerkConfigStatus = () => ({ ok: true, missing: [] });
`;
const clerkShimUrl = `data:text/javascript;base64,${Buffer.from(CLERK_SHIM_SRC).toString('base64')}`;

/** @type {{ ping: () => Promise<{ ok: boolean, backend: string, error?: string }>, usingRedis: boolean }} */
let storeShim = {
  ping: async () => ({ ok: true, backend: 'memory' }),
  usingRedis: false,
};
const storeShimUrl = `data:text/javascript;base64,${Buffer.from(`
export const ping = () => globalThis.__readyStoreShim.ping();
export const usingRedis = globalThis.__readyStoreShim.usingRedis;
`).toString('base64')}`;

/** @type {{ pingPostgres: () => Promise<{ ok: boolean, backend: string, error?: string }> }} */
let postgresShim = {
  pingPostgres: async () => ({ ok: true, backend: 'memory' }),
};
const postgresShimUrl = `data:text/javascript;base64,${Buffer.from(`
export const pingPostgres = () => globalThis.__readyPostgresShim.pingPostgres();
`).toString('base64')}`;

globalThis.__readyStoreShim = storeShim;
globalThis.__readyPostgresShim = postgresShim;

const routeUrl = new URL('../../apps/party-tracker/app/api/ready/route.js', import.meta.url);
let src = readFileSync(fileURLToPath(routeUrl), 'utf8');
assert.ok(src.includes("'@/lib/serverStore'"), 'route.js serverStore import changed — update shim');
src = src
  .replace("'@/app/api/_lib/http'", JSON.stringify(httpShimUrl))
  .replace("'@/lib/clerkConfigured'", JSON.stringify(clerkShimUrl))
  .replace("'@/lib/serverStore'", JSON.stringify(storeShimUrl))
  .replace("'@/lib/db/postgres'", JSON.stringify(postgresShimUrl));

const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

let routeModule;
async function loadRoute() {
  if (!routeModule) routeModule = await import(dataUrl);
  return routeModule;
}

console.log('\n--- ready route (#436/#437) ---');

await check('dev memory postgres ok -> 200 with postgres field', async () => {
  storeShim = {
    ping: async () => ({ ok: true, backend: 'memory' }),
    usingRedis: false,
  };
  postgresShim = {
    pingPostgres: async () => ({ ok: true, backend: 'memory' }),
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.postgres.ok, true);
  assert.equal(body.postgres.backend, 'memory');
});

await check('production postgres guard fail -> 503 naming DATABASE_URL', async () => {
  storeShim = {
    ping: async () => ({ ok: true, backend: 'upstash' }),
    usingRedis: true,
  };
  postgresShim = {
    pingPostgres: async () => ({
      ok: false,
      backend: 'memory',
      error: 'DATABASE_URL is required in production (Neon Postgres) — see docs/guide/neon.md',
    }),
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.match(body.error, /DATABASE_URL/);
  assert.equal(body.postgres.ok, false);
});

console.log(`\nready-route: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
