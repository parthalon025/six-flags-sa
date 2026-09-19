/**
 * Pipeline agent-stage external evidence enablement (#398).
 *
 * Seams: parseCatalogArgs / pipelineOptsFromCatalogArgs (CLI → opts),
 * resolvePipelineAgentOrchestratorOpts (opts → orchestrator fetch flags).
 */

import assert from 'node:assert/strict';
import {
  parseCatalogArgs,
  pipelineOptsFromCatalogArgs,
  pipelineOptsForPark,
  resolvePipelineAgentOrchestratorOpts,
  runVenuePipeline,
} from '../../packages/venue-builder/lib/build-pipeline.mjs';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('pipeline-agent-evidence');

await check('parseCatalogArgs recognises --agent-fetch', () => {
  const args = parseCatalogArgs(['--pipeline', '--agent-fetch']);
  assert.equal(args.agentFetch, true);
});

await check('pipelineOptsFromCatalogArgs defaults agentFetch off', () => {
  const opts = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--pipeline']));
  assert.equal(opts.agentFetch, false);
});

await check('pipelineOptsFromCatalogArgs plumbs --agent-fetch to pipeline opts', () => {
  const opts = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--pipeline', '--agent-fetch']));
  assert.equal(opts.agentFetch, true);
});

await check('pipelineOptsForPark passes agentFetch through catalog batch loop', () => {
  const park = { id: 'cedar-point', rank: 2, kind: 'theme-park' };
  const opts = pipelineOptsForPark(park, parseCatalogArgs(['--catalog', '--agent-fetch']), { batch: true });
  assert.equal(opts.agentFetch, true);
});

await check('resolvePipelineAgentOrchestratorOpts stays offline by default', () => {
  assert.deepEqual(resolvePipelineAgentOrchestratorOpts({}), {
    fetch: false,
    browser: false,
    parksApi: false,
    offline: true,
  });
});

await check('resolvePipelineAgentOrchestratorOpts enables fetch when agentFetch is true', () => {
  assert.deepEqual(resolvePipelineAgentOrchestratorOpts({ agentFetch: true }), {
    fetch: true,
    browser: true,
    parksApi: true,
    offline: false,
  });
});

await check('resolvePipelineAgentOrchestratorOpts honours --no-browser when agentFetch is on', () => {
  assert.deepEqual(resolvePipelineAgentOrchestratorOpts({ agentFetch: true, browser: false }), {
    fetch: true,
    browser: false,
    parksApi: true,
    offline: false,
  });
});

await check('dry-run agent stage records externalEvidence off by default', async () => {
  const result = await runVenuePipeline(
    { id: 'cedar-point', rank: 2, name: 'Cedar Point', place: 'Cedar Point', locality: 'Sandusky, Ohio' },
    { dryRun: true },
  );
  assert.equal(result.stages.agent?.externalEvidence, false);
});

await check('dry-run agent stage records externalEvidence on with --agent-fetch', async () => {
  const result = await runVenuePipeline(
    { id: 'cedar-point', rank: 2, name: 'Cedar Point', place: 'Cedar Point', locality: 'Sandusky, Ohio' },
    { dryRun: true, agentFetch: true },
  );
  assert.equal(result.stages.agent?.externalEvidence, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
