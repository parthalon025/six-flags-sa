#!/usr/bin/env node
/**
 * CI module seams — gate manifest and party-tracker UI prep.
 *
 *   node test/scripts/ci-module.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_SCRIPT_TESTS, GATE_EXCLUDED_TESTS } from '../../scripts/ci/manifest.mjs';
import { runGateScriptTests } from '../../scripts/ci/gate-tests.mjs';
import {
  DEFAULT_HEALTH_URL,
  healthAlreadyServing,
  waitForHealth,
} from '../../scripts/ci/party-tracker-ui.mjs';
import { stageVersionStamps } from '../../scripts/ci/stage-version-stamps.mjs';
import {
  needsBrowserVertical,
} from '../../scripts/ci/pre-merge-vertical.mjs';
import { loadVersionStampPaths } from '../../scripts/lib/version-stamp.mjs';

assert.ok(GATE_SCRIPT_TESTS.length >= 4, 'gate manifest lists deploy/skip guards');
assert.ok(
  GATE_SCRIPT_TESTS.every((p) => p.startsWith('test/scripts/')),
  'gate tests live under test/scripts',
);

// Manifest completeness: every test/scripts test runs in the gate or is
// explicitly excluded with a reason — orphaned tests rot unseen.
{
  const testDir = join(dirname(fileURLToPath(import.meta.url)));
  const onDisk = readdirSync(testDir)
    .filter((f) => f.endsWith('.test.mjs'))
    .map((f) => `test/scripts/${f}`);
  for (const rel of onDisk) {
    assert.ok(
      GATE_SCRIPT_TESTS.includes(rel) || rel in GATE_EXCLUDED_TESTS,
      `${rel} is in neither GATE_SCRIPT_TESTS nor GATE_EXCLUDED_TESTS`,
    );
  }
  for (const rel of GATE_SCRIPT_TESTS) {
    assert.ok(onDisk.includes(rel), `${rel} listed in gate manifest but missing on disk`);
  }
  for (const rel of Object.keys(GATE_EXCLUDED_TESTS)) {
    assert.ok(!GATE_SCRIPT_TESTS.includes(rel), `${rel} both excluded and in the gate`);
  }
}

// A leftover server would let the browser vertical pass against the wrong
// build, so the gate has to notice one before it starts its own.
{
  assert.equal(
    await healthAlreadyServing({ fetchFn: async () => ({ ok: true }) }),
    true,
    'a responding health port is reported as already serving',
  );
  assert.equal(
    await healthAlreadyServing({
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
    }),
    false,
    'a refused connection means the port is free',
  );
  assert.equal(
    await healthAlreadyServing({ fetchFn: async () => ({ ok: false }) }),
    false,
    'a non-ok response is not a server we would collide with',
  );
}

let calls = 0;
const code = runGateScriptTests({
  tests: ['test/scripts/version-stamp.test.mjs'],
  cwd: join(dirname(fileURLToPath(import.meta.url)), '../..'),
  spawn: () => {
    calls += 1;
    return { status: 0 };
  },
});
assert.equal(code, 0);
assert.equal(calls, 1);

let slept = 0;
await waitForHealth({
  url: DEFAULT_HEALTH_URL,
  attempts: 2,
  delayMs: 1,
  fetchFn: async () => ({ ok: true }),
  sleep: async (ms) => {
    slept += ms;
  },
});
assert.ok(slept >= 0);

{
  const { startProductionServer } = await import('../../scripts/ci/party-tracker-ui.mjs');
  let spawnOpts = null;
  let unrefCalls = 0;
  startProductionServer({
    root: '/tmp/parkbound-ci',
    spawnFn: (_cmd, _args, opts) => {
      spawnOpts = opts;
      return {
        unref: () => {
          unrefCalls += 1;
        },
      };
    },
  });
  assert.equal(spawnOpts?.detached, true, 'production server must detach from the CI step');
  assert.equal(spawnOpts?.stdio, 'ignore');
  assert.equal(unrefCalls, 1, 'child must unref so waitForHealth can exit');
}

let staged = [];
stageVersionStamps({
  paths: loadVersionStampPaths(),
  git: (args) => {
    staged = args;
  },
});
assert.deepEqual(staged.slice(0, 2), ['add', 'package.json']);

assert.equal(needsBrowserVertical(['docs/agents/ci.md']), false);
assert.equal(needsBrowserVertical(['apps/party-tracker/app/page.js']), true);
assert.equal(needsBrowserVertical(null), true, 'unknown diff fails open to browser vertical');

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const workflow = readFileSync(join(root, '.github/workflows/test-app.yml'), 'utf8');
assert.match(workflow, /scripts\/ci\/gate-tests\.mjs/);
assert.match(workflow, /scripts\/ci\/party-tracker-ui\.mjs/);
const bump = readFileSync(join(root, '.github/workflows/bump-version.yml'), 'utf8');
assert.match(bump, /scripts\/ci\/stage-version-stamps\.mjs/);
const pkg = readFileSync(join(root, 'package.json'), 'utf8');
assert.match(pkg, /test:pre-merge-vertical/);
assert.match(workflow, /scripts\/ci\/local-ci-pass\.mjs/);

console.log('ci-module: ok');
