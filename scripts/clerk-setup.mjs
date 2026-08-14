#!/usr/bin/env node
/**
 * Park Bound Clerk instance bootstrap (ADR-0010).
 *
 *   npm run clerk:setup
 *   npm run clerk:setup -- --instance prod
 *
 * Prod OAuth credentials (optional, gitignored local files):
 *   scripts/lib/clerk-google-connection.json
 *   scripts/lib/clerk-apple-connection.json
 *   (copy from *.example.json)
 *
 * DNS: set CLOUDFLARE_API_TOKEN to auto-add Clerk CNAMEs on kurat0r.ai.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const configDev = join(root, 'scripts/lib/clerk-parkbound-config.json');
const configProd = join(root, 'scripts/lib/clerk-parkbound-config-prod.json');
const googleCreds = join(root, 'scripts/lib/clerk-google-connection.json');
const appleCreds = join(root, 'scripts/lib/clerk-apple-connection.json');
const appEnv = join(root, 'apps/party-tracker/.env.local');
const cfZoneId = process.env.CLOUDFLARE_ZONE_KURAT0R_AI || 'a9acfeaffc5c15efc8db46bb7acbeac8';

const REDIRECT_URLS = [
  'http://localhost:3000',
  'https://parkbound.kurat0r.ai',
  'https://six-flags-sa-parthalon025s-projects.vercel.app',
  'https://six-flags-sa.vercel.app',
  'ai.kurat0r.parkbound://callback',
];

/** Clerk deploy pendingDnsRecords → Cloudflare record names on kurat0r.ai */
const CLERK_DNS = [
  { name: 'clerk.parkbound', content: 'frontend-api.clerk.services' },
  { name: 'accounts.parkbound', content: 'accounts.clerk.services' },
  { name: 'clkmail.parkbound', content: 'mail.a2xh7o9m1xjg.clerk.services' },
  { name: 'clk._domainkey.parkbound', content: 'dkim1.a2xh7o9m1xjg.clerk.services' },
  { name: 'clk2._domainkey.parkbound', content: 'dkim2.a2xh7o9m1xjg.clerk.services' },
];

function log(section, lines) {
  console.log(`\n## ${section}\n`);
  for (const line of lines) console.log(line);
}

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  try {
    return execSync(cmd, {
      stdio: opts.silent ? 'pipe' : 'inherit',
      cwd: opts.cwd ?? root,
      encoding: opts.silent ? 'utf8' : undefined,
      env: { ...process.env, ...opts.env },
    });
  } catch (err) {
    if (opts.silent) throw err;
    const detail = [err.stderr, err.stdout].filter(Boolean).join('\n').trim();
    if (detail) console.error(detail);
    throw err;
  }
}

function runJson(cmd) {
  return JSON.parse(run(cmd, { silent: true }));
}

function clerkJson(args) {
  try {
    return runJson(`clerk ${args}`);
  } catch (err) {
    const raw = [err.stdout, err.stderr].filter(Boolean).join('\n').trim();
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch {
        /* multi-line JSON is the whole stdout */
      }
    }
    return { error: { message: err.message || 'Clerk command failed' } };
  }
}

function clerk(args) {
  run(`clerk ${args}`);
}

function targetInstance(argv) {
  const i = argv.indexOf('--instance');
  const value = i >= 0 && argv[i + 1] ? argv[i + 1] : 'dev';
  return { value, flag: value === 'dev' ? '' : `--instance ${value}` };
}

function deployStatus() {
  return clerkJson('deploy status');
}

function ensureProductionReady() {
  const status = deployStatus();
  if (
    status?.error?.code === 'instance_not_found' ||
    status?.state === 'not_started' ||
    (!status?.productionInstanceId && status?.state !== 'domain_pending')
  ) {
    log('Production instance not ready', [
      'Run `clerk deploy` first, then re-run with `--instance prod`.',
      'Docs: https://clerk.com/docs/guides/development/managing-environments',
    ]);
    process.exit(1);
  }
  return status;
}

function ensureClerkHealthy() {
  const checks = runJson('clerk doctor --json');
  const fails = checks.filter((c) => c.status === 'fail');
  if (fails.length) {
    log('Clerk doctor failed', fails.map((f) => `- ${f.name}: ${f.message}`));
    process.exit(1);
  }
}

async function cfFetch(path, { method = 'GET', body } = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) return null;
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!json.success) {
    throw new Error(json.errors?.[0]?.message || 'Cloudflare API error');
  }
  return json;
}

async function syncClerkDns() {
  if (!process.env.CLOUDFLARE_API_TOKEN) {
    console.log('  skip: CLOUDFLARE_API_TOKEN not set');
    return;
  }
  const listed = await cfFetch(`/zones/${cfZoneId}/dns_records?per_page=100`);
  const byName = new Set((listed.result || []).map((r) => r.name.toLowerCase()));
  for (const rec of CLERK_DNS) {
    const fqdn = `${rec.name}.kurat0r.ai`.toLowerCase();
    if (byName.has(fqdn)) {
      console.log(`  skip (exists): ${fqdn}`);
      continue;
    }
    console.log(`  add: ${fqdn} → ${rec.content}`);
    await cfFetch(`/zones/${cfZoneId}/dns_records`, {
      method: 'POST',
      body: { type: 'CNAME', name: rec.name, content: rec.content, ttl: 1, proxied: false },
    });
  }
}

function listRedirectUrls(instanceFlag) {
  const rows = runJson(`clerk api /redirect_urls --yes ${instanceFlag}`.trim());
  return new Set((Array.isArray(rows) ? rows : []).map((r) => r.url));
}

function addRedirectUrl(url, instanceFlag) {
  const tmp = join(root, '.clerk-redirect-tmp.json');
  writeFileSync(tmp, JSON.stringify({ url }));
  try {
    clerk(`api /redirect_urls -X POST --file "${tmp}" --yes ${instanceFlag}`.trim());
  } finally {
    unlinkSync(tmp);
  }
}

function syncRedirectUrls(instanceFlag) {
  const existing = listRedirectUrls(instanceFlag);
  for (const url of REDIRECT_URLS) {
    if (existing.has(url)) {
      console.log(`  skip (exists): ${url}`);
      continue;
    }
    console.log(`  add: ${url}`);
    addRedirectUrl(url, instanceFlag);
  }
}

function applyConfigPatches(isProd, inst) {
  const base = isProd ? configProd : configDev;
  log('Instance config', [
    isProd
      ? 'Applying base prod patch (no OAuth until credential files exist)…'
      : 'Applying OAuth-only dev patch (Google + Apple, no email/password)…',
  ]);
  clerk(`config patch --file "${base}" --yes ${inst}`.trim());

  if (isProd) {
    let oauthReady = true;
    if (existsSync(googleCreds)) {
      console.log('  applying Google OAuth credentials…');
      clerk(`config patch --file "${googleCreds}" --yes ${inst}`.trim());
    } else {
      console.log('  skip Google OAuth — add scripts/lib/clerk-google-connection.json');
      oauthReady = false;
    }
    if (existsSync(appleCreds)) {
      console.log('  applying Apple OAuth credentials…');
      clerk(`config patch --file "${appleCreds}" --yes ${inst}`.trim());
    } else {
      console.log('  skip Apple OAuth — add scripts/lib/clerk-apple-connection.json');
      oauthReady = false;
    }
    if (!oauthReady) {
      log('Prod OAuth still pending', [
        'Copy scripts/lib/clerk-*-connection.example.json → clerk-*-connection.json',
        'Fill in credentials, re-run: npm run clerk:setup -- --instance prod',
      ]);
    }
  }
}

function printManualFollowUps(isProd, status) {
  if (!isProd) {
    log('Manual follow-ups', [
      '1. `clerk deploy` then `npm run clerk:setup -- --instance prod`',
      '2. OAuth credential JSON files for prod (see scripts/lib/*.example.json)',
      '3. Webhook + CLERK_WEBHOOK_SIGNING_SECRET on Vercel',
    ]);
    return;
  }
  const dns = status?.domainStatus?.dns;
  const oauth = status?.oauth;
  log('Prod status', [
    `DNS: ${dns || 'unknown'} · OAuth complete: ${oauth?.complete ? 'yes' : 'no'}`,
    oauth?.pending?.length ? `Pending OAuth: ${oauth.pending.join(', ')}` : '',
    dns !== 'verified' && dns !== 'active'
      ? 'Re-run `clerk deploy status` until DNS/SSL verify (may take minutes).'
      : '',
    !oauth?.complete
      ? 'Add clerk-google-connection.json + clerk-apple-connection.json, re-run setup.'
      : 'Smoke test: https://parkbound.kurat0r.ai/sign-in',
  ].filter(Boolean));
}

async function main() {
  const { value: instanceName, flag: inst } = targetInstance(process.argv);
  const isProd = instanceName === 'prod';

  log('Park Bound Clerk setup', [
    'App: Park Bound (app_3Hur20guMzW3KoqHlQasftPybKL)',
    `Target: ${instanceName} instance`,
  ]);

  let status = null;
  if (isProd) status = ensureProductionReady();

  ensureClerkHealthy();

  log('Clerk DNS (Cloudflare)', ['Syncing CNAME records on kurat0r.ai…']);
  await syncClerkDns();

  applyConfigPatches(isProd, inst);

  log('Redirect URLs', ['Syncing allowed redirect origins…']);
  syncRedirectUrls(inst);

  if (isProd) status = deployStatus();

  printManualFollowUps(isProd, status);
  log('Done', [
    isProd
      ? 'Prod base config applied. Finish OAuth credential files if sign-in still fails.'
      : 'Dev instance configured.',
  ]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
