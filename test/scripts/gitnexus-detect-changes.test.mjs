#!/usr/bin/env node
/**
 * GitNexus detect-changes CI wrapper.
 *
 *   node test/scripts/gitnexus-detect-changes.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  detectChangesArgs,
  formatSummary,
  runDetectChanges,
} from '../../scripts/lib/gitnexus-detect-changes.mjs';

assert.deepEqual(detectChangesArgs('origin/main'), [
  'detect-changes',
  '--scope',
  'compare',
  '--base-ref',
  'origin/main',
]);
assert.deepEqual(detectChangesArgs('HEAD^1'), [
  'detect-changes',
  '--scope',
  'compare',
  '--base-ref',
  'HEAD^1',
]);

// runDetectChanges prefers the project-local runner when it exists…
{
  let seenExec = null;
  const result = runDetectChanges({
    baseRef: 'origin/main',
    cwd: '/repo',
    runCjs: '/repo/.gitnexus/run.cjs',
    exists: () => true,
    exec: (cmd, args, opts) => {
      seenExec = { cmd, args, opts };
      return 'Changes: 2 files, 5 symbols\nRisk level: low\n';
    },
  });
  assert.equal(seenExec.cmd, process.execPath);
  assert.deepEqual(seenExec.args, [
    '/repo/.gitnexus/run.cjs',
    'detect-changes',
    '--scope',
    'compare',
    '--base-ref',
    'origin/main',
  ]);
  assert.equal(seenExec.opts.cwd, '/repo');
  assert.equal(result.ok, true);
  assert.equal(result.output, 'Changes: 2 files, 5 symbols\nRisk level: low');
}

// …and falls back to `npx gitnexus` when the runner is absent.
{
  let seenExec = null;
  const result = runDetectChanges({
    baseRef: 'main',
    cwd: '/repo',
    runCjs: '/repo/.gitnexus/run.cjs',
    exists: () => false,
    exec: (cmd, args) => {
      seenExec = { cmd, args };
      return 'No changes detected.';
    },
  });
  assert.equal(seenExec.cmd, 'npx');
  assert.deepEqual(seenExec.args, [
    'gitnexus',
    'detect-changes',
    '--scope',
    'compare',
    '--base-ref',
    'main',
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.output, 'No changes detected.');
}

// A thrown error (CLI/native deps unavailable) degrades to ok:false, never throws.
{
  const result = runDetectChanges({
    baseRef: 'origin/main',
    cwd: '/repo',
    runCjs: '/repo/.gitnexus/run.cjs',
    exists: () => true,
    exec: () => {
      throw new Error('spawn ENOENT');
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'spawn ENOENT');
}

// formatSummary renders both shapes as Markdown a job summary can render.
{
  const ok = formatSummary({
    ok: true,
    output: 'Changes: 1 files, 3 symbols\nRisk level: medium',
    baseRef: 'origin/main',
  });
  assert.match(ok, /## GitNexus blast radius/);
  assert.match(ok, /Compared against `origin\/main`/);
  assert.match(ok, /Risk level: medium/);

  const empty = formatSummary({ ok: true, output: '', baseRef: 'origin/main' });
  assert.match(empty, /\(no changes detected\)/);

  const unavailable = formatSummary({
    ok: false,
    reason: 'spawn ENOENT',
    baseRef: 'origin/main',
  });
  assert.match(unavailable, /best-effort/);
  assert.match(unavailable, /spawn ENOENT/);
}

// The CLI entry point mirrors gitnexus-sync.mjs's degrade-gracefully contract
// and never fails the calling job on its own.
{
  const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
  const wrapper = readFileSync(join(root, 'scripts/gitnexus-detect-changes.mjs'), 'utf8');
  assert.match(wrapper, /GITHUB_STEP_SUMMARY/);
  assert.match(wrapper, /best-effort/);
  assert.doesNotMatch(wrapper, /process\.exit\(1\)/, 'must not fail the job on its own');

  const workflow = readFileSync(join(root, '.github/workflows/test-app.yml'), 'utf8');
  assert.match(workflow, /scripts\/gitnexus-detect-changes\.mjs/);
  const gitnexusJob = workflow.slice(
    workflow.indexOf('\n  gitnexus:'),
    workflow.indexOf('\n  ci:'),
  );
  assert.match(gitnexusJob, /continue-on-error: true/, 'gitnexus job must stay soft');
  assert.match(gitnexusJob, /fetch-depth: 0/, 'needs full history to resolve the base ref');
  assert.match(gitnexusJob, /gitnexus-detect-changes\.mjs/);

  const softSet = workflow.match(/const soft = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '';
  assert.match(softSet, /"gitnexus"/, 'gitnexus job must stay in the ci aggregator soft set');

  const skill = readFileSync(
    join(root, '.claude/skills/gitnexus/gitnexus-cli/SKILL.md'),
    'utf8',
  );
  assert.match(skill, /detect-changes/, 'SKILL.md must document detect-changes as a CLI verb');
  assert.match(skill, /--scope/);
  assert.match(skill, /--base-ref/);
}

console.log('gitnexus-detect-changes tests: ok');
