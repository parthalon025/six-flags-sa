#!/usr/bin/env node
/**
 * Build or check always-loaded agent docs from policy templates.
 *
 *   node scripts/agent-docs.mjs build
 *   node scripts/agent-docs.mjs check
 *   npm run agent-docs:build
 *   npm run agent-docs:check
 */
import { composeAgentDocs, writeAgentDocs, checkAgentDocs } from './lib/agent-docs/compose.mjs';

const mode = process.argv[2] || 'check';

if (mode === 'build') {
  const written = writeAgentDocs();
  console.log(`agent-docs: wrote ${written.length} files`);
  for (const p of written) console.log(`  ${p}`);
  process.exit(0);
}

if (mode === 'check') {
  const drift = checkAgentDocs();
  if (drift.length) {
    console.error('agent-docs: generated files are out of date. Run: npm run agent-docs:build');
    for (const d of drift) console.error(`  ${d.path} (${d.reason})`);
    process.exit(1);
  }
  console.log('agent-docs: ok');
  process.exit(0);
}

console.error('Usage: node scripts/agent-docs.mjs <build|check>');
process.exit(1);
