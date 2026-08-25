/**
 * Playwright UI job prep — unpack production artifact and wait for health.
 *
 * Interface (testable):
 *   unpackBuildArtifact({ root, artifact, appDir })
 *   waitForHealth({ url, attempts, delayMs, fetchFn, sleep })
 *   healthAlreadyServing({ url, fetchFn })
 *
 * CLI:
 *   node scripts/ci/party-tracker-ui.mjs unpack
 *   node scripts/ci/party-tracker-ui.mjs start
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appOrigin, healthUrl, FALLBACK_APP_PORT } from '../lib/app-test-origin.mjs';

export const DEFAULT_APP_PORT = FALLBACK_APP_PORT;
export const DEFAULT_HEALTH_URL = healthUrl(appOrigin());
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

/**
 * Is something already answering on the health port?
 *
 * `startProductionServer` detaches and never stops the server, which is free
 * on a CI runner that is thrown away and a trap anywhere else: a second run in
 * the same session finds the first server still up, `waitForHealth` passes
 * immediately, and the browser vertical then tests whatever build that old
 * process is holding — not the one just built. A pass claimed on that is a
 * pass for the wrong code, so callers refuse rather than guess.
 */
export async function healthAlreadyServing({
  url = DEFAULT_HEALTH_URL,
  fetchFn = globalThis.fetch,
} = {}) {
  if (!fetchFn) throw new Error('party-tracker-ui: fetch is required');
  try {
    const res = await fetchFn(url);
    return res.ok === true;
  } catch {
    return false;
  }
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

export async function startProductionServer({
  root = join(dirname(fileURLToPath(import.meta.url)), '../..'),
  port = DEFAULT_APP_PORT,
  /** Release a port reservation immediately before spawn — same tick, minimal TOCTOU. */
  beforeBind,
  spawnFn = spawn,
} = {}) {
  if (beforeBind) await beforeBind();
  // Detach + unref so `start` can wait for health and exit while Next keeps
  // running for the Playwright step (bash `npm start &` used to do this).
  const env = { ...process.env, PORT: String(port) };
  const isWin = process.platform === 'win32';
  const child = isWin
    ? spawnFn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm run start -w @party-tracker/app'], {
        cwd: root,
        stdio: 'ignore',
        detached: true,
        windowsHide: true,
        env,
      })
    : spawnFn('npm', ['run', 'start', '-w', '@party-tracker/app'], {
        cwd: root,
        stdio: 'ignore',
        detached: true,
        env,
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
    await startProductionServer({ root });
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
