/**
 * detect-changes CI wrapper — blast-radius report for a diff vs a base ref.
 *
 * GitNexus's `detect-changes` CLI verb (alias `detect_changes`) already maps
 * a git diff to indexed symbols and affected execution flows; this module
 * shells out to it and shapes the result for a CI job summary. It degrades
 * gracefully like `scripts/gitnexus-sync.mjs`: an unavailable index or a
 * failed native-dep install produces a report that says so, not a thrown
 * error — the caller decides whether that fails the build (it should not).
 *
 * Interface:
 *   detectChangesArgs(baseRef)
 *   runDetectChanges({ baseRef, cwd, runCjs, exists, exec })
 *   formatSummary({ ok, output, reason, baseRef })
 */

export function detectChangesArgs(baseRef) {
  return ['detect-changes', '--scope', 'compare', '--base-ref', baseRef];
}

/**
 * Runs `detect-changes` against a built index. Prefers the project-local
 * runner (`.gitnexus/run.cjs`, dropped next to the index by `analyze`) and
 * falls back to `npx gitnexus` only when that runner is missing but the
 * caller still wants to try — mirrors `scripts/gitnexus-sync.mjs`'s
 * runner-selection order.
 *
 * All I/O is injectable so this can be exercised without a real index.
 */
export function runDetectChanges({
  baseRef = 'origin/main',
  cwd,
  runCjs,
  exists,
  exec,
} = {}) {
  const args = detectChangesArgs(baseRef);
  const invoke = () =>
    exists(runCjs)
      ? exec(process.execPath, [runCjs, ...args], { cwd, encoding: 'utf8' })
      : exec('npx', ['gitnexus', ...args], { cwd, encoding: 'utf8' });

  try {
    const raw = invoke();
    return { ok: true, output: (raw ?? '').toString().trim() };
  } catch (err) {
    return { ok: false, reason: err?.message || String(err) };
  }
}

/** Renders a `runDetectChanges` result as Markdown for $GITHUB_STEP_SUMMARY. */
export function formatSummary({ ok, output, reason, baseRef }) {
  const lines = ['## GitNexus blast radius', ''];
  if (ok) {
    lines.push(
      `Compared against \`${baseRef}\`:`,
      '',
      '```',
      output || '(no changes detected)',
      '```',
    );
  } else {
    lines.push(
      'GitNexus `detect-changes` was unavailable this run (best-effort — see '
        + '[gitnexus-sync policy](../docs/agents/policies/gitnexus-sync.md)):',
      '',
      '```',
      reason || 'unknown error',
      '```',
    );
  }
  return `${lines.join('\n')}\n`;
}
