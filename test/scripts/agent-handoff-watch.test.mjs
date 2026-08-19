#!/usr/bin/env node
/**
 * Agent-handoff watch — trigger decision and gh scoping.
 *
 *   node test/scripts/agent-handoff-watch.test.mjs
 */
import assert from 'node:assert/strict';
import { assertScopedGhArgs, shouldTriage } from '../../scripts/lib/agent-handoff-watch.mjs';

// shouldTriage: opened events only fire when the agent-handoff label is present
assert.equal(
  shouldTriage({ action: 'opened', issue: { labels: [{ name: 'agent-handoff' }] } }),
  true,
);
assert.equal(
  shouldTriage({ action: 'opened', issue: { labels: [{ name: 'needs-triage' }] } }),
  false,
);
assert.equal(shouldTriage({ action: 'opened', issue: { labels: [] } }), false);

// shouldTriage: labeled events only fire when the label just added is agent-handoff
assert.equal(shouldTriage({ action: 'labeled', label: { name: 'agent-handoff' } }), true);
assert.equal(shouldTriage({ action: 'labeled', label: { name: 'ready-for-agent' } }), false);

// shouldTriage: every other action (closed, reopened, unlabeled, ...) never fires
assert.equal(shouldTriage({ action: 'closed', issue: { labels: [] } }), false);
assert.equal(shouldTriage(null), false);
assert.equal(shouldTriage({}), false);

// assertScopedGhArgs: reads and comment/label writes on the allowed issue pass
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'view', '42', '--comments'], 42));
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'comment', '42', '--body', 'hi'], 42));
assert.doesNotThrow(() =>
  assertScopedGhArgs(['issue', 'edit', '42', '--add-label', 'ready-for-agent'], 42),
);
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'list', '--label', 'agent-handoff'], 42));
assert.doesNotThrow(() =>
  assertScopedGhArgs(['search', 'issues', 'in:title', 'foo'], 42),
);
// string/number issue-number mismatch between the workflow env and gh's argv is not a bypass
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'comment', '42', '--body', 'hi'], '42'));

// assertScopedGhArgs: writes naming a different issue are refused
assert.throws(() => assertScopedGhArgs(['issue', 'comment', '43', '--body', 'hi'], 42), /#42/);
assert.throws(() => assertScopedGhArgs(['issue', 'edit', '1', '--add-label', 'x'], 42), /#42/);
assert.throws(() => assertScopedGhArgs(['issue', 'view', '43'], 42), /#42/);

// assertScopedGhArgs: destructive or out-of-scope subcommands are refused outright
assert.throws(() => assertScopedGhArgs(['issue', 'close', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['issue', 'delete', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['pr', 'merge', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['api', 'repos/x/y'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs([], 42), /expected a gh subcommand/);

console.log('agent-handoff-watch.test: ok');
