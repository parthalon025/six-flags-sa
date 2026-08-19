#!/usr/bin/env node
/**
 * Pre-push hook entry point — reads git's pre-push stdin, decides whether
 * local CI is owed (scripts/lib/pre-push.mjs), and runs it.
 *
 *   node scripts/ci/pre-push.mjs   (invoked by .husky/pre-push)
 *
 * PRE_PUSH_SKIP_BROWSER=1 passes --skip-browser through to
 * test:pre-merge-vertical for a faster local check; the script itself still
 * refuses to skip the browser vertical for a diff that touches app behaviour.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasInheritedGitRepo, scrubGitEnv } from '../lib/git-env.mjs';
import { parsePrePushRefs, prePushDecision } from '../lib/pre-push.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export function main({ stdin, cwd = root, env = process.env, spawn = spawnSync } = {}) {
  const refs = parsePrePushRefs(stdin);
  const decision = prePushDecision(refs);
  if (!decision.run) {
    console.log(`pre-push: skipping local CI — ${decision.reason}`);
    return 0;
  }

  console.log(
    'pre-push: running local CI (npm run test:pre-merge-vertical) so GitHub can skip redundant jobs',
  );
  const args = ['run', 'test:pre-merge-vertical'];
  if (env.PRE_PUSH_SKIP_BROWSER === '1') args.push('--', '--skip-browser');
  // Git resolved *this* repository into the environment before running the hook,
  // and every process below inherits it. The suite builds scratch repos in
  // tmpdirs; without this scrub their commits land on the branch being pushed.
  // See scripts/lib/git-env.mjs.
  if (hasInheritedGitRepo(env)) {
    // Said out loud because the failure it prevents is silent: the suite would
    // commit its fixtures onto the branch being pushed and nothing would say so.
    console.log('pre-push: scrubbing git\'s inherited repository from the CI environment');
  }
  const result = spawn('npm', args, { cwd, stdio: 'inherit', env: scrubGitEnv(env) });
  return result.status ?? 1;
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  process.exit(main({ stdin: readFileSync(0, 'utf8') }));
}
