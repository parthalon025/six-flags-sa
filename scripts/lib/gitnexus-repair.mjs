/**
 * How gitnexus-sync retries `analyze`, and when it stops to repair the install.
 *
 * The sequencing is the part worth asserting — a dropped attempt or a repair
 * that never fires degrades the whole session to "no code-graph index" — so it
 * lives here with its effects injected rather than inline around `execFileSync`.
 */
import { join } from 'node:path';

const reason = (err) => err?.message || String(err);

/**
 * LadybugDB's own installer inside a global gitnexus. It copies a prebuilt
 * `lbugjs.node` out of the `@ladybugdb/core-<platform>` package npm already
 * fetched, so it needs no network — which is the whole point of running it
 * separately from the postinstall that does.
 */
export function ladybugInstallerPath(globalRoot) {
  if (!globalRoot) return null;
  return join(globalRoot, 'gitnexus', 'node_modules', '@ladybugdb', 'core', 'install.js');
}

/**
 * Which of the three ways to reach gitnexus this run should use.
 *
 * `.gitnexus/run.cjs` is itself an invocation resolver — it prefers a global
 * `gitnexus` and works around the npx arborist crash on npm 11 — so defer to it
 * whenever it exists. It is gitignored, though, and so absent until the first
 * successful analyze: that first run has to pick for itself, and a global
 * install beats `npx`, which is the path that crashes.
 */
export function chooseInvocation({ runCjs, nodePath, gitnexusOnPath, args }) {
  if (runCjs) return { command: nodePath, args: [runCjs, ...args] };
  if (gitnexusOnPath) return { command: 'gitnexus', args };
  return { command: 'npx', args: ['gitnexus', ...args] };
}

/**
 * Run `analyze`, escalating only as far as it has to:
 *   1. plain — the everyday path
 *   2. `--force` — a stale or half-written index
 *   3. repair the install, then `--force` again — the sandbox install failure
 *
 * `analyze(extraArgs)` and `repair()` throw to signal failure. Returns which
 * attempt succeeded; rethrows the last failure if none did, so the caller can
 * degrade with a real reason rather than a generic one.
 */
export function analyzeWithRepair({ analyze, repair, warn = () => {} }) {
  try {
    analyze([]);
    return 'plain';
  } catch (err) {
    warn(`analyze failed (${reason(err)}) — retrying with --force`);
  }

  try {
    analyze(['--force']);
    return 'forced';
  } catch (err) {
    warn(`analyze still failing (${reason(err)}) — repairing the gitnexus install`);
  }

  repair();
  analyze(['--force']);
  return 'repaired';
}
