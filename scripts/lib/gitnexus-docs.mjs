/**
 * Which generated docs `gitnexus analyze` dirtied, and which of those this run
 * may revert.
 *
 * analyze rewrites its own hunks in place. Reverting the whole set blindly also
 * throws away edits the user made before the run, so the decision is a
 * before/after comparison — kept here, pure, so it can be asserted without a
 * real index.
 */

/**
 * Paths analyze rewrites. `.claude/skills/gitnexus` is a directory: gitnexus
 * refreshes its own skill docs there and drops any section this repo added by
 * hand.
 */
export const GENERATED_DOC_PATHS = ['AGENTS.md', 'CLAUDE.md', '.claude/skills/gitnexus'];

/**
 * Parse `git status --porcelain` into path → two-char status code.
 * Renames read `R  old -> new`; the destination is the live path.
 */
export function parseDirtyDocs(porcelain) {
  const dirty = new Map();
  for (const line of (porcelain ?? '').split('\n')) {
    if (line.length < 4) continue;
    const path = line.slice(3).split(' -> ').pop().trim();
    if (path) dirty.set(path, line.slice(0, 2));
  }
  return dirty;
}

/**
 * Paths to hand to `git checkout --`: dirtied by this analyze run and nothing
 * else. A path already dirty in `before` is the user's own edit and survives.
 * Untracked (`??`) paths are skipped — checkout cannot restore what git does
 * not track, so a new file analyze dropped in is left for the user to keep.
 */
export function docsToRestore(before, after) {
  if (!after) return [];
  return [...after]
    .filter(([path, code]) => code !== '??' && !before?.has(path))
    .map(([path]) => path);
}
