/**
 * Minimal App Store Connect API client (JWT + fetch).
 */
import { createSign, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ASC_BASE = 'https://api.appstoreconnect.apple.com/v1';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function createAscJwt({ keyId, issuerId, privateKeyPem }) {
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId, typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      iss: issuerId,
      iat: now,
      exp: now + 1200,
      aud: 'appstoreconnect-v1',
    }),
  );
  const data = `${header}.${payload}`;
  const key = createPrivateKey(privateKeyPem);
  const sign = createSign('SHA256');
  sign.update(data);
  sign.end();
  const signature = sign.sign({ key, dsaEncoding: 'ieee-p1363' });
  return `${data}.${base64url(signature)}`;
}

export function loadAscCredentialsFromEnv() {
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID;
  const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
  const keyPath = process.env.APP_STORE_CONNECT_API_KEY_PATH;
  const keyB64 = process.env.APP_STORE_CONNECT_API_KEY;

  if (!keyId || !issuerId) return null;

  let privateKeyPem;
  if (keyPath) {
    privateKeyPem = readFileSync(keyPath, 'utf8');
  } else if (keyB64) {
    privateKeyPem = Buffer.from(keyB64, 'base64').toString('utf8');
    if (!privateKeyPem.includes('BEGIN PRIVATE KEY')) {
      privateKeyPem = keyB64;
    }
  } else {
    return null;
  }

  return { keyId, issuerId, privateKeyPem };
}

export async function ascGet(path, credentials) {
  const token = createAscJwt(credentials);
  const response = await fetch(`${ASC_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ASC ${response.status}: ${body.slice(0, 200)}`);
  }
  return response.json();
}

/**
 * @returns {Promise<{ live: object|null, listing: object|null, testflight: object|null }>}
 */
export async function fetchIosStoreVersions(appleId, credentials) {
  const appPath = `/apps/${appleId}/appStoreVersions?filter[platform]=IOS&limit=20`;
  const versionsBody = await ascGet(appPath, credentials);
  const versions = versionsBody.data ?? [];

  const liveStates = new Set([
    'READY_FOR_SALE',
    'PENDING_DEVELOPER_RELEASE',
    'PROCESSING_FOR_APP_STORE',
  ]);
  const listingStates = new Set([
    'PREPARE_FOR_SUBMISSION',
    'READY_FOR_REVIEW',
    'WAITING_FOR_REVIEW',
    'IN_REVIEW',
    'PENDING_APPLE_RELEASE',
    'REJECTED',
    'METADATA_REJECTED',
    'DEVELOPER_REJECTED',
  ]);

  const live = versions.find((v) => liveStates.has(v.attributes?.appStoreState)) ?? null;
  const listing = versions.find((v) => listingStates.has(v.attributes?.appStoreState)) ?? null;

  let testflight = null;
  try {
    const buildsBody = await ascGet(
      `/builds?filter[app]=${appleId}&sort=-uploadedDate&limit=5`,
      credentials,
    );
    const build = buildsBody.data?.[0];
    if (build) {
      testflight = {
        version: build.attributes?.version ?? null,
        buildNumber: build.attributes?.version ?? null,
        processingState: build.attributes?.processingState ?? null,
        uploadedDate: build.attributes?.uploadedDate ?? null,
      };
    }
  } catch {
    // builds may be empty pre-launch
  }

  return {
    live: live
      ? {
          version: live.attributes?.versionString ?? null,
          state: live.attributes?.appStoreState ?? null,
        }
      : null,
    listing: listing
      ? {
          version: listing.attributes?.versionString ?? null,
          state: listing.attributes?.appStoreState ?? null,
        }
      : null,
    testflight,
  };
}
