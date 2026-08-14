#!/usr/bin/env node
/**
 * Hit production venue assets once after deploy so the CDN holds them before
 * the first guest on park wifi pays the cold MISS. Safe to re-run.
 *
 * Usage:
 *   node scripts/warm-cdn.mjs
 *   node scripts/warm-cdn.mjs https://app.parkbound.app
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const venuesDir = join(root, 'apps/party-tracker/public/venues');
const base = (process.argv[2] || 'https://six-flags-sa.vercel.app').replace(/\/+$/, '');

const paths = ['/venues/manifest.json', '/sw.js', '/app-version.json', '/manifest.webmanifest'];

try {
  for (const name of readdirSync(venuesDir)) {
    if (/\.(map|pois|gaps)\.json$/.test(name) || name === 'manifest.json') {
      paths.push(`/venues/${name}`);
    }
  }
} catch {
  // Venues may be absent in a sparse checkout; still warm the listed defaults.
}

const unique = [...new Set(paths)];
let ok = 0;
let fail = 0;

for (const path of unique) {
  const url = `${base}${path}`;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow' });
    const cache = res.headers.get('x-vercel-cache') || '-';
    console.log(`${res.status} ${cache.padEnd(10)} ${path}`);
    if (res.ok) ok += 1;
    else fail += 1;
  } catch (err) {
    console.error(`ERR ${path}: ${err.message}`);
    fail += 1;
  }
}

console.log(`\nWarmed ${ok}/${unique.length} from ${base}${fail ? ` (${fail} failed)` : ''}`);
process.exit(fail ? 1 : 0);
