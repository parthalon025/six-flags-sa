#!/usr/bin/env node
/**
 * Agent-policy diff classifier — wayfinder + epic policy JSON.
 *
 *   node test/scripts/agent-policy-diff.test.mjs
 */
import assert from 'node:assert/strict';
import {
  isAgentPolicyFile,
  isAgentPolicyOnlyDiff,
  policyTestsForFiles,
} from '../../scripts/lib/agent-policy-diff.mjs';

assert.equal(isAgentPolicyFile('.scratch/factories-to-app/map.md'), true);
assert.equal(isAgentPolicyFile('scripts/lib/operating-stack.json'), true);
assert.equal(isAgentPolicyFile('docs/adr/0024-postdb-factory-bus.md'), true);
assert.equal(isAgentPolicyFile('apps/party-tracker/app/page.js'), false);

assert.equal(
  isAgentPolicyOnlyDiff([
    '.scratch/factories-to-app/map.md',
    'scripts/lib/operating-stack.json',
  ]),
  true,
);
assert.equal(
  isAgentPolicyOnlyDiff([
    '.scratch/factories-to-app/map.md',
    'apps/party-tracker/app/page.js',
  ]),
  false,
  'mixed diff is not agent-policy only',
);

assert.deepEqual(
  policyTestsForFiles(['scripts/lib/operating-stack.json']),
  ['test/scripts/operating-stack.test.mjs'],
);
assert.ok(
  policyTestsForFiles(['.scratch/factories-to-app/map.md']).includes(
    'test/scripts/wayfinder-committed.test.mjs',
  ),
);

console.log('agent-policy-diff tests ok');
