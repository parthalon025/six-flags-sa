#!/usr/bin/env node
/**
 * /api/weather route: upstream-outage paths degrade to a 200 gap body rather
 * than a 502/503/504 the browser logs as a failed resource load (#502).
 *
 * The route imports its response helpers via the `@/` alias, which only
 * Next's bundler resolves, and `_lib/http.js` in turn imports `next/server`,
 * whose package.json ships no `exports` map — plain Node ESM refuses the
 * extensionless subpath even once the alias is fixed. Rather than reach for
 * a loader or install Next's runtime for a unit test, the route's source is
 * read and its one import specifier is pointed at a same-shaped shim (built
 * on the platform `Response`, exercising the same status/body contract)
 * before the module is imported from a data: URL. No production code
 * changes for testability, no new loader infrastructure.
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

// Mirrors the handful of helpers apps/party-tracker/app/api/_lib/http.js
// exports, on the platform `Response` instead of `next/server`'s
// `NextResponse` — same status codes and JSON bodies, no Next runtime.
const HTTP_SHIM_SRC = `
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export { json };
export const badRequest = (message = 'Malformed request') => json({ error: message }, 400);
export const jsonCached = (body, { status = 200 } = {}) => json(body, status);
`;
const httpShimUrl = `data:text/javascript;base64,${Buffer.from(HTTP_SHIM_SRC).toString('base64')}`;

const routeUrl = new URL('../../apps/party-tracker/app/api/weather/route.js', import.meta.url);
let src = readFileSync(fileURLToPath(routeUrl), 'utf8');
const aliasImport = "'@/app/api/_lib/http'";
assert.ok(src.includes(aliasImport), 'route.js import specifier changed — update this test');
src = src.replace(aliasImport, JSON.stringify(httpShimUrl));

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

const originalFetch = globalThis.fetch;
/** A distinct coordinate per test keeps every call hitting a cold cache. */
let lat = -10;
const req = () => {
  lat -= 1;
  return { url: `http://localhost/api/weather?lat=${lat}&lng=20` };
};

console.log('\n--- weather route ---');

await check('cold cache + upstream fetch throws -> 200 gap body, not 503', async () => {
  globalThis.fetch = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.open-meteo.com');
  };
  try {
    const res = await GET(req());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.observed, null);
    assert.equal(body.gap, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check('cold cache + upstream responds non-ok -> 200 gap body, not 502/503/504', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  try {
    const res = await GET(req());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.observed, null);
    assert.equal(body.gap, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check('cold cache + upstream body unparsable -> 200 gap body, not 503', async () => {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => {
      throw new Error('Unexpected token in JSON');
    },
  });
  try {
    const res = await GET(req());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.observed, null);
    assert.equal(body.gap, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check('warm cache survives an outage as the existing stale 200 fallback', async () => {
  const request = req();
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      current: {
        temperature_2m: 78,
        apparent_temperature: 80,
        precipitation: 0,
        weather_code: 0,
        wind_speed_10m: 5,
        wind_gusts_10m: 8,
        is_day: 1,
      },
      hourly: { precipitation_probability: [10], cape: [0] },
    }),
  });
  try {
    const warm = await GET(request);
    assert.equal(warm.status, 200);
    const warmBody = await warm.json();
    assert.ok(warmBody.observed);

    globalThis.fetch = async () => {
      throw new Error('network down');
    };
    // The route's own in-process cache is fresh for ten minutes and short-
    // circuits before ever calling fetch again — jump the clock past that so
    // this exercises the actual stale-on-outage fallback, not a cache hit.
    const realNow = Date.now;
    Date.now = () => realNow() + 11 * 60 * 1000;
    let stale;
    try {
      stale = await GET(request);
    } finally {
      Date.now = realNow;
    }
    assert.equal(stale.status, 200);
    const staleBody = await stale.json();
    assert.ok(staleBody.observed, 'stale fallback must keep the last reading');
    assert.equal(staleBody.stale, true);
    assert.equal(staleBody.gap, undefined, 'a served stale reading is not a gap');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await check('malformed request still surfaces as a real (non-2xx, non-gap) error', async () => {
  const res = await GET({ url: 'http://localhost/api/weather?lat=not-a-number&lng=20' });
  assert.equal(res.status, 400);
});

if (FAIL.length) {
  console.error(`weather route tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`weather route tests: ${PASS.length} passed`);
}
