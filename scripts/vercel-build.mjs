#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'apps/party-tracker');

process.chdir(root);
execSync('node scripts/vercel-link.mjs', { stdio: 'inherit' });
execSync('npm run build -w @party-tracker/app', { stdio: 'inherit' });

const srcNext = path.join(app, '.next');
const destNext = path.join(root, '.next');
rmSync(destNext, { recursive: true, force: true });
cpSync(srcNext, destNext, { recursive: true });
