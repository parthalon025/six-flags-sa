#!/usr/bin/env node
/**
 * Factory CI leg selection — path filters for map / visual / delivery jobs.
 *
 *   node test/scripts/factory-legs.test.mjs
 */
import assert from 'node:assert/strict';
import {
  FACTORY_LEG_PATHS,
  factoryLegsForFiles,
  factoryLegGithubOutputs,
} from '../../scripts/lib/factory-legs.mjs';

{
  const legs = factoryLegsForFiles(['packages/venue-builder/lib/map-factory/map-io.mjs']);
  assert.equal(legs.map, true);
  assert.equal(legs.visual, false);
  assert.equal(legs.delivery, false);
}

{
  const legs = factoryLegsForFiles(['packages/venue-builder/lib/visual-factory/index.mjs']);
  assert.equal(legs.visual, true);
  assert.equal(legs.map, false);
}

{
  const legs = factoryLegsForFiles(['scripts/lib/venue-freshness.mjs']);
  assert.equal(legs.delivery, true);
}

{
  const outs = factoryLegGithubOutputs(['docs/adr/0025-factory-module-seams.md']);
  assert.deepEqual(outs, {
    map_factory: 'false',
    visual_factory: 'false',
    delivery_factory: 'false',
  });
}

assert.ok(FACTORY_LEG_PATHS.map.length >= 3);
assert.ok(FACTORY_LEG_PATHS.visual.length >= 3);
assert.ok(FACTORY_LEG_PATHS.delivery.length >= 3);

console.log('factory-legs.test: ok');
