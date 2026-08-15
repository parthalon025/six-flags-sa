/**
 * Classify GitNexus index noise for Vercel ignore (not CI).
 * `.gitnexus/` is gitignored — agents refresh session-local only.
 */
import { normalizeRepoPath } from './repo-path.mjs';

/** Paths GitNexus analyze may dirty. Never commit `.gitnexus/`. */
export const GITNEXUS_INDEX_PATHS = ['.gitnexus/', 'AGENTS.md', 'CLAUDE.md'];

export function isGitnexusCiNoise(file) {
  const norm = normalizeRepoPath(file);
  if (norm === 'AGENTS.md' || norm === 'CLAUDE.md') return true;
  if (norm === '.gitnexus' || norm.startsWith('.gitnexus/')) return true;
  return false;
}

/** True only when every path is GitNexus index output. Empty → false (fail open). */
export function isGitnexusOnlyChange(files) {
  if (!files?.length) return false;
  return files.every(isGitnexusCiNoise);
}
