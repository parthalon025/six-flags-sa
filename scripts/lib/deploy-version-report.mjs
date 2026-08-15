/**
 * Post-merge version matrix — repo, Vercel production/preview, app stores.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../../apps/party-tracker/lib/version.js';
import { fetchIosStoreVersions, loadAscCredentialsFromEnv } from './app-store-connect.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadDeployVersionConfig(configPath) {
  const path = configPath ?? join(__dirname, 'deploy-version-report.json');
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function readRepoVersion(repoRoot) {
  const pkg = JSON.parse(
    readFileSync(join(repoRoot, 'apps/party-tracker/package.json'), 'utf8'),
  );
  return pkg.version;
}

export function latestStoreTag(repoRoot, prefix = 'store/') {
  try {
    const out = execFileSync(
      'git',
      ['tag', '-l', `${prefix}*`, '--sort=-v:refname'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    return out.split('\n').map((line) => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export async function fetchWebVersion(baseUrl, path = '/api/version', timeoutMs = 12_000) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, url };
    }
    const body = await response.json();
    return {
      ok: true,
      url,
      version: body.version ?? null,
      built: body.built ?? null,
      sha: body.sha ?? null,
      protocol: body.protocol ?? null,
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err), url };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchVercelDeployment({ token, projectId, teamId, target }) {
  if (!token || !projectId) {
    return { ok: false, skipped: true, reason: 'VERCEL_TOKEN or VERCEL_PROJECT_ID not set' };
  }
  const params = new URLSearchParams({
    projectId,
    target,
    limit: '1',
  });
  if (teamId) params.set('teamId', teamId);
  const response = await fetch(`https://api.vercel.com/v6/deployments?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    return { ok: false, error: `Vercel API ${response.status}` };
  }
  const body = await response.json();
  const deployment = body.deployments?.[0];
  if (!deployment) {
    return { ok: false, error: 'no deployments' };
  }
  const web = await fetchWebVersion(`https://${deployment.url}`);
  return {
    ok: true,
    target,
    url: deployment.url ? `https://${deployment.url}` : null,
    state: deployment.state ?? null,
    createdAt: deployment.createdAt ?? null,
    version: web.ok ? web.version : null,
    built: web.ok ? web.built : null,
    sha: web.ok ? web.sha : null,
    error: web.ok ? null : web.error,
  };
}

function lagNote(repoVersion, remoteVersion) {
  if (!repoVersion || !remoteVersion) return null;
  const cmp = compareVersions(repoVersion, remoteVersion);
  if (cmp === 0) return 'in sync';
  if (cmp > 0) return 'deploy pending (repo ahead)';
  return 'ahead of repo (unexpected)';
}

/**
 * @param {object} options
 */
export async function buildDeployVersionReport(options = {}) {
  const repoRoot = options.repoRoot ?? join(__dirname, '..', '..');
  const config = options.config ?? loadDeployVersionConfig();
  const bump = {
    from: options.bumpFrom ?? null,
    to: options.bumpTo ?? null,
    skipped: options.bumpSkipped ?? false,
  };
  const repoVersion = options.repoVersion ?? readRepoVersion(repoRoot);
  const lastStoreTag = latestStoreTag(repoRoot, config.storeTagPrefix);

  const production = await fetchWebVersion(
    config.productionUrl,
    config.productionVersionPath,
  );

  let preview = { ok: false, skipped: true, reason: 'Previews deploy only on user directive ([vercel build] / VERCEL_USER_BUILD)' };
  if (process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID) {
    preview = await fetchVercelDeployment({
      token: process.env.VERCEL_TOKEN,
      projectId: process.env.VERCEL_PROJECT_ID,
      teamId: process.env.VERCEL_TEAM_ID,
      target: 'preview',
    });
  }

  let ios = { ok: false, skipped: true, reason: 'App Store Connect API key not configured' };
  const asc = loadAscCredentialsFromEnv();
  if (asc) {
    try {
      const versions = await fetchIosStoreVersions(config.ios.appleId, asc);
      ios = { ok: true, ...versions };
    } catch (err) {
      ios = { ok: false, error: err.message || String(err) };
    }
  }

  const android = {
    ok: false,
    skipped: true,
    reason: 'Play version query not wired in CI yet — check Play Console',
  };

  return {
    repo: {
      version: repoVersion,
      branch: options.branch ?? 'main',
      bump,
      lastStoreTag,
    },
    web: {
      production: {
        ...production,
        lag: production.ok ? lagNote(repoVersion, production.version) : null,
      },
      preview,
    },
    stores: { ios, android },
    merge: {
      sha: options.mergeSha ?? null,
      message: options.mergeMessage ?? null,
    },
  };
}

function configProductionUrl(prod) {
  try {
    const u = new URL(prod.url);
    return u.host;
  } catch {
    return 'production';
  }
}

export function formatDeployVersionBrief(report) {
  const { repo, web, stores } = report;
  const bumpLine = repo.bump.skipped
    ? 'no semver bump this merge'
    : repo.bump.from && repo.bump.to && repo.bump.from !== repo.bump.to
      ? `bumped ${repo.bump.from} → ${repo.bump.to}`
      : repo.version;

  const ios = formatIosRow(stores.ios);
  const prod = web.production;
  const prev = web.preview;

  const prodVersion = prod.ok ? prod.version : '—';
  const prodDetail = prod.ok
    ? `${configProductionUrl(prod)} · ${prod.lag ?? 'live'}`
    : prod.error || 'unreachable';

  const previewVersion = prev.skipped ? '—' : prev.ok ? prev.version || '—' : '—';
  const previewDetail = prev.skipped
    ? prev.reason
    : prev.ok
      ? `${prev.url ?? 'preview'} · ${prev.state ?? 'deployed'}`
      : prev.error || 'none';

  const tagVersion = repo.lastStoreTag ? repo.lastStoreTag.replace(/^store\//, '') : 'none';

  const lines = [
    '## Version matrix',
    '',
    `**Repo \`main\`:** \`${repo.version}\` (${bumpLine})`,
    '',
    '| Surface | Version | Notes |',
    '|---------|---------|-------|',
    `| Vercel **production** | \`${prodVersion}\` | ${prodDetail} |`,
    `| Vercel **preview** | \`${previewVersion}\` | ${previewDetail} |`,
    `| App Store **live** | \`${ios.liveVersion}\` | ${ios.liveNote} |`,
    `| App Store **listing** | \`${ios.listingVersion}\` | ${ios.listingNote} |`,
    `| **TestFlight** | \`${ios.testflightVersion}\` | ${ios.testflightNote} |`,
    `| Play Store **production** | \`—\` | ${stores.android.reason} |`,
    `| Last **store tag** (native shell) | \`${tagVersion}\` | Capacitor binary last tagged |`,
    '',
  ];

  if (prod.ok && prod.built) {
    lines.push(
      `Production build stamp: \`${prod.built}\`${prod.sha ? ` · git \`${prod.sha.slice(0, 7)}\`` : ''}`,
    );
  }
  if (prod.ok && prod.lag === 'deploy pending (repo ahead)') {
    lines.push(
      '',
      '_Production may still be on the prior build until Vercel finishes deploying `main` (app-path merges only)._',
    );
  }

  return lines.join('\n');
}

function formatIosRow(ios) {
  if (ios.skipped) {
    return {
      liveVersion: '—',
      liveNote: 'not queried',
      listingVersion: '—',
      listingNote: ios.reason,
      testflightVersion: '—',
      testflightNote: 'not queried',
    };
  }
  if (!ios.ok) {
    return {
      liveVersion: '—',
      liveNote: ios.error,
      listingVersion: '—',
      listingNote: ios.error,
      testflightVersion: '—',
      testflightNote: ios.error,
    };
  }
  return {
    liveVersion: ios.live?.version ?? '—',
    liveNote: ios.live?.state ?? 'not live yet',
    listingVersion: ios.listing?.version ?? '—',
    listingNote: ios.listing?.state ?? 'no version in review',
    testflightVersion: ios.testflight?.version ?? '—',
    testflightNote: ios.testflight?.processingState ?? 'no builds',
  };
}

export function formatDeployVersionPlain(report) {
  return formatDeployVersionBrief(report)
    .replace(/^## /gm, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\|/gm, '')
    .replace(/\|/g, ' · ')
    .trim();
}
