#!/usr/bin/env node
/** Expose the monorepo app tree at the repo root for Vercel's Next.js detector. */
import { existsSync, lstatSync, rmSync, symlinkSync } from 'node:fs';
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

for (const name of ['app', 'components', 'lib', 'server', 'data', 'public', 'jsconfig.json']) {
  link(name);
}
