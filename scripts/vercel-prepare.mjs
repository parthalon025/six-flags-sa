#!/usr/bin/env node
/**
 * Vercel builds from the repository root, but the Next.js app lives under
 * apps/party-tracker. Symlinks are not supported on Vercel, so copy the app
 * tree into place for framework detection and serverless packaging.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/party-tracker');

const copy = (name) => {
  const source = path.join(app, name);
  if (!existsSync(source)) return;
  const dest = path.join(root, name);
  rmSync(dest, { recursive: true, force: true });
  cpSync(source, dest, { recursive: true });
};

for (const name of ['app', 'components', 'lib', 'server', 'data', 'public', 'jsconfig.json']) {
  copy(name);
}
