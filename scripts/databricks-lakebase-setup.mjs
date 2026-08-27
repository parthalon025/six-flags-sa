#!/usr/bin/env node
/**
 * Full Databricks + Lakebase setup for Parkbound (/databricks-setup).
 *
 * 1. Verify CLI + auth
 * 2. Apply PostDB migrations to Lakebase (db/migrations/*.sql)
 * 3. Optional: bootstrap lakehouse bundle (paused jobs) via databricks:free-setup
 *
 *   npm run databricks:lakebase-setup
 *   npm run databricks:lakebase-setup -- --skip-bundle
 *   npm run databricks:lakebase-setup -- --check
 */

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authStatus, cliInstalled, lakebaseOAuthToken } from './lib/databricks-auth.mjs';
import { lakebaseFromEnv, loadRootEnv } from './lib/lakebase-config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const skipBundle = process.argv.includes('--skip-bundle');

function log(title, lines) {
  console.log(`\n## ${title}\n`);
  for (const line of lines) console.log(line);
}

function runNpm(script, extraArgs = []) {
  const r = spawnSync('npm', ['run', script, '--', ...extraArgs], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function probeDataApi(url) {
  const token = lakebaseOAuthToken();
  if (!token) return false;
  const r = spawnSync(
    'curl',
    ['-s', '-w', '\nHTTP:%{http_code}', '-H', `Authorization: Bearer ${token}`, `${url}/`],
    { encoding: 'utf8' },
  );
  console.log(r.stdout.trim());
  return r.stdout.includes('HTTP:200');
}

function main() {
  loadRootEnv();
  const lakebase = lakebaseFromEnv();

  log('Databricks setup', [
    'Workspace: ' + (process.env.DATABRICKS_HOST ?? '(unset)'),
    'Lakebase host: ' + (lakebase.host ?? '(unset)'),
    'Data API: ' + (lakebase.dataApiUrl ?? '(unset)'),
  ]);

  if (!cliInstalled()) {
    log('CLI missing', [
      'Install: curl -fsSL https://raw.githubusercontent.com/databricks/setup-cli/v1.13.0/install.sh | sh',
    ]);
    process.exit(1);
  }

  if (checkOnly && lakebase.dataApiUrl) {
    const ok = probeDataApi(lakebase.dataApiUrl);
    process.exit(ok ? 0 : 1);
  }

  const auth = authStatus();
  if (!auth.ok) {
    log('Auth required', [
      auth.detail ?? 'No valid credentials.',
      '',
      'Option A — OAuth (laptop):',
      `  databricks auth login --host "${process.env.DATABRICKS_HOST}" --profile default`,
      '  databricks auth token --profile default  → add as LAKEBASE_OAUTH_TOKEN',
      '',
      'Option B — Service principal (cloud agent / CI):',
      '  Add secrets DATABRICKS_CLIENT_ID + DATABRICKS_CLIENT_SECRET',
      '',
      'Option C — Full DATABASE_URL with Lakebase password/token in .env',
    ]);
    process.exit(1);
  }

  log('Auth', [`✓ ${auth.method}${auth.detail ? ` (${auth.detail})` : ''}`]);

  if (lakebase.dataApiUrl) {
    log('Data API probe', [`${lakebase.dataApiUrl}/`]);
    if (!probeDataApi(lakebase.dataApiUrl)) {
      console.warn('Data API not reachable yet — migrations may still succeed via psql.');
    }
  }

  runNpm('postdb:lakebase-setup');

  if (!skipBundle && auth.method !== 'oauth-jwt-env') {
    log('Lakehouse bundle', ['Deploying paused serverless jobs (workspace.bronze|silver|gold)…']);
    runNpm('databricks:free-setup');
  } else if (skipBundle) {
    log('Lakehouse bundle', ['Skipped (--skip-bundle).']);
  }

  log('Done', [
    'PostDB tables should exist in Lakebase.',
    'Factory verbs: set DATABASE_URL to Lakebase connection string in .env',
    'Lakehouse: cd databricks && databricks bundle run parkbound_ingest -t dev --profile default',
    'Docs: docs/guide/databricks.md',
  ]);
}

main();
