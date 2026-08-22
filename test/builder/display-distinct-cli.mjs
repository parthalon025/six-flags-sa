#!/usr/bin/env node
/* The display-distinct CLI's process contract (issues #577, #578, #581).

   The library suite in skin-distinct.mjs proves the metrics against synthetic
   images. It cannot see the CLI, and that blind spot is how a real bug shipped:
   --json exited `result.pass ? 0 : 1` while the human path exited 0/1/3, so
   every INDETERMINATE run reported itself to a caller as a failure. Nothing in
   the repo spawned this binary, so nothing noticed.

   These cases assert the contract a caller actually depends on — the exit code,
   and that the two output modes agree — by running the real binary as a
   subprocess against the shipped kings-island bakes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNMAPPED_AXES, AXIS_KNOBS } from '../../packages/venue-builder/lib/skin-distinct.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = path.join(REPO, 'packages/venue-builder/bin/display-distinct.mjs');
const VENUE = 'kings-island';
const PAIR = ['watercolor-quest', 'layered-atlas'];

/** Run the binary and return {status, stdout} without throwing on a non-zero
 *  exit — the exit code is the thing under test, not an error. */
const run = (args) => {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? '' };
  }
};

const bake = (skin) =>
  path.join(REPO, 'apps/party-tracker/public/venues', VENUE, 'display', `${skin}.world.png`);

// The shipped bakes are the fixture. If they ever stop being committed this
// suite must fail loudly rather than quietly testing nothing.
for (const skin of PAIR) {
  assert.ok(existsSync(bake(skin)), `missing fixture bake ${skin}.world.png — this suite needs it`);
}

// --- The two output modes are the same gate and must exit the same way.
// This is the regression that shipped: --json collapsed INDETERMINATE into the
// FAIL exit code, so a caller branching on it read "different worlds, proven
// not distinct" where the tool actually meant "cannot tell".
{
  const human = run([VENUE, ...PAIR]);
  const json = run([VENUE, ...PAIR, '--json']);
  assert.equal(
    json.status,
    human.status,
    `--json exited ${json.status} and the human path exited ${human.status}; `
      + 'they are one gate and must agree',
  );

  const parsed = JSON.parse(json.stdout);
  const EXPECTED = { PASS: 0, FAIL: 1, INDETERMINATE: 3 };
  assert.equal(
    json.status,
    EXPECTED[parsed.outcome],
    `outcome ${parsed.outcome} must exit ${EXPECTED[parsed.outcome]}, got ${json.status}`,
  );
  // 3, not 1: the shipped pair cannot clear a six-axis gate with four axes
  // measurable, and saying FAIL would claim a proof the instrument does not have.
  assert.equal(parsed.outcome, 'INDETERMINATE', 'the shipped pair is the indeterminate case');
  assert.equal(json.status, 3);
}

// --- The axes the tool does not model must reach a caller, not only a reader.
// The human table prints them; --json has to carry them too, or an automated
// consumer sees eleven axes and no hint that six were never considered.
{
  const parsed = JSON.parse(run([VENUE, ...PAIR, '--json']).stdout);
  assert.deepEqual(
    Object.keys(parsed.unmapped ?? {}).sort(),
    Object.keys(UNMAPPED_AXES).sort(),
    '--json must report the unmapped axes',
  );
  const scored = Object.keys(parsed.spec ?? {});
  assert.deepEqual(
    scored.sort(),
    Object.keys(AXIS_KNOBS).sort(),
    'the scored set is exactly the mapped set',
  );
  for (const axis of Object.keys(UNMAPPED_AXES)) {
    assert.ok(!scored.includes(axis), `${axis} is unmapped and must not be scored`);
  }
}

// --- The human table names them too, with the reason, on every run.
{
  const { stdout } = run([VENUE, ...PAIR]);
  assert.match(stdout, /Not modelled by this tool at all/, 'the banner must always print');
  for (const axis of Object.keys(UNMAPPED_AXES)) {
    assert.ok(stdout.includes(axis), `${axis} missing from the unmapped banner`);
  }
}

// --- A missing input is a usage error (2), never a verdict. Exiting 1 here
// would be indistinguishable from "measured, and provably not distinct".
{
  assert.equal(run([VENUE, PAIR[0], 'no-such-skin']).status, 2, 'a missing kit exits 2');
  assert.equal(run([VENUE]).status, 2, 'too few arguments exits 2');
}

// --- --null reports the encode floor and succeeds.
{
  const { status, stdout } = run([VENUE, PAIR[0], '--null']);
  assert.equal(status, 0, '--null exits 0');
  assert.match(stdout, /encode null for/, '--null prints the measured floor');
}

// --- --set runs every pair and answers for the set (slice h14, ADR-0021
// clause 6). Spawned rather than called, for the reason this whole suite
// exists: a gate nothing runs is a library, and its exit code is the part a
// caller depends on.
{
  const { status, stdout } = run([VENUE, ...PAIR, '--set']);
  // Two Skins is the near-miss clause 6 rejected. The one pair may well pass;
  // the SET still cannot, and the run must say which of those two it means.
  assert.equal(status, 3, 'a set below the floor is INDETERMINATE (3), not a pass and not a failure');
  assert.match(stdout, /fewer than 3 Skins/, 'and the output says why the pass is withheld');
  assert.match(stdout, new RegExp(`${PAIR[0]}.*${PAIR[1]}`), 'the pair it did compare is named');

  const parsed = JSON.parse(run([VENUE, ...PAIR, '--set', '--json']).stdout);
  assert.equal(parsed.outcome, 'INDETERMINATE', '--json agrees with the human table');
  assert.equal(parsed.pass, false);
  assert.equal(parsed.pairs.length, 1, 'one unordered pair from two Skins');
  assert.deepEqual(parsed.skins, PAIR);
  assert.equal(
    run([VENUE, ...PAIR, '--set', '--json']).status,
    3,
    'the two output modes are one gate and exit the same way, --set included',
  );

  // A set naming a Skin with no bake cannot be judged at all, and that is a
  // usage error rather than a verdict — the same line the pair path holds.
  assert.equal(run([VENUE, ...PAIR, 'no-such-skin', '--set']).status, 2);
  assert.equal(run([VENUE, PAIR[0], '--set']).status, 2, 'a set of one is not a set');
}

console.log('display-distinct-cli: ok');
