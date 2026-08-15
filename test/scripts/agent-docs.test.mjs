import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadManifest,
  composeAgentDocs,
  checkAgentDocs,
  writeAgentDocs,
  extractGitnexusBlock,
} from '../../scripts/lib/agent-docs/compose.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const manifest = loadManifest(join(root, 'scripts/lib/agent-docs/manifest.json'));

for (const policy of manifest.policies) {
  const policyPath = join(root, manifest.policiesDir, `${policy.id}.md`);
  assert.ok(existsSync(policyPath), `missing policy file: ${policy.id}`);
}

const outputs = composeAgentDocs({ manifest, rootDir: root });
assert.ok(outputs.has('AGENTS.md'), 'composes AGENTS.md');
assert.ok(outputs.has('CLAUDE.md'), 'composes CLAUDE.md');

const agents = outputs.get('AGENTS.md');
assert.match(agents, /<!-- agent-docs:generated -->/);
assert.match(agents, /<!-- gitnexus:start -->/);
assert.match(agents, /worktree policy/);
assert.doesNotMatch(agents, /never hand-edit the generated JSON/);

const claude = outputs.get('CLAUDE.md');
assert.equal(claude, agents, 'AGENTS.md and CLAUDE.md share the same generated body');

const builderRule = outputs.get('.cursor/rules/builder-app-contract.mdc');
assert.match(builderRule, /builder-app-contract policy/);
assert.ok(builderRule.length < 500, 'cursor rule stays slim');

const drift = checkAgentDocs({ manifest, rootDir: root });
assert.equal(drift.length, 0, `drift: ${drift.map((d) => d.path).join(', ')}`);

// Idempotent build
writeAgentDocs({ manifest, rootDir: root });
const driftAfter = checkAgentDocs({ manifest, rootDir: root });
assert.equal(driftAfter.length, 0);

console.log('agent-docs.test: ok');
