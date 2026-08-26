#!/usr/bin/env node
/**
 * Postgres probe seam — memory backend is not production-ready (#436).
 */
import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

async function withPingPostgres(env, run) {
  const saved = { ...process.env };
  Object.keys(process.env).forEach((key) => delete process.env[key]);
  Object.assign(process.env, env);
  try {
    const mod = await import(`../../apps/party-tracker/lib/db/postgres.js?probe=${Date.now()}`);
    return await run(mod.pingPostgres);
  } finally {
    Object.keys(process.env).forEach((key) => delete process.env[key]);
    Object.assign(process.env, saved);
  }
}

await withPingPostgres({ NODE_ENV: 'development' }, async (pingPostgres) => {
  const dev = await pingPostgres();
  assert.deepEqual(dev, { ok: true, backend: 'memory' });
});

await withPingPostgres({ NODE_ENV: 'production' }, async (pingPostgres) => {
  const prod = await pingPostgres();
  assert.equal(prod.ok, false);
  assert.equal(prod.backend, 'memory');
  assert.match(prod.error, /DATABASE_URL/);
});

await withPingPostgres(
  {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@host.example/db',
  },
  async (pingPostgres) => {
    const configured = await pingPostgres();
    assert.equal(configured.backend, 'postgres');
  },
);

console.log('postgres-probe: ok');
