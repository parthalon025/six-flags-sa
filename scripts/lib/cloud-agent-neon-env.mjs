/** Materialize Neon DATABASE_URL for Cloud Agents from injected secrets (never commit values). */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Park Bound Cursor Cloud environment — secrets tab in dashboard. */
export const PARKBOUND_CLOUD_ENV_URL =
  'https://cursor.com/dashboard/cloud-agents/environments/e/d8097811-95a0-11f1-ba66-0e7d0216e441';

/** Keys written into app/root env files when present in process env. */
export const NEON_ENV_KEYS = ['DATABASE_URL', 'DATABASE_URL_UNPOOLED'];

/** Secrets that must be set on the Cursor Cloud environment for Neon Postgres. */
export const NEON_REQUIRED_SECRET_KEYS = ['DATABASE_URL'];

/** @param {string} text */
export function parseEnvFile(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return out;
}

/** @param {Record<string, string>} vars */
export function formatEnvFile(vars) {
  return `${Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Merge `vars` into an env file, preserving unrelated keys (e.g. Clerk).
 * @param {string} path
 * @param {Record<string, string>} vars
 */
export function upsertEnvFile(path, vars) {
  mkdirSync(dirname(path), { recursive: true });
  const existing = existsSync(path) ? parseEnvFile(readFileSync(path, 'utf8')) : {};
  writeFileSync(path, formatEnvFile({ ...existing, ...vars }), 'utf8');
}

/** @param {string} root */
export function partyTrackerEnvLocalPath(root) {
  return join(root, 'apps/party-tracker/.env.local');
}

/** @param {string} root */
export function rootEnvPath(root) {
  return join(root, '.env');
}

/** @param {NodeJS.ProcessEnv} env */
export function neonEnvFromProcess(env = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of NEON_ENV_KEYS) {
    const value = String(env[key] || '').trim();
    if (value) out[key] = value;
  }
  return out;
}

/** @param {NodeJS.ProcessEnv} env */
export function neonCloudSecretsStatus(env = process.env) {
  /** @type {string[]} */
  const missing = [];
  for (const key of NEON_REQUIRED_SECRET_KEYS) {
    if (!String(env[key] || '').trim()) missing.push(key);
  }
  return {
    ok: missing.length === 0,
    missing,
    dashboardUrl: PARKBOUND_CLOUD_ENV_URL,
  };
}

/**
 * Merge Neon keys into `apps/party-tracker/.env.local` when Cloud secrets supply DATABASE_URL.
 * Preserves Clerk and other keys already in the file.
 * @returns {{ wrote: true, path: string } | { wrote: false, reason: string, missing?: string[] }}
 */
export function writePartyTrackerNeonEnv(root, env = process.env) {
  const status = neonCloudSecretsStatus(env);
  if (!status.ok) {
    return {
      wrote: false,
      reason: `missing Cloud secrets: ${status.missing.join(', ')}`,
      missing: status.missing,
    };
  }
  const vars = neonEnvFromProcess(env);
  const path = partyTrackerEnvLocalPath(root);
  upsertEnvFile(path, vars);
  return { wrote: true, path };
}

/**
 * Merge Neon keys into root `.env` for scripts that use `--env-file=.env`.
 * @returns {{ wrote: true, path: string } | { wrote: false, reason: string, missing?: string[] }}
 */
export function writeRootNeonEnv(root, env = process.env) {
  const status = neonCloudSecretsStatus(env);
  if (!status.ok) {
    return {
      wrote: false,
      reason: `missing Cloud secrets: ${status.missing.join(', ')}`,
      missing: status.missing,
    };
  }
  const vars = neonEnvFromProcess(env);
  const path = rootEnvPath(root);
  upsertEnvFile(path, vars);
  return { wrote: true, path };
}
