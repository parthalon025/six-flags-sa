/**
 * Playwright UI job prep — unpack production artifact and wait for health.
 *
 * Interface (testable):
 *   unpackBuildArtifact({ root, artifact, appDir })
 *   waitForHealth({ url, attempts, delayMs, fetchFn, sleep })
 *
 * CLI:
 *   node scripts/ci/party-tracker-ui.mjs unpack
 *   node scripts/ci/party-tracker-ui.mjs start
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_HEALTH_URL = 'http://127.0.0.1:3000/api/health';
export const DEFAULT_ARTIFACT = 'party-tracker-next.tgz';
export const DEFAULT_APP_DIR = 'apps/party-tracker';

export function unpackBuildArtifact({
  root = join(dirname(fileURLToPath(import.meta.url)), '../..'),
  artifact = DEFAULT_ARTIFACT,
  appDir = DEFAULT_APP_DIR,
} = {}) {
  const archive = join(root, artifact);
  const target = join(root, appDir);
  if (!existsSync(archive)) {
    throw new Error(`party-tracker-ui: missing artifact ${archive}`);
  }
  execFileSync('tar', ['-C', target, '-xzf', archive], { stdio: 'inherit' });
  const buildId = join(target, '.next/BUILD_ID');
  if (!existsSync(buildId)) {
    throw new Error(`party-tracker-ui: missing ${buildId} after unpack`);
  }
  return buildId;
}

export async function waitForHealth({
  url = DEFAULT_HEALTH_URL,
  attempts = 90,
  delayMs = 2000,
  fetchFn = globalThis.fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!fetchFn) throw new Error('party-tracker-ui: fetch is required');
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetchFn(url);
      if (res.ok) return true;
    } catch {
      // retry until attempts exhausted
    }
    await sleep(delayMs);
  }
  throw new Error(`party-tracker-ui: health check timed out (${url})`);
}

export function startProductionServer({
  root = join(dirname(fileURLToPath(import.meta.url)), '../..'),
  spawnFn = spawn,
} = {}) {
  // Detach + unref so `start` can wait for health and exit while Next keeps
  // running for the Playwright step (bash `npm start &` used to do this).
  const child = spawnFn('npm', ['run', 'start', '-w', '@party-tracker/app'], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  });
  child.unref?.();
  return child;
}

async function runCli(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  if (cmd === 'unpack') {
    unpackBuildArtifact({ root });
    return;
  }
  if (cmd === 'start') {
    startProductionServer({ root });
    await waitForHealth();
    return;
  }
  console.error('usage: node scripts/ci/party-tracker-ui.mjs unpack|start');
  process.exit(1);
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  runCli().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
