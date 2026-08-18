#!/usr/bin/env node
/**
 * Local CI pass stamp — write/check seam for pre-merge-vertical and test-app.yml.
 *
 *   node test/scripts/local-ci-pass.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LOCAL_CI_PASS_REL,
  buildLocalCiContext,
  readLocalCiPass,
  shouldSkipGithubUi,
  shouldSkipLocalPreMerge,
  stampCoversContext,
  writeLocalCiPass,
} from '../../scripts/lib/local-ci-pass.mjs';
import { runCheck } from '../../scripts/ci/local-ci-pass.mjs';

const tmp = mkdtempSync(join(tmpdir(), 'local-ci-pass-'));
try {
  const context = {
    schema: 2,
    head: 'abc123',
    mergeBase: 'def456',
    baseRef: 'origin/main',
    modules: ['lint', 'party'],
    needsBrowser: true,
    verticals: ['app'],
    staticSteps: ['test:ci-gate', 'test:unit', 'build'],
    lockHash: 'lockhash12345678',
    manifestHash: 'manifest12345678',
  };

  const stamp = writeLocalCiPass({ context, browserVertical: true, verticals: ['app'] }, tmp);
  assert.equal(readLocalCiPass(tmp)?.head, 'abc123');
  assert.equal(stamp.browserVertical, true);
  assert.ok(readFileSync(join(tmp, LOCAL_CI_PASS_REL), 'utf8').includes('"browserVertical": true'));

  assert.equal(stampCoversContext(stamp, context), true);
  assert.equal(
    stampCoversContext(stamp, { ...context, head: 'other' }),
    false,
    'head mismatch invalidates stamp',
  );
  assert.equal(
    shouldSkipLocalPreMerge(stamp, context),
    true,
    'full stamp skips local rerun',
  );
  assert.equal(
    shouldSkipLocalPreMerge(stamp, { ...context, needsBrowser: true }, { skipBrowser: true }),
    true,
    'stamp covers static when browser skipped explicitly',
  );
  assert.equal(
    shouldSkipLocalPreMerge(
      { ...stamp, browserVertical: false },
      context,
    ),
    false,
    'browser still required when stamp lacks browser vertical',
  );
  assert.equal(
    shouldSkipLocalPreMerge({ ...stamp, verticals: [] }, context),
    false,
    'a stamp missing a required vertical never covers the tree',
  );
  assert.equal(
    shouldSkipGithubUi(stamp, context, { anyUi: true }),
    true,
    'GitHub UI may skip when stamp covers browser vertical',
  );
  assert.equal(
    shouldSkipGithubUi(stamp, context, { anyUi: false }),
    false,
    'no UI modules means nothing to skip on GitHub',
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const realContext = buildLocalCiContext({ baseRef: 'origin/main' });
assert.ok(realContext.head, 'buildLocalCiContext resolves HEAD in repo');

let githubOut = '';
const prevOut = process.env.GITHUB_OUTPUT;
const outFile = join(tmpdir(), `local-ci-pass-out-${process.pid}`);
writeFileSync(outFile, '');
process.env.GITHUB_OUTPUT = outFile;
try {
  const result = runCheck({ baseRef: 'origin/main', anyUi: false });
  githubOut = readFileSync(outFile, 'utf8');
  assert.equal(result.skipUi, false);
  assert.match(githubOut, /skip_ui=false/);
} finally {
  process.env.GITHUB_OUTPUT = prevOut;
  rmSync(outFile, { force: true });
}

console.log('local-ci-pass: ok');
