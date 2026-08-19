#!/usr/bin/env node
/**
 * Agent-handoff watch — trigger decision and gh scoping.
 *
 *   node test/scripts/agent-handoff-watch.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  REQUIRED_COMMENT_PREFIX,
  assertScopedGhArgs,
  shouldTriage,
} from '../../scripts/lib/agent-handoff-watch.mjs';

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

const disclosedBody = `${REQUIRED_COMMENT_PREFIX}\n\nFound a duplicate: #10.`;

// assertScopedGhArgs: reads and comment/label writes on the allowed issue pass
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'view', '42', '--comments'], 42));
assert.doesNotThrow(() =>
  assertScopedGhArgs(['issue', 'comment', '42', '--body', disclosedBody], 42),
);
assert.doesNotThrow(() =>
  assertScopedGhArgs(['issue', 'edit', '42', '--add-label', 'ready-for-agent'], 42),
);
assert.doesNotThrow(() =>
  assertScopedGhArgs(
    ['issue', 'edit', '42', '--add-label', 'ready-for-agent', '--remove-label', 'needs-triage'],
    42,
  ),
);
assert.doesNotThrow(() => assertScopedGhArgs(['issue', 'list', '--label', 'agent-handoff'], 42));
assert.doesNotThrow(() =>
  assertScopedGhArgs(['search', 'issues', 'in:title', 'foo'], 42),
);
// string/number issue-number mismatch between the workflow env and gh's argv is not a bypass
assert.doesNotThrow(() =>
  assertScopedGhArgs(['issue', 'comment', '42', '--body', disclosedBody], '42'),
);

// assertScopedGhArgs: writes naming a different issue are refused
assert.throws(
  () => assertScopedGhArgs(['issue', 'comment', '43', '--body', disclosedBody], 42),
  /#42/,
);
assert.throws(() => assertScopedGhArgs(['issue', 'edit', '1', '--add-label', 'x'], 42), /#42/);
assert.throws(() => assertScopedGhArgs(['issue', 'view', '43'], 42), /#42/);

// assertScopedGhArgs: an edit naming the right issue but touching anything
// besides labels is refused — title/body/assignee are attacker-influenced
// content on a handoff issue, not something this workflow should ever write.
assert.throws(
  () => assertScopedGhArgs(['issue', 'edit', '42', '--title', 'renamed'], 42),
  /not allowed/,
);
assert.throws(
  () => assertScopedGhArgs(['issue', 'edit', '42', '--body', 'rewritten'], 42),
  /not allowed/,
);
assert.throws(
  () => assertScopedGhArgs(['issue', 'edit', '42', '--add-assignee', 'someone'], 42),
  /not allowed/,
);

// assertScopedGhArgs: a comment without the AI-disclosure prefix is refused
assert.throws(
  () => assertScopedGhArgs(['issue', 'comment', '42', '--body', 'no disclosure here'], 42),
  /AI-disclosure prefix|must start with/,
);
assert.throws(
  () => assertScopedGhArgs(['issue', 'comment', '42'], 42),
  /AI-disclosure prefix/,
);

// assertScopedGhArgs: destructive or out-of-scope subcommands are refused outright
assert.throws(() => assertScopedGhArgs(['issue', 'close', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['issue', 'delete', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['pr', 'merge', '42'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs(['api', 'repos/x/y'], 42), /not allowed/);
assert.throws(() => assertScopedGhArgs([], 42), /expected a gh subcommand/);

// The workflow's prompt repeats the disclosure prefix as agent-facing text —
// keep it byte-identical to what assertScopedGhArgs actually enforces.
const workflowYaml = readFileSync(
  new URL('../../.github/workflows/agent-handoff-watch.yml', import.meta.url),
  'utf8',
);
assert.ok(
  workflowYaml.includes(REQUIRED_COMMENT_PREFIX),
  'agent-handoff-watch.yml prompt must repeat REQUIRED_COMMENT_PREFIX verbatim',
);

console.log('agent-handoff-watch.test: ok');
