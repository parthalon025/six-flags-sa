#!/usr/bin/env node
/**
 * analyze retry/repair sequencing — scripts/lib/gitnexus-repair.mjs
 *
 * A dropped attempt or a repair that never fires costs the whole session its
 * code-graph index, so every branch is driven here through injected effects.
 *
 *   node test/scripts/gitnexus-repair.test.mjs
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  analyzeWithRepair,
  chooseInvocation,
  ladybugInstallerPath,
} from '../../scripts/lib/gitnexus-repair.mjs';

/** An analyze double that throws for the first `failures` calls. */
function spy(failures, label = 'boom') {
  const calls = [];
  return {
    calls,
    fn: (extraArgs) => {
      calls.push(extraArgs);
      if (calls.length <= failures) throw new Error(`${label} ${calls.length}`);
    },
  };
}

function harness(failures, { repairThrows = false } = {}) {
  const analyze = spy(failures);
  const repairs = [];
  const warnings = [];
  const result = () =>
    analyzeWithRepair({
      analyze: analyze.fn,
      repair: () => {
        repairs.push(true);
        if (repairThrows) throw new Error('registry unreachable');
      },
      warn: (m) => warnings.push(m),
    });
  return { analyze, repairs, warnings, result };
}

// --- ladybugInstallerPath -------------------------------------------------
assert.equal(
  ladybugInstallerPath('/opt/node22/lib/node_modules'),
  join('/opt/node22/lib/node_modules', 'gitnexus/node_modules/@ladybugdb/core/install.js'),
);
assert.equal(ladybugInstallerPath(''), null, 'no global root → no installer path');
assert.equal(ladybugInstallerPath(undefined), null);

// --- chooseInvocation -----------------------------------------------------
const analyzeArgs = ['analyze', '--force'];

assert.deepEqual(
  chooseInvocation({
    runCjs: '/repo/.gitnexus/run.cjs',
    nodePath: '/usr/bin/node',
    gitnexusOnPath: true,
    args: analyzeArgs,
  }),
  { command: '/usr/bin/node', args: ['/repo/.gitnexus/run.cjs', 'analyze', '--force'] },
  'the resolver wins even when a global gitnexus is also on PATH',
);

assert.deepEqual(
  chooseInvocation({
    runCjs: null,
    nodePath: '/usr/bin/node',
    gitnexusOnPath: true,
    args: analyzeArgs,
  }),
  { command: 'gitnexus', args: analyzeArgs },
  'no resolver yet → a global install beats npx',
);

assert.deepEqual(
  chooseInvocation({
    runCjs: null,
    nodePath: '/usr/bin/node',
    gitnexusOnPath: false,
    args: analyzeArgs,
  }),
  { command: 'npx', args: ['gitnexus', 'analyze', '--force'] },
  'npx is the last resort — it is the path that crashes on npm 11',
);

// --- the everyday path ----------------------------------------------------
let h = harness(0);
assert.equal(h.result(), 'plain');
assert.deepEqual(h.analyze.calls, [[]], 'a healthy analyze runs once, with no flags');
assert.deepEqual(h.repairs, [], 'never reinstall when analyze works');
assert.deepEqual(h.warnings, [], 'and never warn');

// --- one failure: --force, no reinstall -----------------------------------
h = harness(1);
assert.equal(h.result(), 'forced');
assert.deepEqual(h.analyze.calls, [[], ['--force']], 'second attempt adds --force');
assert.deepEqual(h.repairs, [], 'a stale index must not trigger a global reinstall');
assert.equal(h.warnings.length, 1);
assert.match(h.warnings[0], /retrying with --force/);
assert.match(h.warnings[0], /boom 1/, 'the first failure names its own reason');

// --- two failures: repair, then retry -------------------------------------
h = harness(2);
assert.equal(h.result(), 'repaired');
assert.deepEqual(
  h.analyze.calls,
  [[], ['--force'], ['--force']],
  'repair is followed by another --force attempt',
);
assert.deepEqual(h.repairs, [true], 'repair runs exactly once');
assert.equal(h.warnings.length, 2);
assert.match(h.warnings[1], /repairing the gitnexus install/);
assert.match(h.warnings[1], /boom 2/, 'the second failure names its own reason');

// --- still failing after repair: rethrow the real reason ------------------
h = harness(3);
assert.throws(h.result, /boom 3/, 'the caller degrades with the last failure, not a generic one');
assert.equal(h.analyze.calls.length, 3, 'three attempts, then stop — no infinite escalation');
assert.deepEqual(h.repairs, [true]);

// --- repair itself fails: propagate, do not retry blindly -----------------
h = harness(2, { repairThrows: true });
assert.throws(h.result, /registry unreachable/);
assert.equal(h.analyze.calls.length, 2, 'no fourth attempt once the repair could not run');

// --- warn is optional -----------------------------------------------------
const quiet = spy(1);
assert.equal(
  analyzeWithRepair({ analyze: quiet.fn, repair: () => {} }),
  'forced',
  'warn defaults to a no-op',
);

console.log('gitnexus-repair tests: ok');
