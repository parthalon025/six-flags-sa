/**
 * Shared app-path list for Vercel ignore and version bump skip.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const jsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app-paths.json');

export function loadAppPaths(from = jsonPath) {
  const raw = JSON.parse(fs.readFileSync(from, 'utf8'));
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) {
    throw new Error(`app-paths.json must be an array of strings: ${from}`);
  }
  return raw;
}

export function isAppPath(file, paths) {
  const norm = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (!norm) return false;
  return paths.some((p) => norm === p || (p.endsWith('/') ? norm.startsWith(p) : norm.startsWith(`${p}/`)));
}

export function isAppChange(files, paths = loadAppPaths()) {
  return (files || []).some((f) => isAppPath(f, paths));
}
