#!/usr/bin/env node
/**
 * One command to get this running on a phone.
 *
 *   npm run phone
 *
 * Builds if needed, starts the server, opens an HTTPS tunnel and prints a QR
 * code. Scan it and the app is on the phone, with GPS working.
 *
 * The tunnel is the point. A phone will not hand over location to anything but
 * https, so a bare LAN address gets you a map with nobody on it — the single
 * most common way this app appears broken. If no tunnel can be started we still
 * print the LAN address, but we say plainly what will not work.
 *
 * Options:
 *   --port <n>     port for the app (default 3000)
 *   --lan          skip the tunnel, just serve on the LAN
 *   --dev          run `next dev` instead of a production build
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import process from 'node:process';
import QRCode from 'qrcode';

const BOLD = '[1m';
const DIM = '[2m';
const GREEN = '[32m';
const YELLOW = '[33m';
const OFF = '[0m';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const PORT = Number(value('--port', process.env.PORT || 3000));
const LAN_ONLY = flag('--lan');
const DEV = flag('--dev');

const children = [];
let shuttingDown = false;

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const lanAddress = () => {
  const nets = Object.values(os.networkInterfaces()).flat();
  const hit = nets.find((n) => n && n.family === 'IPv4' && !n.internal);
  return hit ? hit.address : null;
};

/**
 * Is the port actually ours to take?
 *
 * Checked before spawning anything, because probing over HTTP afterwards cannot
 * tell our server apart from whatever else is already listening — the squatter
 * answers the probe long before our child gets far enough to fail, and we would
 * cheerfully tunnel a stranger's app to the phone.
 */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

/**
 * Resolve once the port answers, so we never tunnel to a server that isn't up.
 * `isDead` short-circuits the wait when the child has already given up.
 */
async function waitForServer(port, isDead, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isDead()) return false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status < 500) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/**
 * Start a tunnel and resolve its https URL.
 *
 * cloudflared first: its quick tunnels need no account and, unlike localtunnel,
 * show the visitor no interstitial. localtunnel is the fallback because it
 * needs nothing installed, at the cost of a one-time password prompt on the
 * phone (the answer is the laptop's public IP, which it shows you).
 */
function startTunnel(port) {
  return new Promise((resolve) => {
    const candidates = [
      { cmd: 'cloudflared', args: ['tunnel', '--url', `http://localhost:${port}`], label: 'cloudflared' },
      { cmd: 'npx', args: ['--yes', 'localtunnel', '--port', String(port)], label: 'localtunnel' },
    ];

    const attempt = (i) => {
      if (i >= candidates.length) return resolve(null);
      const { cmd, args, label } = candidates[i];
      process.stdout.write(`${DIM}  trying ${label}…${OFF}\n`);

      let child;
      try {
        child = run(cmd, args);
      } catch {
        return attempt(i + 1);
      }

      let settled = false;
      const done = (url) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (url) resolve({ url, label });
        else {
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
          attempt(i + 1);
        }
      };

      const scan = (buf) => {
        const m = String(buf).match(/https:\/\/[^\s|"']+\.(?:trycloudflare\.com|loca\.lt)/);
        if (m) done(m[0]);
      };
      child.stdout.on('data', scan);
      child.stderr.on('data', scan); // cloudflared writes its URL to stderr
      child.on('error', () => done(null));
      child.on('exit', () => done(null));

      const timer = setTimeout(() => done(null), 25000);
    };

    attempt(0);
  });
}

async function main() {
  // A production build is what a phone should be testing against, and it is
  // also far lighter on a laptop that has to stay awake all day.
  if (!DEV && !existsSync('.next')) {
    process.stdout.write(`${BOLD}Building…${OFF}\n`);
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    const code = await new Promise((r) => build.on('exit', r));
    if (code !== 0) {
      process.stderr.write('build failed\n');
      return shutdown(1);
    }
  }

  if (!(await portFree(PORT))) {
    process.stderr.write(
      `\n${YELLOW}Port ${PORT} is already in use.${OFF}\n` +
        `Something else is serving there — stop it, or pick another port:\n\n` +
        `  npm run phone -- --port ${PORT + 1}\n\n`,
    );
    return shutdown(1);
  }

  process.stdout.write(`${BOLD}Starting the app…${OFF}\n`);
  const server = DEV
    ? run('npx', ['next', 'dev', '-p', String(PORT)])
    : run('npx', ['next', 'start', '-p', String(PORT)]);

  // Keep the tail of the server's own output. When it dies during startup the
  // reason is in there — almost always the port already being in use — and a
  // bare exit code sends people hunting for a problem the server already named.
  let serverLog = '';
  const keep = (buf) => {
    serverLog = (serverLog + buf).slice(-2000);
  };
  server.stdout.on('data', keep);
  server.stderr.on('data', keep);

  let serverDead = false;
  server.on('exit', (code) => {
    serverDead = true;
    if (shuttingDown) return;
    if (/EADDRINUSE/.test(serverLog)) {
      process.stderr.write(
        `\n${YELLOW}Port ${PORT} is already in use.${OFF}\n` +
          `Something else is serving there — stop it, or pick another port:\n\n` +
          `  npm run phone -- --port ${PORT + 1}\n\n`,
      );
    } else {
      process.stderr.write(`\nThe app exited (${code}) before it finished starting.\n`);
      if (serverLog.trim()) process.stderr.write(`\n${serverLog.trimEnd()}\n`);
    }
    shutdown(code || 1);
  });

  if (!(await waitForServer(PORT, () => serverDead))) {
    // A dead child has already printed the real reason via its exit handler.
    if (!serverDead) process.stderr.write('the app never came up\n');
    return shutdown(1);
  }

  let target = null;
  let via = null;
  if (!LAN_ONLY) {
    process.stdout.write(`${BOLD}Opening an HTTPS tunnel…${OFF}\n`);
    const tunnel = await startTunnel(PORT);
    if (tunnel) {
      target = tunnel.url;
      via = tunnel.label;
    }
  }

  const lan = lanAddress();
  if (!target) target = lan ? `http://${lan}:${PORT}` : `http://localhost:${PORT}`;

  const qr = await QRCode.toString(target, { type: 'terminal', small: true });

  process.stdout.write('\n');
  process.stdout.write(qr);
  process.stdout.write('\n');
  process.stdout.write(`  ${BOLD}Scan that with the phone's camera.${OFF}\n\n`);
  process.stdout.write(`  ${GREEN}${target}${OFF}${via ? `   ${DIM}via ${via}${OFF}` : ''}\n\n`);

  if (target.startsWith('https://')) {
    process.stdout.write(`${DIM}  Then: allow location, open the Day tab, and add it to the home screen.${OFF}\n`);
    if (via === 'localtunnel') {
      process.stdout.write(
        `${DIM}  localtunnel asks for a password the first time — it is this machine's\n  public IP, which the page itself shows you.${OFF}\n`,
      );
    }
  } else {
    process.stdout.write(
      `${YELLOW}  This is a plain http address, so phones will refuse to share location.\n` +
        `  The map still draws and ride heights still work, but nobody will have a\n` +
        `  position. Install cloudflared, or see INSTALL.md for a hosted link.${OFF}\n`,
    );
  }
  process.stdout.write(`\n${DIM}  Ctrl-C to stop.${OFF}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err?.stack || err}\n`);
  shutdown(1);
});
