#!/usr/bin/env node
/**
 * /api/ready — readiness probes both the party store (Upstash/memory) and
 * Postgres when configured (#437). Tests the public route contract with
 * dependency shims (same pattern as weather-route.test.mjs).
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

/** @type {() => Promise<{ ok: boolean, backend: string, error?: string }>} */
let pingImpl = async () => ({ ok: true, backend: 'memory' });
/** @type {() => Promise<{ ok: boolean, backend: string, error?: string }>} */
let pingPostgresImpl = async () => ({ ok: true, backend: 'memory' });
const pingCalls = [];
const postgresCalls = [];

const SERVER_STORE_SHIM = `
export let usingRedis = false;
export function setUsingRedis(v) { usingRedis = v; }
export async function ping() {
  globalThis.__readyPingCalls.push(Date.now());
  return globalThis.__readyPingImpl();
}
`;
const serverStoreShimUrl = `data:text/javascript;base64,${Buffer.from(SERVER_STORE_SHIM).toString('base64')}`;

const POSTGRES_SHIM = `
export async function pingPostgres() {
  globalThis.__readyPostgresCalls.push(Date.now());
  return globalThis.__readyPingPostgresImpl();
}
`;
const postgresShimUrl = `data:text/javascript;base64,${Buffer.from(POSTGRES_SHIM).toString('base64')}`;

const CLERK_SHIM = `
export function clerkConfigured() { return true; }
export function clerkConfigStatus() { return { ok: true, missing: [] }; }
`;
const clerkShimUrl = `data:text/javascript;base64,${Buffer.from(CLERK_SHIM).toString('base64')}`;

globalThis.__readyPingImpl = pingImpl;
globalThis.__readyPingPostgresImpl = pingPostgresImpl;
globalThis.__readyPingCalls = pingCalls;
globalThis.__readyPostgresCalls = postgresCalls;

const serverStoreMod = await import(serverStoreShimUrl);

const routeUrl = new URL('../../apps/party-tracker/app/api/ready/route.js', import.meta.url);
let src = readFileSync(fileURLToPath(routeUrl), 'utf8');
src = src.replace("'@/app/api/_lib/http'", JSON.stringify(httpShimUrl));
src = src.replace("'@/lib/serverStore'", JSON.stringify(serverStoreShimUrl));
src = src.replace("'@/lib/db/postgres'", JSON.stringify(postgresShimUrl));
src = src.replace("'@/lib/clerkConfigured'", JSON.stringify(clerkShimUrl));

const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
const { GET } = await import(dataUrl);

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

function resetMocks() {
  pingCalls.length = 0;
  postgresCalls.length = 0;
  serverStoreMod.setUsingRedis(false);
  globalThis.__readyPingImpl = async () => ({ ok: true, backend: 'memory' });
  globalThis.__readyPingPostgresImpl = async () => ({ ok: true, backend: 'memory' });
}

console.log('\n--- ready route ---');

await check('both probes pass with postgres unconfigured -> 200, per-backend fields', async () => {
  resetMocks();
  globalThis.__readyPingImpl = async () => ({ ok: true, backend: 'memory' });
  globalThis.__readyPingPostgresImpl = async () => ({ ok: true, backend: 'memory' });

  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.backend, 'memory');
  assert.equal(body.durable, false);
  assert.deepEqual(body.postgres, { ok: true, backend: 'memory' });
  assert.equal(body.clerk.configured, true);
});

await check('redis upstash + postgres both pass -> 200 with durable true', async () => {
  resetMocks();
  serverStoreMod.setUsingRedis(true);
  globalThis.__readyPingImpl = async () => ({ ok: true, backend: 'upstash' });
  globalThis.__readyPingPostgresImpl = async () => ({ ok: true, backend: 'postgres' });

  const res = await GET();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ready, true);
  assert.equal(body.backend, 'upstash');
  assert.equal(body.durable, true);
  assert.deepEqual(body.postgres, { ok: true, backend: 'postgres' });
});

await check('postgres probe fails -> 503 naming postgres', async () => {
  resetMocks();
  globalThis.__readyPingImpl = async () => ({ ok: true, backend: 'upstash' });
  serverStoreMod.setUsingRedis(true);
  globalThis.__readyPingPostgresImpl = async () => ({
    ok: false,
    backend: 'postgres',
    error: 'connection refused',
  });

  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.equal(body.backend, 'postgres');
  assert.match(body.error, /connection refused/);
  assert.deepEqual(body.postgres, { ok: false, backend: 'postgres', error: 'connection refused' });
});

await check('store ping fails -> 503 naming the redis backend', async () => {
  resetMocks();
  serverStoreMod.setUsingRedis(true);
  globalThis.__readyPingImpl = async () => ({
    ok: false,
    backend: 'upstash',
    error: 'PING timeout',
  });
  globalThis.__readyPingPostgresImpl = async () => ({ ok: true, backend: 'postgres' });

  const res = await GET();
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ready, false);
  assert.equal(body.backend, 'upstash');
  assert.match(body.error, /PING timeout/);
});

await check('probes run concurrently', async () => {
  resetMocks();
  let pingStarted;
  let postgresStarted;
  const gate = new Promise((resolve) => {
    pingStarted = resolve;
  });

  globalThis.__readyPingImpl = async () => {
    pingStarted();
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, backend: 'memory' };
  };
  globalThis.__readyPingPostgresImpl = async () => {
    postgresStarted = Date.now();
    await new Promise((r) => setTimeout(r, 30));
    return { ok: true, backend: 'memory' };
  };

  const pending = GET();
  await gate;
  assert.ok(postgresStarted, 'postgres probe must start before store probe finishes');
  const res = await pending;
  assert.equal(res.status, 200);
  assert.equal(pingCalls.length, 1);
  assert.equal(postgresCalls.length, 1);
});

if (FAIL.length) {
  console.error(`ready route tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`ready route tests: ${PASS.length} passed`);
}
