/**
 * Post-merge version matrix — repo, Vercel production/preview, app stores.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { scrubGitEnv } from './git-env.mjs';
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
      // Scrubbed: an inherited GIT_DIR outranks `cwd`. See scripts/lib/git-env.mjs.
      { cwd: repoRoot, env: scrubGitEnv(), encoding: 'utf8' },
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
  if (cmp > 0) return 'STALE';
  return 'ahead of repo';
}

/**
 * Poll production until semver >= expectedVersion or timeout.
 */
export async function waitForProductionVersion(expectedVersion, options = {}) {
  const config = options.config ?? loadDeployVersionConfig();
  const intervalMs = options.intervalMs ?? config.poll?.intervalMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? config.poll?.timeoutMs ?? 600_000;
  const start = Date.now();
  let last = null;

  while (Date.now() - start < timeoutMs) {
    last = await fetchWebVersion(config.productionUrl, config.productionVersionPath);
    if (last.ok && last.version && compareVersions(last.version, expectedVersion) >= 0) {
      return {
        matched: true,
        elapsedMs: Date.now() - start,
        production: { ...last, lag: 'in sync' },
      };
    }
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }

  const lag = last?.ok && last.version ? lagNote(expectedVersion, last.version) : null;
  return {
    matched: false,
    elapsedMs: Date.now() - start,
    production: last ? { ...last, lag: lag ?? 'unreachable' } : { ok: false, lag: 'unreachable' },
  };
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

  const production = options.productionOverride
    ?? await fetchWebVersion(config.productionUrl, config.productionVersionPath);

  const productionWithLag = {
    ...production,
    lag: production.ok ? lagNote(repoVersion, production.version) : null,
    deployWait: options.deployWait ?? null,
  };

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
      const versions = await fetchIosStoreVersions(
        config.ios.appleId,
        asc,
        config.ios.bundleId,
      );
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
        ...productionWithLag,
        deployWait: options.deployWait ?? null,
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

export function formatDeployVersionOneline(report) {
  const { repo, web, stores } = report;
  const ios = formatIosRow(stores.ios);
  const prod = web.production;
  const prev = web.preview;

  const mainPart = repo.bump.skipped || !repo.bump.from || repo.bump.from === repo.bump.to
    ? `main ${repo.version}`
    : `main ${repo.version} (from ${repo.bump.from})`;

  const prodVersion = prod.ok ? prod.version : '—';
  const prodStatus = prod.lag === 'in sync'
    ? '✓ deployed'
    : prod.lag === 'STALE'
      ? 'STALE'
      : prod.ok
        ? prod.lag ?? 'live'
        : 'unreachable';

  const previewPart = prev.skipped
    ? '—'
    : prev.ok
      ? `${prev.version ?? '—'} @ ${prev.url ?? 'preview'}`
      : '—';

  const tagVersion = repo.lastStoreTag ? repo.lastStoreTag.replace(/^store\//, '') : 'none';

  const parts = [
    mainPart,
    `vercel:prod ${prodVersion} ${prodStatus}`,
    `preview ${previewPart}`,
    `appstore:live ${ios.liveVersion}`,
    `appstore:listing ${ios.listingVersion}${ios.listingNote !== 'no version in review' && ios.listingNote !== 'not queried' ? ` ${ios.listingNote}` : ''}`,
    `testflight ${ios.testflightVersion}`,
    `play ${stores.android.skipped ? '—' : '—'}`,
    `store:tag ${tagVersion}`,
  ];

  return parts.join(' | ');
}

export function formatDeployVersionBrief(report) {
  const oneline = formatDeployVersionOneline(report);
  const { repo, web } = report;
  const prod = web.production;
  const lines = [
    '## Version matrix',
    '',
    '```',
    oneline,
    '```',
    '',
  ];

  if (prod.deployWait) {
    const wait = prod.deployWait;
    if (wait.matched) {
      lines.push(`Production caught up in ${Math.round(wait.elapsedMs / 1000)}s.`);
    } else {
      lines.push(
        `_Deploy poll timed out after ${Math.round(wait.elapsedMs / 1000)}s — production still on \`${prod.ok ? prod.version : '—'}\` (repo \`${repo.version}\`). Check Vercel dashboard._`,
      );
    }
    lines.push('');
  }

  const bumpLine = repo.bump.skipped
    ? 'no semver bump this merge'
    : repo.bump.from && repo.bump.to && repo.bump.from !== repo.bump.to
      ? `bumped ${repo.bump.from} → ${repo.bump.to}`
      : repo.version;

  const ios = formatIosRow(report.stores.ios);
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

  lines.push(
    `**Repo \`main\`:** \`${repo.version}\` (${bumpLine})`,
    '',
    '| Surface | Version | Notes |',
    '|---------|---------|-------|',
    `| Vercel **production** | \`${prodVersion}\` | ${prodDetail} |`,
    `| Vercel **preview** | \`${previewVersion}\` | ${previewDetail} |`,
    `| App Store **live** | \`${ios.liveVersion}\` | ${ios.liveNote} |`,
    `| App Store **listing** | \`${ios.listingVersion}\` | ${ios.listingNote} |`,
    `| **TestFlight** | \`${ios.testflightVersion}\` | ${ios.testflightNote} |`,
    `| Play Store **production** | \`—\` | ${report.stores.android.reason} |`,
    `| Last **store tag** | \`${tagVersion}\` | native shell |`,
  );

  if (prod.ok && prod.built) {
    lines.push(
      '',
      `Production build: \`${prod.built}\`${prod.sha ? ` · \`${prod.sha.slice(0, 7)}\`` : ''}`,
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
    const err = String(ios.error || 'error').split('\n')[0].slice(0, 80);
    return {
      liveVersion: '—',
      liveNote: err,
      listingVersion: '—',
      listingNote: err,
      testflightVersion: '—',
      testflightNote: err,
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
