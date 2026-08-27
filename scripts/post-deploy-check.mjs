#!/usr/bin/env node
/**
 * Post-deploy smoke — readiness, migration ledger, Clerk webhook route (#443).
 *
 *   npm run deploy:post-check -- --url https://parkbound.kurat0r.ai
 *   POST_DEPLOY_URL=https://... npm run deploy:post-check
 *
 * Migration check uses DATABASE_URL (direct Postgres), not the HTTP base URL.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrationFiles } from './lib/lakebase-config.mjs';
import { runPostDeployChecks } from './lib/post-deploy-check.mjs';

function parseArgs(argv) {
  let baseUrl = process.env.POST_DEPLOY_URL || process.env.DEPLOY_BASE_URL || '';
  let skipMigrations = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url') baseUrl = argv[++i] ?? '';
    else if (arg === '--skip-migrations') skipMigrations = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: post-deploy-check.mjs --url <base-url> [--skip-migrations]');
      process.exit(0);
    }
  }
  return { baseUrl, skipMigrations };
}

async function migrationQuery(sql) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required for migration check');
  }
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    return await pool.query(sql);
  } finally {
    await pool.end();
  }
}

async function main() {
  const { baseUrl, skipMigrations } = parseArgs(process.argv.slice(2));
  if (!baseUrl) {
    console.error('post-deploy-check: --url or POST_DEPLOY_URL is required');
    process.exit(1);
  }

  const result = await runPostDeployChecks({
    baseUrl,
    skipMigrations,
    query: skipMigrations ? undefined : migrationQuery,
    expectedMigrations: migrationFiles(),
  });

  if (!result.ok) {
    console.error('post-deploy-check failed:');
    for (const line of result.failures) console.error(`  - ${line}`);
    process.exit(1);
  }

  console.log('post-deploy-check: ok');
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
