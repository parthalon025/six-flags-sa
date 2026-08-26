#!/usr/bin/env node
/**
 * /api/ready — readiness probes both the durable store and Postgres (#437).
 *
 * Seam: the GET handler's HTTP contract. Store and Postgres backends are
 * shimmed so each acceptance case runs without Next or real databases.
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

/** @type {{ pingPostgres: () => Promise<{ ok: boolean, backend: string, error?: string }>, usingPostgres: () => boolean }} */
let postgresShim = {
  pingPostgres: async () => ({ ok: true, backend: 'memory' }),
  usingPostgres: () => false,
};
const postgresShimUrl = `data:text/javascript;base64,${Buffer.from(`
export const pingPostgres = () => globalThis.__readyPostgresShim.pingPostgres();
export const usingPostgres = () => globalThis.__readyPostgresShim.usingPostgres();
`).toString('base64')}`;

globalThis.__readyStoreShim = storeShim;
globalThis.__readyPostgresShim = postgresShim;

const routeUrl = new URL('../../apps/party-tracker/app/api/ready/route.js', import.meta.url);
let src = readFileSync(fileURLToPath(routeUrl), 'utf8');
assert.ok(src.includes("'@/lib/serverStore'"), 'route.js serverStore import changed — update this test');
src = src
  .replace("'@/app/api/_lib/http'", JSON.stringify(httpShimUrl))
  .replace("'@/lib/clerkConfigured'", JSON.stringify(clerkShimUrl))
  .replace("'@/lib/serverStore'", JSON.stringify(storeShimUrl));
if (src.includes("'@/lib/db/postgres'")) {
  src = src.replace("'@/lib/db/postgres'", JSON.stringify(postgresShimUrl));
} else {
  assert.fail('route.js must import pingPostgres from @/lib/db/postgres — add it first');
}

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

console.log('\n--- ready route (#437) ---');

await check('pass: store and unconfigured postgres both ok -> 200 with per-backend fields', async () => {
  storeShim = {
    ping: async () => ({ ok: true, backend: 'upstash' }),
    usingRedis: true,
  };
  postgresShim = {
    pingPostgres: async () => ({ ok: true, backend: 'memory' }),
    usingPostgres: () => false,
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.backend, 'upstash');
  assert.equal(body.durable, true);
  assert.equal(body.postgres.ok, true);
  assert.equal(body.postgres.backend, 'memory');
});

await check('pass: configured postgres also ok -> 200', async () => {
  storeShim = {
    ping: async () => ({ ok: true, backend: 'memory' }),
    usingRedis: false,
  };
  postgresShim = {
    pingPostgres: async () => ({ ok: true, backend: 'postgres' }),
    usingPostgres: () => true,
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.postgres.ok, true);
  assert.equal(body.postgres.backend, 'postgres');
});

await check('fail: postgres probe fails -> 503 naming postgres', async () => {
  storeShim = {
    ping: async () => ({ ok: true, backend: 'upstash' }),
    usingRedis: true,
  };
  postgresShim = {
    pingPostgres: async () => ({
      ok: false,
      backend: 'postgres',
      error: 'connection refused',
    }),
    usingPostgres: () => true,
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.equal(body.backend, 'postgres');
  assert.equal(body.durable, true);
  assert.match(body.error, /connection refused/);
  assert.equal(body.postgres.ok, false);
});

await check('fail: store ping fails -> 503 naming the store backend', async () => {
  storeShim = {
    ping: async () => ({ ok: false, backend: 'upstash', error: 'Upstash 503' }),
    usingRedis: true,
  };
  postgresShim = {
    pingPostgres: async () => ({ ok: true, backend: 'postgres' }),
    usingPostgres: () => true,
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.equal(body.backend, 'upstash');
  assert.equal(body.durable, true);
  assert.match(body.error, /Upstash 503/);
  assert.equal(body.postgres.ok, true);
});

await check('probes run concurrently', async () => {
  const order = [];
  storeShim = {
    ping: async () => {
      order.push('store-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('store-end');
      return { ok: true, backend: 'memory' };
    },
    usingRedis: false,
  };
  postgresShim = {
    pingPostgres: async () => {
      order.push('postgres-start');
      await new Promise((r) => setTimeout(r, 30));
      order.push('postgres-end');
      return { ok: true, backend: 'postgres' };
    },
    usingPostgres: () => true,
  };
  globalThis.__readyStoreShim = storeShim;
  globalThis.__readyPostgresShim = postgresShim;

  const { GET } = await loadRoute();
  const started = Date.now();
  const res = await GET();
  const elapsed = Date.now() - started;
  assert.equal(res.status, 200);
  assert.ok(order.includes('store-start') && order.includes('postgres-start'));
  assert.ok(elapsed < 55, `expected parallel probes, took ${elapsed}ms`);
});

if (FAIL.length) {
  console.error(`ready route tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`ready route tests: ${PASS.length} passed`);
}
