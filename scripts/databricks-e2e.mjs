#!/usr/bin/env node
/**
 * End-to-end Databricks pipeline smoke (cloud compute — costs per run).
 *
 * Uses fixture mode (PARKBOUND_E2E_FIXTURES=1 on dev target) so jobs do not
 * need public Postgres or a running Parkbound API.
 *
 *   npm run databricks:e2e
 *   npm run databricks:e2e -- --skip-llm   # skip LLM job if no PAT
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundleDir = join(root, 'databricks');
const envPath = join(root, '.env');
const profile = process.env.DATABRICKS_CONFIG_PROFILE || 'default';
const skipLlm = process.argv.includes('--skip-llm');

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

function run(cmd, opts = {}) {
  const display = cmd.replace(/(databricks_token=)\S+/gi, '$1***');
  console.log(`\n> ${display}\n`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
  });
}

function main() {
  loadEnvFile();

  if (!process.env.DATABRICKS_HOST) {
    console.error('DATABRICKS_HOST required in .env — run npm run databricks:free-setup first.');
    process.exit(1);
  }

  console.log('Parkbound Databricks e2e (fixture mode, dev target)');
  console.log(`Host: ${process.env.DATABRICKS_HOST}`);
  console.log(`Profile: ${profile}`);
  if (skipLlm) console.log('Skipping LLM job (--skip-llm)');

  run('pytest databricks/tests -q', { cwd: root });

  run(`databricks bundle validate -t dev --profile ${profile}`, { cwd: bundleDir });

  run(`databricks bundle deploy -t dev --profile ${profile}`, { cwd: bundleDir });

  const jobs = [
    'parkbound_ingest',
    'parkbound_consolidate',
    'parkbound_guest_traces',
  ];
  if (!skipLlm) jobs.push('parkbound_llm_research');

  for (const job of jobs) {
    run(`databricks bundle run ${job} -t dev --profile ${profile}`, { cwd: bundleDir });
  }

  console.log('\n✓ All Databricks e2e jobs completed successfully.');
  console.log('Verify Delta tables in Catalog Explorer: workspace.bronze|silver|gold.*');
}

main();
