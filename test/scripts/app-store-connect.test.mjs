#!/usr/bin/env node
/**
 * App Store Connect JWT signing, env-credential loading, and the ASC fetch
 * wrapper's error handling — mocked fetch, no live network calls (#474).
 *
 *   node test/scripts/app-store-connect.test.mjs
 */
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ascGet,
  createAscJwt,
  loadAscCredentialsFromEnv,
  resolveAppId,
} from '../../scripts/lib/app-store-connect.mjs';

function base64urlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

/** Throwaway ES256 keypair — never a real ASC credential. */
const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const credentials = { keyId: 'TESTKEYID1', issuerId: 'test-issuer-id', privateKeyPem };

// ---------------------------------------------------------------------------
// createAscJwt
// ---------------------------------------------------------------------------

{
  const before = Math.floor(Date.now() / 1000);
  const jwt = createAscJwt(credentials);
  const parts = jwt.split('.');
  assert.equal(parts.length, 3, 'JWT is header.payload.signature');
  assert.ok(
    parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p)),
    'each part is base64url — no +, /, or = padding',
  );

  const header = JSON.parse(base64urlDecode(parts[0]).toString('utf8'));
  assert.deepEqual(header, { alg: 'ES256', kid: 'TESTKEYID1', typ: 'JWT' });

  const payload = JSON.parse(base64urlDecode(parts[1]).toString('utf8'));
  assert.equal(payload.iss, 'test-issuer-id');
  assert.ok(payload.iat >= before && payload.iat <= before + 5, 'iat is "now"');
  assert.equal(payload.exp, payload.iat + 1200, 'exp is iat + 20 minutes');
  assert.equal(payload.aud, 'appstoreconnect-v1');
}

{
  // Signature must actually verify against the matching public key, using
  // the same ieee-p1363 encoding the ASC API expects (not DER).
  const jwt = createAscJwt(credentials);
  const [headerB64, payloadB64, sigB64] = jwt.split('.');
  const verifier = createVerify('SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const valid = verifier.verify(
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    base64urlDecode(sigB64),
  );
  assert.equal(valid, true, 'signature verifies against the matching public key');
}

// ---------------------------------------------------------------------------
// loadAscCredentialsFromEnv
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'APP_STORE_CONNECT_API_KEY_ID',
  'APP_STORE_CONNECT_ISSUER_ID',
  'APP_STORE_CONNECT_API_KEY_PATH',
  'APP_STORE_CONNECT_API_KEY',
];

function withEnv(vars, fn) {
  const saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

{
  const result = withEnv({}, () => loadAscCredentialsFromEnv());
  assert.equal(result, null, 'no keyId/issuerId returns null');
}

{
  const result = withEnv(
    { APP_STORE_CONNECT_API_KEY_ID: 'kid', APP_STORE_CONNECT_ISSUER_ID: 'iss' },
    () => loadAscCredentialsFromEnv(),
  );
  assert.equal(result, null, 'keyId/issuerId without a key source returns null');
}

{
  const dir = mkdtempSync(join(tmpdir(), 'asc-creds-'));
  const keyPath = join(dir, 'key.p8');
  writeFileSync(keyPath, privateKeyPem, 'utf8');
  try {
    const result = withEnv(
      {
        APP_STORE_CONNECT_API_KEY_ID: 'kid',
        APP_STORE_CONNECT_ISSUER_ID: 'iss',
        APP_STORE_CONNECT_API_KEY_PATH: keyPath,
      },
      () => loadAscCredentialsFromEnv(),
    );
    assert.deepEqual(result, { keyId: 'kid', issuerId: 'iss', privateKeyPem }, 'reads PEM from keyPath');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const keyB64 = Buffer.from(privateKeyPem, 'utf8').toString('base64');
  const result = withEnv(
    {
      APP_STORE_CONNECT_API_KEY_ID: 'kid',
      APP_STORE_CONNECT_ISSUER_ID: 'iss',
      APP_STORE_CONNECT_API_KEY: keyB64,
    },
    () => loadAscCredentialsFromEnv(),
  );
  assert.deepEqual(result, { keyId: 'kid', issuerId: 'iss', privateKeyPem }, 'base64-decodes APP_STORE_CONNECT_API_KEY');
}

{
  // A value that is not base64-of-a-PEM decodes to garbage, so the code
  // falls back to using the raw env value verbatim.
  const result = withEnv(
    {
      APP_STORE_CONNECT_API_KEY_ID: 'kid',
      APP_STORE_CONNECT_ISSUER_ID: 'iss',
      APP_STORE_CONNECT_API_KEY: privateKeyPem,
    },
    () => loadAscCredentialsFromEnv(),
  );
  assert.deepEqual(
    result,
    { keyId: 'kid', issuerId: 'iss', privateKeyPem },
    'a raw (non-base64) PEM value falls back to itself',
  );
}

{
  const dir = mkdtempSync(join(tmpdir(), 'asc-creds-'));
  const keyPath = join(dir, 'key.p8');
  writeFileSync(keyPath, privateKeyPem, 'utf8');
  try {
    const result = withEnv(
      {
        APP_STORE_CONNECT_API_KEY_ID: 'kid',
        APP_STORE_CONNECT_ISSUER_ID: 'iss',
        APP_STORE_CONNECT_API_KEY_PATH: keyPath,
        APP_STORE_CONNECT_API_KEY: 'should-be-ignored-when-path-is-set',
      },
      () => loadAscCredentialsFromEnv(),
    );
    assert.deepEqual(result, { keyId: 'kid', issuerId: 'iss', privateKeyPem }, 'keyPath takes priority over keyB64');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// ascGet / resolveAppId — mocked fetch, no live network calls
// ---------------------------------------------------------------------------

async function withFetch(mockFetch, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}

await withFetch(
  async (url, init) => {
    assert.equal(url, 'https://api.appstoreconnect.apple.com/v1/apps/42');
    assert.equal(init.headers.Accept, 'application/json');
    assert.match(
      init.headers.Authorization,
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
      'sends a bearer token shaped like the JWT createAscJwt produces',
    );
    return { ok: true, json: async () => ({ data: { id: '42' } }) };
  },
  async () => {
    const body = await ascGet('/apps/42', credentials);
    assert.deepEqual(body, { data: { id: '42' } }, 'ascGet resolves with the parsed JSON body');
  },
);

await withFetch(
  async () => ({ ok: false, status: 404, text: async () => 'Not Found: no such app' }),
  async () => {
    await assert.rejects(
      () => ascGet('/apps/999', credentials),
      /ASC 404: Not Found: no such app/,
      'ascGet surfaces status + response body on a non-ok response',
    );
  },
);

await withFetch(
  async () => ({ ok: false, status: 500, text: async () => 'x'.repeat(500) }),
  async () => {
    await assert.rejects(() => ascGet('/apps/1', credentials), (err) => {
      assert.equal(err.message, `ASC 500: ${'x'.repeat(200)}`, 'error body is truncated to 200 chars');
      return true;
    });
  },
);

await withFetch(
  async (url) => {
    assert.match(url, /\/apps\/123$/);
    return { ok: true, json: async () => ({ data: { id: '123' } }) };
  },
  async () => {
    const id = await resolveAppId('123', credentials);
    assert.equal(id, '123', 'a numeric id that resolves is returned as-is (stringified)');
  },
);

await withFetch(
  (() => {
    const calls = [];
    return async (url) => {
      calls.push(url);
      if (calls.length === 1) {
        assert.match(url, /\/apps\/123$/);
        return { ok: false, status: 404, text: async () => 'missing' };
      }
      assert.match(url, /\/apps\?filter\[bundleId\]=ai\.kurat0r\.parkbound&limit=1$/);
      return { ok: true, json: async () => ({ data: [{ id: 'resolved-by-bundle' }] }) };
    };
  })(),
  async () => {
    const id = await resolveAppId('123', credentials);
    assert.equal(id, 'resolved-by-bundle', '404 on numeric id falls back to bundle-id lookup');
  },
);

await withFetch(
  async () => ({ ok: false, status: 500, text: async () => 'boom' }),
  async () => {
    await assert.rejects(
      () => resolveAppId('123', credentials),
      /ASC 500: boom/,
      'a non-404 error on the numeric-id probe is rethrown, not swallowed',
    );
  },
);

await withFetch(
  async (url) => {
    assert.match(url, /\/apps\?filter\[bundleId\]=com\.example\.app&limit=1$/);
    return { ok: true, json: async () => ({ data: [{ id: 'bundle-app-id' }] }) };
  },
  async () => {
    const id = await resolveAppId('com.example.app', credentials);
    assert.equal(id, 'bundle-app-id', 'a dotted bundle id is looked up directly');
  },
);

await withFetch(
  async () => ({ ok: true, json: async () => ({ data: [] }) }),
  async () => {
    await assert.rejects(
      () => resolveAppId('com.example.missing', credentials),
      /ASC app not found for bundle com\.example\.missing/,
    );
  },
);

console.log('app-store-connect: ok');
