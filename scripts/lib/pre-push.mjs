/**
 * Pre-push hook decision logic — whether `git push` owes a local CI run.
 *
 * `.husky/pre-push` feeds git's own pre-push stdin (one line per ref update:
 * `<local ref> <local sha> <remote ref> <remote sha>`) through this module
 * instead of parsing it inline, so the decision is testable the same way
 * every other CI gate in this repo is (see docs/agents/matt-standards.md).
 *
 * Interface:
 *   ZERO_SHA
 *   parsePrePushRefs(stdin)
 *   prePushDecision(refs)
 */

export const ZERO_SHA = '0'.repeat(40);

export function parsePrePushRefs(stdin) {
  return stdin
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
      return { localRef, localSha, remoteRef, remoteSha };
    });
}

/**
 * `main` always runs full GitHub CI regardless of the `local-ci-verified`
 * stamp (see docs/agents/ci.md), so a push made up only of updates to
 * refs/heads/main gains nothing from a local run. A delete (all-zero local
 * sha) has no tree to validate either. Anything else owes the local run —
 * decided from what is actually being pushed (`remoteRef`), not the branch
 * checked out locally, so `git push origin HEAD:other-branch` is judged by
 * `other-branch`.
 */
export function prePushDecision(refs) {
  const updates = refs.filter((r) => r.localSha && r.localSha !== ZERO_SHA);
  if (!updates.length) {
    return { run: false, reason: 'delete-only push' };
  }
  if (updates.every((r) => r.remoteRef === 'refs/heads/main')) {
    return {
      run: false,
      reason: 'push to main — GitHub always runs full CI regardless of the stamp',
    };
  }
  return { run: true };
}
