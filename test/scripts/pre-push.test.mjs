#!/usr/bin/env node
/**
 * Pre-push hook decision logic.
 *
 *   node test/scripts/pre-push.test.mjs
 */
import assert from 'node:assert/strict';
import { ZERO_SHA, parsePrePushRefs, prePushDecision } from '../../scripts/lib/pre-push.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

// Parsing — the exact line shape git feeds a pre-push hook.
{
  const refs = parsePrePushRefs(
    `refs/heads/feature ${SHA_A} refs/heads/feature ${SHA_B}\n` +
      `refs/heads/other ${ZERO_SHA} refs/heads/other ${SHA_B}\n`,
  );
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[0], {
    localRef: 'refs/heads/feature',
    localSha: SHA_A,
    remoteRef: 'refs/heads/feature',
    remoteSha: SHA_B,
  });
  assert.deepEqual(parsePrePushRefs(''), []);
  assert.deepEqual(parsePrePushRefs('\n\n'), []);
}

// A normal push to a non-main branch owes the local run.
assert.deepEqual(
  prePushDecision([
    { localRef: 'refs/heads/feature', localSha: SHA_A, remoteRef: 'refs/heads/feature', remoteSha: SHA_B },
  ]),
  { run: true },
);

// Pushing to main is judged by the remote ref, not the branch checked out
// locally — `git push origin HEAD:main` from a feature branch still skips.
assert.equal(
  prePushDecision([
    { localRef: 'refs/heads/anything', localSha: SHA_A, remoteRef: 'refs/heads/main', remoteSha: SHA_B },
  ]).run,
  false,
);

// A delete (all-zero local sha) has no tree to validate.
assert.equal(
  prePushDecision([
    { localRef: '(delete)', localSha: ZERO_SHA, remoteRef: 'refs/heads/feature', remoteSha: SHA_B },
  ]).run,
  false,
);

// A push that updates main and a feature branch together still owes the run
// — the feature branch update is real work headed to GitHub.
assert.equal(
  prePushDecision([
    { localRef: 'refs/heads/main', localSha: SHA_A, remoteRef: 'refs/heads/main', remoteSha: SHA_B },
    { localRef: 'refs/heads/feature', localSha: SHA_A, remoteRef: 'refs/heads/feature', remoteSha: SHA_B },
  ]).run,
  true,
);

// No ref updates at all (defensive — git never actually invokes the hook
// this way, but the function should not crash on it).
assert.equal(prePushDecision([]).run, false);

console.log('pre-push.test: ok');
