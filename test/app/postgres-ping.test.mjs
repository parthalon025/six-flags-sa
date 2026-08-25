#!/usr/bin/env node
/**
 * pingPostgres — production guard without DATABASE_URL (#436).
 * Seam: exported probe used by /api/ready.
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

const postgresPath = new URL('../../apps/party-tracker/lib/db/postgres.js', import.meta.url);
let src = readFileSync(fileURLToPath(postgresPath), 'utf8');
assert.ok(
  src.includes("'./productionDatabaseGuard.js'"),
  'postgres.js guard import moved — update shim',
);

const guardShimUrl = `data:text/javascript;base64,${Buffer.from(`
export const PRODUCTION_DATABASE_GUARD_MESSAGE = 'DATABASE_URL is required in production (Neon Postgres) — see docs/guide/neon.md';
export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}
`).toString('base64')}`;

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

async function loadPostgresModule(tag) {
  let moduleSrc = readFileSync(fileURLToPath(postgresPath), 'utf8');
  moduleSrc = moduleSrc.replace("'./productionDatabaseGuard.js'", JSON.stringify(guardShimUrl));
  moduleSrc += `\n// ${tag}`;
  const url = `data:text/javascript;base64,${Buffer.from(moduleSrc).toString('base64')}`;
  return import(url);
}

console.log('\n--- postgres ping (#436) ---');

await check('dev without DATABASE_URL reports memory ok', async () => {
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = 'development';
  delete process.env.VERCEL_ENV;
  const mod = await loadPostgresModule('dev');
  const probe = await mod.pingPostgres();
  assert.equal(probe.ok, true);
  assert.equal(probe.backend, 'memory');
});

await check('production without DATABASE_URL reports not ok', async () => {
  delete process.env.DATABASE_URL;
  process.env.NODE_ENV = 'production';
  delete process.env.VERCEL_ENV;
  const mod = await loadPostgresModule('prod');
  const probe = await mod.pingPostgres();
  assert.equal(probe.ok, false);
  assert.equal(probe.backend, 'memory');
  assert.match(probe.error, /DATABASE_URL/);
});

console.log(`\npostgres-ping: ${PASS.length} passed, ${FAIL.length} failed`);
if (FAIL.length) {
  console.error(FAIL.join('\n'));
  process.exit(1);
}
