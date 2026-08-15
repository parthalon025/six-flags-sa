/**
 * Normalize a repo-relative path from git diff or filesystem input.
 */
export function normalizeRepoPath(file) {
  return String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}
