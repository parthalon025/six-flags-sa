/** Materialize Clerk env for Cloud Agents from injected secrets (never commit values). */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CLERK_ENV_KEYS = [
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
  'NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL',
  'NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL',
];

export const CLERK_ENV_DEFAULTS = {
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
  NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/',
  NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/',
};

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

/** @param {Record<string, string>} vars */
export function formatEnvFile(vars) {
  return `${Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
}

/**
 * Write `apps/party-tracker/.env.local` when Cloud secrets supply a publishable key.
 * @returns {{ wrote: true, path: string } | { wrote: false, reason: string }}
 */
export function writePartyTrackerClerkEnv(root, env = process.env) {
  const vars = clerkEnvFromProcess(env);
  if (!vars.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return { wrote: false, reason: 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY unset' };
  }
  const path = join(root, 'apps/party-tracker/.env.local');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatEnvFile(vars), 'utf8');
  return { wrote: true, path };
}
