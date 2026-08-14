#!/usr/bin/env node
/**
 * Zero-cost Parkbound + Databricks bootstrap.
 *
 * - Dev bundle jobs deploy with PAUSED schedules (no idle cluster spend)
 * - Local pipeline smoke via export:databricks (no cloud compute)
 * - Skips Databricks App deploy (24/7 compute)
 *
 * Prerequisites: Databricks CLI OAuth (`databricks auth login`), DATABRICKS_HOST in env or .env
 *
 *   npm run databricks:free-setup
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const examplePath = join(root, '.env.example');

function log(section, lines) {
  console.log(`\n## ${section}\n`);
  for (const line of lines) console.log(line);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: opts.cwd ?? root, env: { ...process.env, ...opts.env } });
}

function tryRun(cmd, opts = {}) {
  try {
    run(cmd, opts);
    return true;
  } catch {
    return false;
  }
}

function loadEnvFile() {
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

function ensureEnv() {
  loadEnvFile();
  const host = process.env.DATABRICKS_HOST?.replace(/\/$/, '');
  if (host) return host;

  log('Missing DATABRICKS_HOST', [
    'Add to .env at repo root (see .env.example free-tier section):',
    '  DATABRICKS_HOST=https://YOUR-WORKSPACE.cloud.databricks.com',
    '',
    'Then re-run: npm run databricks:free-setup',
  ]);
  process.exit(1);
}

function ensureDotEnv(host) {
  if (existsSync(envPath)) {
    const body = readFileSync(envPath, 'utf8');
    if (!body.includes('DATABRICKS_HOST=')) {
      writeFileSync(envPath, `${body.trimEnd()}\nDATABRICKS_HOST=${host}\n`, 'utf8');
      console.log(`Appended DATABRICKS_HOST to ${envPath}`);
    }
    return;
  }

  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
  const freeBlock = [
    '# --- Free tier (auto-seeded by npm run databricks:free-setup) ---',
    `DATABRICKS_HOST=${host}`,
    '# Leave DATABASE_URL unset for in-memory contributions (npm run dev).',
    '# Or: docker compose up -d db  then uncomment:',
    '# DATABASE_URL=postgres://parkbound:parkbound@localhost:5432/parkbound',
    '# Vercel free: Neon + Upstash via Marketplace — see docs/guide/databricks.md',
    'VENUE_LLM_PROVIDER=openai',
    '',
  ].join('\n');

  writeFileSync(envPath, `${freeBlock}${example}`, 'utf8');
  console.log(`Created ${envPath} (gitignored)`);
}

function main() {
  const host = ensureEnv();
  ensureDotEnv(host);

  log('Free tier policy', [
    '✓ Databricks dev job schedules: PAUSED (bundle target dev)',
    '✓ Databricks App: not deployed (avoid 24/7 compute)',
    '✓ Local smoke: export:databricks + pytest (no Spark spend)',
    '✓ LLM: openai default (not Databricks Model Serving)',
    '',
    'Vercel/Neon/Upstash: add via Vercel Marketplace on Hobby ($0) — manual step below.',
  ]);

  const profile = process.env.DATABRICKS_CONFIG_PROFILE || 'default';

  if (!tryRun('databricks auth profiles')) {
    log('Databricks auth', [
      `Run: databricks auth login --host ${host} --profile ${profile}`,
    ]);
    process.exit(1);
  }

  tryRun(`databricks catalogs create parkbound_dev --profile ${profile}`);
  const catalogNote = [
    'Dev bundle uses Unity Catalog `workspace` (already exists on new workspaces).',
    'Optional later: Catalog Explorer → Create catalog `parkbound_dev` (Default Storage UI),',
    'then set dev target catalog in databricks/databricks.yml.',
  ];

  log('Unity Catalog', catalogNote);

  run('databricks aitools install --scope project', {
    env: { DATABRICKS_CONFIG_PROFILE: profile },
  });

  run('databricks bundle validate -t dev --profile default', {
    cwd: join(root, 'databricks'),
  });

  run('databricks bundle deploy -t dev --profile default', {
    cwd: join(root, 'databricks'),
  });

  run('npm run export:databricks');
  const pytest = spawnSync('pytest', ['databricks/tests', '-q'], { cwd: root, stdio: 'inherit', shell: true });
  if (pytest.status !== 0) process.exit(pytest.status ?? 1);

  log('Manual $0 steps (Vercel dashboard)', [
    '1. Vercel Hobby plan — host the PWA (non-commercial/personal OK on Hobby).',
    '2. Storage → Neon — Free plan (256 MB, 500K cmds/mo via Marketplace).',
    '3. Storage → Upstash Redis — Free (256 MB, 500K cmds/mo) if you need cross-instance party store.',
    '4. Do NOT deploy Databricks App park-bound until you need steward UI.',
    '5. To run a job manually (pay per run only):',
    `     cd databricks && databricks bundle run parkbound_ingest -t dev --profile ${profile}`,
    '',
    'Docs: docs/guide/databricks.md',
  ]);
}

main();
