/**
 * Databricks CLI auth helpers for setup scripts.
 * Supports OAuth profile, M2M service principal env, and OAuth JWT for Lakebase Data API.
 */

import { execSync, spawnSync } from 'node:child_process';

const profile = () => process.env.DATABRICKS_CONFIG_PROFILE || 'default';

/**
 * @returns {boolean}
 */
export function cliInstalled() {
  return spawnSync('databricks', ['--version'], { encoding: 'utf8' }).status === 0;
}

/**
 * @returns {{ ok: boolean, method?: string, detail?: string }}
 */
export function authStatus() {
  if (!process.env.DATABRICKS_HOST) {
    return { ok: false, detail: 'DATABRICKS_HOST unset' };
  }

  const m2m =
    process.env.DATABRICKS_CLIENT_ID &&
    process.env.DATABRICKS_CLIENT_SECRET;
  if (m2m) {
    const r = spawnSync('databricks', ['current-user', 'me', '-o', 'json'], {
      encoding: 'utf8',
      env: process.env,
    });
    if (r.status === 0) return { ok: true, method: 'm2m' };
  }

  const r = spawnSync(
    'databricks',
    ['current-user', 'me', '-o', 'json', '--profile', profile()],
    { encoding: 'utf8', env: process.env },
  );
  if (r.status === 0) return { ok: true, method: `profile:${profile()}` };

  if (process.env.LAKEBASE_OAUTH_TOKEN || process.env.DATABRICKS_OAUTH_TOKEN) {
    return { ok: true, method: 'oauth-jwt-env', detail: 'Lakebase/Data API only — no workspace CLI' };
  }

  return {
    ok: false,
    detail:
      'Run `databricks auth login` or set DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET, or LAKEBASE_OAUTH_TOKEN',
  };
}

/**
 * @param {string} cmd Shell command returning JSON on stdout
 */
export function databricksJson(cmd) {
  const out = execSync(cmd, { encoding: 'utf8', env: process.env });
  return JSON.parse(out);
}

/**
 * OAuth JWT for Lakebase Data API (from env or CLI token cache after U2M login).
 * @returns {string | undefined}
 */
export function lakebaseOAuthToken() {
  if (process.env.LAKEBASE_OAUTH_TOKEN) return process.env.LAKEBASE_OAUTH_TOKEN;
  if (process.env.DATABRICKS_OAUTH_TOKEN) return process.env.DATABRICKS_OAUTH_TOKEN;
  const r = spawnSync(
    'databricks',
    ['auth', 'token', '--profile', profile(), '-o', 'json'],
    { encoding: 'utf8', env: process.env },
  );
  if (r.status !== 0) return undefined;
  try {
    const parsed = JSON.parse(r.stdout);
    return parsed.access_token ?? parsed.token;
  } catch {
    return undefined;
  }
}
