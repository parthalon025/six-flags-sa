/** Materialize Clerk env for Cloud Agents from injected secrets (never commit values). */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Park Bound Cursor Cloud environment — secrets tab in dashboard. */
export const PARKBOUND_CLOUD_ENV_URL =
  'https://cursor.com/dashboard/cloud-agents/environments/e/d8097811-95a0-11f1-ba66-0e7d0216e441';

export const CLERK_ENV_KEYS = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL',
];

export const CLERK_REQUIRED_SECRET_KEYS = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
];

export const CLERK_ENV_DEFAULTS = {
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/',
};

/**
 * CI / browser vertical may boot the map without Clerk keys. Production and
 * local dev still require real keys (ClerkSetupRequired when absent).
 */
export const CLERK_CI_KEYLESS_ENV = {
  NEXT_PUBLIC_CLERK_CI_KEYLESS_OK: '1',
};

/** @param {NodeJS.ProcessEnv} env */
export function isClerkCiKeylessEnv(env = process.env) {
  return env.NEXT_PUBLIC_CLERK_CI_KEYLESS_OK === '1';
}

/** @param {string} root */
export function partyTrackerEnvLocalPath(root) {
  return join(root, 'apps/party-tracker/.env.local');
}

/** @param {string} root */
export function clerkEnvFileAllowsCiBuild(root) {
  const path = partyTrackerEnvLocalPath(root);
  if (!existsSync(path)) return false;
  const text = readFileSync(path, 'utf8');
  return /^NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_/m.test(text)
    || /^NEXT_PUBLIC_CLERK_CI_KEYLESS_OK=1/m.test(text);
}

/** @param {NodeJS.ProcessEnv} env */
export function clerkEnvFromProcess(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of CLERK_ENV_KEYS) {
    const value = env[key] ?? CLERK_ENV_DEFAULTS[key];
    if (value) out[key] = value;
  }
  return out;
}

/** @param {NodeJS.ProcessEnv} env */
export function clerkCloudSecretsStatus(env = process.env) {
  /** @type {string[]} */
  const missing = [];
  for (const key of CLERK_REQUIRED_SECRET_KEYS) {
    if (!String(env[key] || '').trim()) missing.push(key);
  }
  return {
    ok: missing.length === 0,
    missing,
    dashboardUrl: PARKBOUND_CLOUD_ENV_URL,
  };
}

/** @param {Record<string, string>} vars */
export function formatEnvFile(vars) {
  return `${Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Write `apps/party-tracker/.env.local` when Cloud secrets supply a publishable key.
 * @returns {{ wrote: true, path: string } | { wrote: false, reason: string, missing?: string[] }}
 */
export function writePartyTrackerClerkEnv(root, env = process.env) {
  const status = clerkCloudSecretsStatus(env);
  if (!status.ok) {
    return {
      wrote: false,
      reason: `missing Cloud secrets: ${status.missing.join(', ')}`,
      missing: status.missing,
    };
  }
  const vars = clerkEnvFromProcess(env);
  const path = partyTrackerEnvLocalPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatEnvFile(vars), 'utf8');
  return { wrote: true, path };
}

/**
 * Materialize Clerk env before an app build. Prefer Cloud secrets; fall back to
 * keyless CI mode so browser verticals still draw the map without fake keys.
 *
 * @returns {{ wrote: true, path: string, source: 'cloud' | 'keyless' } | { wrote: false, reason: string }}
 */
export function ensureClerkEnvForCi(root, env = process.env) {
  const status = clerkCloudSecretsStatus(env);
  if (status.ok) {
    const result = writePartyTrackerClerkEnv(root, env);
    if (!result.wrote) return result;
    return { ...result, source: 'cloud' };
  }
  const path = partyTrackerEnvLocalPath(root);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatEnvFile(CLERK_CI_KEYLESS_ENV), 'utf8');
  return { wrote: true, path, source: 'keyless' };
}
