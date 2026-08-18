#!/usr/bin/env node
/**
 * Matt-standards mechanical checks — unit behaviour + the live repo gate.
 *
 *   node test/scripts/matt-standards.test.mjs
 */
import assert from 'node:assert/strict';
import {
  functionalModulesDrift,
  runMattStandardsChecks,
  untestedScriptsLibModules,
  venueBuilderPathLiterals,
} from '../../scripts/lib/matt-standards.mjs';

// untestedScriptsLibModules
{
  const libFiles = ['scripts/lib/a.mjs', 'scripts/lib/b.mjs', 'scripts/lib/c.mjs'];
  const testSources = {
    'test/scripts/a.test.mjs': "import { x } from '../../scripts/lib/a.mjs';",
  };
  assert.deepEqual(
    untestedScriptsLibModules({ libFiles, testSources, allowlist: ['scripts/lib/c.mjs'] }),
    ['scripts/lib/b.mjs'],
    'uncovered module reported; allowlisted one is not',
  );
  assert.deepEqual(
    untestedScriptsLibModules({ libFiles: ['scripts/lib/a.mjs'], testSources }),
    [],
    'covered module passes',
  );
}

// functionalModulesDrift
{
  const functionalSource = "if (want('smoke')) {} if (want('walk')) {} if (want('ghost')) {}";
  const manifest = {
    modules: [
      { id: 'smoke', kind: 'functional' },
      { id: 'walk', kind: 'functional' },
      { id: 'party', kind: 'functional' },
      { id: 'grandma', kind: 'grandma' },
    ],
  };
  const drift = functionalModulesDrift({ functionalSource, manifest });
  assert.deepEqual(drift.unmapped, ['ghost'], 'want id missing from manifest is unmapped');
  assert.deepEqual(drift.unused, ['party'], 'manifest id never wanted is unused');
}

// venueBuilderPathLiterals
{
  const appSources = {
    'apps/x/ok.js': "import { a } from '@party-tracker/shared/ontology.js';",
    'apps/x/bad.js': "const p = join(root, 'packages/venue-builder', 'data');",
    'apps/x/allowed.js': "const p = 'packages/venue-builder/data';",
  };
  assert.deepEqual(
    venueBuilderPathLiterals({ appSources, allowlist: ['apps/x/allowed.js'] }),
    ['apps/x/bad.js'],
    'path literal flagged; allowlist honored',
  );
}

// Live repo must pass — this is the gate.
{
  const problems = runMattStandardsChecks();
  for (const p of problems) console.error(' !', p);
  assert.equal(problems.length, 0, 'matt-standards checks pass on the repo');
}

console.log('matt-standards: ok');
