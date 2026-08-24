#!/usr/bin/env node
/**
 * Apply PostDB + E0 migrations to Lakebase Postgres.
 *
 * Auth (pick one):
 *   1. OAuth CLI profile — `databricks auth login` then:
 *        npm run postdb:lakebase-setup
 *   2. Full DATABASE_URL with password/token in .env
 *   3. LAKEBASE_ENDPOINT + valid `databricks` profile → generates 1h OAuth password
 *
 *   npm run postdb:lakebase-setup
 *   npm run postdb:lakebase-setup -- --check   # Data API health only
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { authStatus, databricksJson as jsonCmd, lakebaseOAuthToken } from './lib/databricks-auth.mjs';
import {
  lakebaseFromEnv,
  loadRootEnv,
  migrationFiles,
  migrationPath,
} from './lib/lakebase-config.mjs';

const profile = process.env.DATABRICKS_CONFIG_PROFILE || 'default';
const checkOnly = process.argv.includes('--check');

function log(title, lines) {
  console.log(`\n## ${title}\n`);
  for (const line of lines) console.log(line);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', ...opts });
}

function tryRun(cmd, opts = {}) {
  try {
    run(cmd, opts);
    return true;
  } catch {
    return false;
  }
}

function databricksJson(cmd) {
  return jsonCmd(cmd);
}

function workspaceCliAuth() {
  const auth = authStatus();
  return auth.ok && auth.method !== 'oauth-jwt-env';
}

function checkDataApi(dataApiUrl) {
  const token = process.env.LAKEBASE_OAUTH_TOKEN || process.env.DATABRICKS_OAUTH_TOKEN;
  if (!token) {
    log('Data API', [
      'Set LAKEBASE_OAUTH_TOKEN (OAuth JWT from `databricks auth token`) to probe the Data API.',
      `URL: ${dataApiUrl}`,
    ]);
    return false;
  }
  const probe = spawnSync(
    'curl',
    ['-s', '-w', '\nHTTP:%{http_code}', '-H', `Authorization: Bearer ${token}`, `${dataApiUrl}/`],
    { encoding: 'utf8' },
  );
  console.log(probe.stdout.trim());
  return probe.stdout.includes('HTTP:200');
}

function findEndpointByHost(host) {
  const projects = databricksJson(`databricks postgres list-projects --profile ${profile} -o json`);
  const items = projects.projects ?? projects.items ?? projects ?? [];
  for (const project of items) {
    const projectName = project.name ?? project;
    const branches = databricksJson(
      `databricks postgres list-branches ${projectName} --profile ${profile} -o json`,
    );
    const branchItems = branches.branches ?? branches.items ?? branches ?? [];
    for (const branch of branchItems) {
      const branchName = branch.name ?? branch;
      const endpoints = databricksJson(
        `databricks postgres list-endpoints ${branchName} --profile ${profile} -o json`,
      );
      const endpointItems = endpoints.endpoints ?? endpoints.items ?? endpoints ?? [];
      for (const endpoint of endpointItems) {
        const endpointName = endpoint.name ?? endpoint;
        const detail = databricksJson(
          `databricks postgres get-endpoint ${endpointName} --profile ${profile} -o json`,
        );
        const epHost = detail.status?.hosts?.host ?? detail.host;
        if (epHost === host) return { endpointName, epHost };
      }
    }
  }
  return null;
}

function generatePgPassword(endpointName) {
  const cred = databricksJson(
    `databricks postgres generate-database-credential ${endpointName} --profile ${profile} -o json`,
  );
  return cred.token;
}

function applyMigrationsViaPsql(connectionUrl) {
  for (const file of migrationFiles()) {
    run(`psql "${connectionUrl}" -v ON_ERROR_STOP=1 -f "${migrationPath(file)}"`);
  }
}

function applyMigrationsViaDatabricksPsql() {
  const target = process.env.LAKEBASE_ENDPOINT
    ? `databricks psql ${process.env.LAKEBASE_ENDPOINT} --profile ${profile} --`
    : `databricks psql --autoscaling --profile ${profile} --`;
  for (const file of migrationFiles()) {
    run(`${target} -v ON_ERROR_STOP=1 -f "${migrationPath(file)}"`);
  }
}

function buildConnectionUrl({ host, user, database }, password) {
  const encUser = encodeURIComponent(user);
  const encPass = encodeURIComponent(password);
  return `postgresql://${encUser}:${encPass}@${host}/${database}?sslmode=require`;
}

function main() {
  loadRootEnv();
  const lakebase = lakebaseFromEnv();

  log('PostDB on Lakebase', [
    'Applies db/migrations/*.sql to your Lakebase Postgres instance.',
    'Lakebase Data API is for CRUD after tables exist — migrations need SQL/psql.',
  ]);

  if (lakebase.dataApiUrl && checkOnly) {
    const ok = checkDataApi(lakebase.dataApiUrl);
    process.exit(ok ? 0 : 1);
  }

  if (process.env.DATABASE_URL) {
    log('Using DATABASE_URL', ['Applying migrations via psql…']);
    applyMigrationsViaPsql(process.env.DATABASE_URL);
    log('Done', ['All migrations applied.']);
    return;
  }

  const oauthPassword = lakebaseOAuthToken();
  if (oauthPassword && lakebase.host && lakebase.user) {
    log('Using LAKEBASE OAuth token', ['Applying migrations via psql…']);
    const url = buildConnectionUrl(lakebase, oauthPassword);
    applyMigrationsViaPsql(url);
    log('Done', [
      'Migrations applied.',
      lakebase.dataApiUrl
        ? `Data API: ${lakebase.dataApiUrl}/public/<table>`
        : 'Set LAKEBASE_DATA_API_URL for REST access.',
    ]);
    return;
  }

  if (!workspaceCliAuth()) {
    log('Databricks auth required', [
      'No valid CLI profile. Run `/databricks-setup` (OAuth) or add secrets:',
      '  DATABRICKS_HOST=https://dbc-e989baa1-6212.cloud.databricks.com',
      '  DATABRICKS_TOKEN=<fresh PAT or OAuth JWT>',
      '',
      'Then: databricks configure --token --profile default  (on your machine)',
      'Or:    databricks auth login --host $DATABRICKS_HOST --profile default',
    ]);
    process.exit(1);
  }

  if (lakebase.host && lakebase.user) {
    const endpoint =
      process.env.LAKEBASE_ENDPOINT ??
      findEndpointByHost(lakebase.host)?.endpointName;
    if (!endpoint) {
      log('Lakebase endpoint', [
        `Could not resolve endpoint for host ${lakebase.host}.`,
        'Set LAKEBASE_ENDPOINT=projects/.../branches/.../endpoints/... in .env',
      ]);
      process.exit(1);
    }
    const password = generatePgPassword(endpoint);
    const url = buildConnectionUrl(lakebase, password);
    applyMigrationsViaPsql(url);
    log('Done', [
      'Migrations applied.',
      lakebase.dataApiUrl
        ? `Data API: ${lakebase.dataApiUrl}/public/<table>`
        : 'Set LAKEBASE_DATA_API_URL for REST access after tables exist.',
    ]);
    return;
  }

  if (existsSync('/usr/bin/psql') || spawnSync('which', ['psql']).status === 0) {
    log('Databricks psql', ['Trying autoscaling psql with OAuth profile…']);
    applyMigrationsViaDatabricksPsql();
    log('Done', ['Migrations applied via databricks psql.']);
    return;
  }

  log('Missing Lakebase config', [
    'Set LAKEBASE_PG_HOST, LAKEBASE_PG_USER, and LAKEBASE_PG_DATABASE in .env',
    'or provide DATABASE_URL with password/token.',
  ]);
  process.exit(1);
}

main();
