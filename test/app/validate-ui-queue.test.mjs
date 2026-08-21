#!/usr/bin/env node
/**
 * validate-ui suite plan — the split that lets the local gate run in parallel.
 *
 *   node test/app/validate-ui-queue.test.mjs
 */
import assert from 'node:assert/strict';
import { buildQueue } from './lib/validate-ui-queue.mjs';

const FUNCTIONAL = ['smoke', 'heights', 'party'];

// Serial keeps one functional process — the shape the suite has always run in.
{
  const q = buildQueue({ functional: FUNCTIONAL, grandma: true });
  const functional = q.filter((s) => s.id.startsWith('functional:'));
  assert.equal(functional.length, 1, 'serial runs the functional modules as one process');
  assert.deepEqual(functional[0].args, ['--modules=smoke,heights,party']);
  assert.equal(q.length, 2, 'grandma + one functional process');
}

// Parallel splits per module, which is exactly how CI runs them as separate jobs.
{
  const q = buildQueue({ functional: FUNCTIONAL, grandma: true, parallel: true });
  const functional = q.filter((s) => s.id.startsWith('functional:'));
  assert.equal(functional.length, FUNCTIONAL.length, 'one process per functional module');
  assert.deepEqual(
    functional.map((s) => s.args[0]).sort(),
    FUNCTIONAL.map((id) => `--modules=${id}`).sort(),
  );
  assert.equal(q.length, FUNCTIONAL.length + 1);
}

// Selection still decides what runs at all — parallelism never adds a suite.
{
  assert.deepEqual(buildQueue({}), []);
  assert.deepEqual(
    buildQueue({ grandma: true, parallel: true }).map((s) => s.id),
    ['grandma'],
  );
  assert.deepEqual(
    buildQueue({ functional: [], parallel: true }),
    [],
    'no functional modules means no functional process',
  );
}

// Every suite is directly runnable — id, script and args are what the pool spawns.
for (const parallel of [false, true]) {
  for (const suite of buildQueue({ functional: FUNCTIONAL, grandma: true, parallel })) {
    assert.ok(suite.id && suite.name, 'suite is labelled');
    assert.match(suite.script, /\.mjs$/, 'suite names a script');
    assert.ok(Array.isArray(suite.args), 'suite carries argv');
  }
}

console.log('validate-ui-queue: ok');
