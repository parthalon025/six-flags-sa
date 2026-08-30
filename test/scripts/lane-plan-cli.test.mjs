#!/usr/bin/env node
/**
 * lane-plan CLI — gitChangedFiles must receive cwd as the third argument.
 *
 *   node test/scripts/lane-plan-cli.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubGitEnv } from '../../scripts/lib/git-env.mjs';
import { lanePlanGithubOutputs } from '../../scripts/ci/lane-plan.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lanePlanCli = join(root, 'scripts/ci/lane-plan.mjs');

function git(dir, ...args) {
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...scrubGitEnv(),
      GIT_AUTHOR_NAME: 'T',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'T',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

{
  const dir = mkdtempSync(join(tmpdir(), 'lane-plan-cli-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'lane-plan@example.invalid');
  git(dir, 'config', 'user.name', 'Lane Plan');
  mkdirSync(join(dir, 'scripts/ci'), { recursive: true });
  writeFileSync(join(dir, 'scripts/ci/pre-merge-vertical.mjs'), '// backside\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'base');
  writeFileSync(join(dir, 'scripts/ci/pre-merge-vertical.mjs'), '// backside edit\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'backside change');

  const outs = lanePlanGithubOutputs('main', { cwd: dir });
  assert.equal(
    outs.canon_any_ui,
    'false',
    'lanePlanGithubOutputs must resolve git in cwd, not treat cwd as headRef',
  );

  rmSync(dir, { recursive: true, force: true });
}

const cliOut = execFileSync('node', [lanePlanCli, '--base', 'origin/main'], {
  cwd: root,
  encoding: 'utf8',
  env: scrubGitEnv(),
});
assert.match(
  cliOut,
  /^canon_any_ui=false$/m,
  'lane-plan CLI must emit canon_any_ui=false for a backside-only diff',
);

console.log('lane-plan-cli: ok');
