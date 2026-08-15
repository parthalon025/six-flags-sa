/**
 * Files the post-merge bump workflow touches — stamp only, no app logic.
 * Shared by bump-version.mjs (writer) and vercel-ignore.mjs (deploy decision).
 *
 * On production, stamp-only bumps still deploy: the bump commit arrives seconds
 * after the merge and Vercel cancels the in-flight merge build before it lands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeRepoPath } from './repo-path.mjs';

const jsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'version-stamp-paths.json');

export function loadVersionStampPaths(from = jsonPath) {
  const raw = JSON.parse(fs.readFileSync(from, 'utf8'));
  if (!Array.isArray(raw) || raw.some((p) => typeof p !== 'string')) {
    throw new Error(`version-stamp-paths.json must be an array of strings: ${from}`);
  }
  return raw;
}

export function isVersionStampOnlyChange(files, stampPaths = loadVersionStampPaths()) {
  if (!files?.length) return false;
  const allowed = new Set(stampPaths.map(normalizeRepoPath));
  return files.every((f) => allowed.has(normalizeRepoPath(f)));
}
