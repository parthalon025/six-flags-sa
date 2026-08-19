#!/usr/bin/env node
/**
 * Pre-push hook decision logic.
 *
 *   node test/scripts/pre-push.test.mjs
 */
import assert from 'node:assert/strict';
import { ZERO_SHA, parsePrePushRefs, prePushDecision } from '../../scripts/lib/pre-push.mjs';
import { main } from '../../scripts/ci/pre-push.mjs';
import { GIT_ENV_VARS } from '../../scripts/lib/git-env.mjs';

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

// The hook must hand the CI run an environment with git's inherited repository
// stripped. Asserted on main() itself, not just on scrubGitEnv: the helper being
// correct is no use if the wiring stops calling it. See scripts/lib/git-env.mjs.
{
  const leaked = Object.fromEntries(GIT_ENV_VARS.map((k) => [k, `/leaked/${k}`]));
  let captured = null;
  const status = main({
    stdin: `refs/heads/feature ${SHA_A} refs/heads/feature ${SHA_B}\n`,
    env: { ...leaked, PATH: '/bin' },
    spawn: (_cmd, _args, opts) => {
      captured = opts;
      return { status: 0 };
    },
  });
  assert.equal(status, 0);
  assert.ok(captured, 'main() did not spawn the CI run');
  for (const key of GIT_ENV_VARS) {
    assert.equal(captured.env[key], undefined, `main() passed ${key} through to the CI run`);
  }
  assert.equal(captured.env.PATH, '/bin', 'main() dropped more than git\'s own variables');
}

console.log('pre-push.test: ok');
