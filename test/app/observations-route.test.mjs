#!/usr/bin/env node
/**
 * /api/observations route: scoped GET and guest POST append (#328 / E7.1).
 *
 * Seams:
 *   GET  — list requires venueId or placeId (no global dump)
 *   POST — append-only observation row (guest / no session)
 *
 * Same shim strategy as weather-route.test.mjs — `@/` and Next imports are
 * redirected before importing route.js from a data: URL.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

// Force in-memory store — route unit tests must not depend on DATABASE_URL.
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;

const testDir = dirname(fileURLToPath(import.meta.url));
const storeUrl = pathToFileURL(
  join(testDir, '../../apps/party-tracker/lib/observations/store.js'),
).href;
const sharedObsUrl = pathToFileURL(
  join(testDir, '../../packages/shared/observations.js'),
).href;

const HTTP_SHIM_SRC = `
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export { json };
export const badRequest = (message = 'Malformed request') => json({ error: message }, 400);
export const notFound = (message = 'Not found') => json({ error: message }, 404);
export const tooManyRequests = (retryAfter = 60) =>
  json({ error: 'Slow down' }, 429);
export async function readJson(request, limit = 64 * 1024) {
  const raw = await request.text().catch(() => null);
  if (raw == null || raw.length > limit) return null;
  if (!raw.trim()) return {};
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
export const isId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 64;
`;
const httpShimUrl = `data:text/javascript;base64,${Buffer.from(HTTP_SHIM_SRC).toString('base64')}`;

const RATE_SHIM_SRC = `export async function rateLimit() { return { ok: true }; }`;
const rateShimUrl = `data:text/javascript;base64,${Buffer.from(RATE_SHIM_SRC).toString('base64')}`;

const routeUrl = new URL('../../apps/party-tracker/app/api/observations/route.js', import.meta.url);
let src = readFileSync(fileURLToPath(routeUrl), 'utf8');
src = src.replace("'@/app/api/_lib/http'", JSON.stringify(httpShimUrl));
src = src.replace("'@/lib/rateLimit'", JSON.stringify(rateShimUrl));
src = src.replace("'@/lib/observations/store'", JSON.stringify(storeUrl));
src = src.replace("'@party-tracker/shared/observations.js'", JSON.stringify(sharedObsUrl));

const dataUrl = `data:text/javascript;base64,${Buffer.from(src).toString('base64')}`;
const { GET, POST } = await import(dataUrl);

// Fresh in-memory store for each test group.
function resetStore() {
  delete globalThis.__parkboundObservations;
}

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

console.log('\n--- observations route ---');

await check('GET list without venueId or placeId -> 400', async () => {
  resetStore();
  const res = await GET({ url: 'http://localhost/api/observations' });
  assert.equal(res.status, 400);
});

await check('guest POST appends observation and GET by venueId returns it', async () => {
  resetStore();
  const body = {
    id: 'obs_route_guest',
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-09-20T12:00:00.000Z',
    status: 'down',
    source: 'party-report',
    confidence: 'low',
  };
  const postRes = await POST({
    url: 'http://localhost/api/observations',
    headers: new Map([['x-forwarded-for', '127.0.0.1']]),
    text: async () => JSON.stringify(body),
  });
  assert.equal(postRes.status, 201);
  const posted = await postRes.json();
  assert.equal(posted.observation.placeId, 'orion');

  const listRes = await GET({
    url: 'http://localhost/api/observations?venueId=kings-island&placeId=orion',
  });
  assert.equal(listRes.status, 200);
  const listed = await listRes.json();
  assert.equal(listed.count, 1);
  assert.equal(listed.observations[0].id, 'obs_route_guest');
});

await check('GET by id returns single row without venue scope', async () => {
  resetStore();
  await POST({
    url: 'http://localhost/api/observations',
    headers: new Map([['x-forwarded-for', '127.0.0.1']]),
    text: async () => JSON.stringify({
      id: 'obs_route_guest',
      venueId: 'kings-island',
      placeId: 'orion',
      ts: '2026-09-20T12:00:00.000Z',
      status: 'down',
      source: 'party-report',
      confidence: 'low',
    }),
  });
  const res = await GET({ url: 'http://localhost/api/observations?id=obs_route_guest' });
  assert.equal(res.status, 200);
  const byId = await res.json();
  assert.equal(byId.observation.id, 'obs_route_guest');
});

if (FAIL.length) {
  console.error(`observations route tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`observations route tests: ${PASS.length} passed`);
}
