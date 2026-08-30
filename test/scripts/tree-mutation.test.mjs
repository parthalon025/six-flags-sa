#!/usr/bin/env node
/**
 * The gate that catches a test leg rewriting tracked files (#34).
 *
 * Exercises `treeMutationReason` against snapshot pairs rather than a real
 * repository: the thing under test is the comparison, and a suite that shelled
 * out to git to prove a point about suites touching tracked state would be
 * making the ticket's own mistake.
 */
import assert from 'node:assert/strict';
import { trackedTreeSnapshot, treeMutationReason, uncommittedWorkReason } from '../../scripts/lib/tree-mutation.mjs';

const FIXTURE = 'packages/venue-builder/data/venues/fixture-park/google-places-cache.json';

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}\n    ${err.message}`);
  }
}

console.log('\ntree-mutation\n');

check('an unchanged tree is not a mutation', () => {
  const snap = new Map([['apps/party-tracker/lib/mapView.js', ' M']]);
  assert.equal(treeMutationReason(snap, new Map(snap)), null);
});

check("a developer's own pre-existing edits are not the thing being caught", () => {
  const before = new Map([['apps/party-tracker/lib/mapView.js', ' M']]);
  const after = new Map([['apps/party-tracker/lib/mapView.js', ' M']]);
  assert.equal(treeMutationReason(before, after), null);
});

check('a file the legs newly dirtied is named in the refusal', () => {
  const reason = treeMutationReason(new Map(), new Map([[FIXTURE, ' M']]));
  assert.ok(reason, 'a newly dirty tracked file must refuse the run');
  assert.match(reason, /rewrote 1 tracked file/);
  assert.match(reason, /google-places-cache\.json/);
  assert.match(reason, /inject the sink/, 'the message must say what to do instead');
});

check('a file whose status changed under the legs counts', () => {
  const reason = treeMutationReason(new Map([[FIXTURE, ' M']]), new Map([[FIXTURE, 'M ']]));
  assert.ok(reason);
  assert.match(reason, /google-places-cache\.json/);
});

check('a file the legs restored counts too — a revert is still a rewrite', () => {
  const reason = treeMutationReason(new Map([[FIXTURE, ' M']]), new Map());
  assert.ok(reason);
  assert.match(reason, /google-places-cache\.json/);
});

check('every dirtied file is listed, deduplicated and sorted', () => {
  const reason = treeMutationReason(new Map([['b.json', ' M']]), new Map([['a.json', ' M']]));
  assert.match(reason, /2 tracked file\(s\): a\.json, b\.json/);
});

check('an unreadable git tree is reported as no mutation, not as a refusal', () => {
  assert.equal(treeMutationReason(null, new Map([[FIXTURE, ' M']])), null);
  assert.equal(treeMutationReason(new Map(), null), null);
});

check('a snapshot of a real repository reads paths, not status columns', () => {
  const snap = trackedTreeSnapshot(process.cwd());
  assert.ok(snap instanceof Map, 'this repo is a git checkout, so a snapshot is readable');
  for (const [file, status] of snap) {
    assert.ok(!file.startsWith(' '), `path "${file}" still carries a status column`);
    assert.equal(status.length, 2, `status "${status}" is not the porcelain v1 two-column form`);
  }
});

check('a snapshot outside a git checkout is null, not a throw', () => {
  assert.equal(trackedTreeSnapshot('/'), null);
});

check('uncommitted work outside a git checkout is not refused', () => {
  assert.equal(uncommittedWorkReason('/'), null);
});

console.log(`\n==== ${passed} passed, ${failed} failed ====\n`);
if (failed) process.exit(1);
