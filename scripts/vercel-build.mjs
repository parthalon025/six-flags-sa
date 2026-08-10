#!/usr/bin/env node
/**
 * Vercel builds from the repo root, but the Next.js app lives in
 * apps/party-tracker. Workspace install stays at the root; this script
 * builds the app package, then exposes its source tree and .next output
 * where Vercel's Next.js builder expects them.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/party-tracker');

const link = (name) => {
  const target = path.join(app, name);
  if (!existsSync(target)) return;
  const dest = path.join(root, name);
  rmSync(dest, { recursive: true, force: true });
  symlinkSync(target, dest, lstatSync(target).isDirectory() ? 'dir' : 'file');
};

process.chdir(root);
execSync('npm run build -w @party-tracker/app', { stdio: 'inherit' });

for (const name of ['app', 'components', 'lib', 'server', 'data', 'public', 'jsconfig.json']) {
  link(name);
}

const srcNext = path.join(app, '.next');
const destNext = path.join(root, '.next');
rmSync(destNext, { recursive: true, force: true });
cpSync(srcNext, destNext, { recursive: true });
