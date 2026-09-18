/**
 * Pipeline LLM research enablement (#411).
 *
 * Seams: parseCatalogArgs / pipelineOptsFromCatalogArgs (CLI → opts),
 * resolvePipelineResearchAi (catalog + flag → research ai boolean).
 */

import assert from 'node:assert/strict';
import {
  parseCatalogArgs,
  pipelineOptsFromCatalogArgs,
  resolvePipelineResearchAi,
  venueRequestsAiResearch,
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

console.log('pipeline-ai');

await check('parseCatalogArgs recognises --ai', () => {
  const args = parseCatalogArgs(['--pipeline', '--ai']);
  assert.equal(args.ai, true);
});

await check('pipelineOptsFromCatalogArgs plumbs --ai to pipeline opts', () => {
  const opts = pipelineOptsFromCatalogArgs(parseCatalogArgs(['--pipeline', '--ai']));
  assert.equal(opts.ai, true);
});

await check('cedar-point catalog requests AI research', () => {
  assert.equal(venueRequestsAiResearch('cedar-point'), true);
});

await check('magic-kingdom catalog does not request AI research', () => {
  assert.equal(venueRequestsAiResearch('magic-kingdom'), false);
});

await check('resolvePipelineResearchAi enables AI from catalog without --ai', () => {
  assert.equal(resolvePipelineResearchAi('cedar-point', {}), true);
});

await check('resolvePipelineResearchAi honours explicit --ai', () => {
  assert.equal(resolvePipelineResearchAi('magic-kingdom', { ai: true }), true);
});

await check('resolvePipelineResearchAi keeps AI off when catalog and flag are absent', () => {
  assert.equal(resolvePipelineResearchAi('magic-kingdom', {}), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
