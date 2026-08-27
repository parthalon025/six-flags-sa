#!/usr/bin/env node
/**
 * Builder ↔ app contract gate — generated venue output must match the binding
 * stamped at reindex (docs/agents/policies/builder-app-contract.md).
 *
 *   node test/scripts/builder-app-contract.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bindingDecision,
  collectGeneratedFileHashes,
  checkBuilderAppContract,
  aggregateBindingSha256,
  builderAppContractFailureHint,
} from '../../scripts/lib/builder-app-contract.mjs';

/* -------------------------------------------------------- bindingDecision */

{
  const files = [
    { path: 'apps/party-tracker/public/venues/a.map.json', sha256: 'aaa' },
    { path: 'apps/party-tracker/lib/venueIndex.js', sha256: 'bbb' },
  ];
  const binding = {
    algorithm: 'sha256-aggregate-v1',
    sha256: aggregateBindingSha256(files),
    files,
  };
  const ok = bindingDecision({
    binding,
    files,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.drifted, []);
  assert.deepEqual(ok.missing, []);

  const bad = bindingDecision({
    binding,
    files: [{ ...files[0], sha256: 'CHANGED' }, files[1]],
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.drifted, ['apps/party-tracker/public/venues/a.map.json']);
  assert.deepEqual(bad.missing, []);

  const gone = bindingDecision({ binding, files: [files[1]] });
  assert.equal(gone.ok, false);
  assert.deepEqual(gone.missing, ['apps/party-tracker/public/venues/a.map.json']);
}

/* ------------------------------------------------ collectGeneratedFileHashes */

{
  const root = mkdtempSync(join(tmpdir(), 'builder-contract-'));
  const venues = join(root, 'apps/party-tracker/public/venues');
  const lib = join(root, 'apps/party-tracker/lib');
  mkdirSync(venues, { recursive: true });
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(venues, 'park.map.json'), '{"meta":{"id":"park"}}');
  writeFileSync(join(venues, 'park.pois.json'), '[]');
  writeFileSync(join(venues, 'park.gaps.json'), '{"gaps":[]}');
  writeFileSync(join(lib, 'venueIndex.js'), 'export const VENUES = [];');
  writeFileSync(
    join(venues, 'manifest.json'),
    JSON.stringify({ version: 1, default: 'park', venues: [{ id: 'park' }] }),
  );

  const files = collectGeneratedFileHashes(root);
  assert.ok(
    files.some((f) => f.path.endsWith('park.map.json')),
    'truth trio is collected',
  );
  assert.ok(files.some((f) => f.path.endsWith('venueIndex.js')), 'venue index is collected');
  assert.ok(files.some((f) => f.path.endsWith('manifest.json')), 'manifest is collected');

  const stamped = {
    algorithm: 'sha256-aggregate-v1',
    sha256: 'deadbeef',
    files,
  };
  writeFileSync(
    join(venues, 'manifest.json'),
    JSON.stringify({
      version: 1,
      default: 'park',
      venues: [{ id: 'park' }],
      generatedBinding: stamped,
    }),
  );
  const rebound = collectGeneratedFileHashes(root);
  assert.equal(
    rebound.find((f) => f.path.endsWith('manifest.json'))?.sha256,
    files.find((f) => f.path.endsWith('manifest.json'))?.sha256,
    'manifest hash ignores generatedBinding field',
  );

  rmSync(root, { recursive: true, force: true });
}

/* ----------------------------------------------- hand-edit fails the gate */

{
  const root = mkdtempSync(join(tmpdir(), 'builder-contract-edit-'));
  const venues = join(root, 'apps/party-tracker/public/venues');
  const lib = join(root, 'apps/party-tracker/lib');
  mkdirSync(venues, { recursive: true });
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(venues, 'park.map.json'), '{"meta":{"id":"park"}}');
  writeFileSync(join(venues, 'park.pois.json'), '[]');
  writeFileSync(join(venues, 'park.gaps.json'), '{"gaps":[]}');
  writeFileSync(join(lib, 'venueIndex.js'), 'export const VENUES = [];');
  const files = collectGeneratedFileHashes(root);
  const binding = {
    algorithm: 'sha256-aggregate-v1',
    sha256: aggregateBindingSha256(files),
    files,
  };
  writeFileSync(
    join(venues, 'manifest.json'),
    JSON.stringify({
      version: 1,
      default: 'park',
      venues: [{ id: 'park' }],
      generatedBinding: binding,
    }),
  );
  writeFileSync(join(venues, 'park.map.json'), '{"meta":{"id":"park","hand":true}}');
  const gate = checkBuilderAppContract(root);
  assert.equal(gate.ok, false);
  assert.ok(gate.drifted.includes('apps/party-tracker/public/venues/park.map.json'));
  rmSync(root, { recursive: true, force: true });
}

{
  const root = mkdtempSync(join(tmpdir(), 'builder-contract-index-edit-'));
  const venues = join(root, 'apps/party-tracker/public/venues');
  const lib = join(root, 'apps/party-tracker/lib');
  mkdirSync(venues, { recursive: true });
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(venues, 'park.map.json'), '{"meta":{"id":"park"}}');
  writeFileSync(join(venues, 'park.pois.json'), '[]');
  writeFileSync(join(venues, 'park.gaps.json'), '{"gaps":[]}');
  writeFileSync(join(lib, 'venueIndex.js'), 'export const VENUES = [];');
  const files = collectGeneratedFileHashes(root);
  const binding = {
    algorithm: 'sha256-aggregate-v1',
    sha256: aggregateBindingSha256(files),
    files,
  };
  writeFileSync(
    join(venues, 'manifest.json'),
    JSON.stringify({
      version: 1,
      default: 'park',
      venues: [{ id: 'park' }],
      generatedBinding: binding,
    }),
  );
  writeFileSync(join(lib, 'venueIndex.js'), 'export const VENUES = [{ id: "hand" }];');
  const gate = checkBuilderAppContract(root);
  assert.equal(gate.ok, false);
  assert.ok(gate.drifted.includes('apps/party-tracker/lib/venueIndex.js'));
  assert.match(builderAppContractFailureHint(), /builder-app-contract\.md/);
  rmSync(root, { recursive: true, force: true });
}

/* --------------------------------------------------------- the repo gate */

{
  const gate = checkBuilderAppContract();
  const explain = JSON.stringify(
    { drifted: gate.drifted, missing: gate.missing, unstamped: gate.unstamped },
    null,
    2,
  );
  assert.ok(
    gate.ok,
    `${builderAppContractFailureHint()}:\n${explain}`,
  );
}

console.log('builder-app-contract: ok (generated venue files match reindex binding)');
