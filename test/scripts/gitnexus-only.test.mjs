#!/usr/bin/env node
/**
 * GitNexus-only diff classifier (Vercel ignore).
 *
 *   node test/scripts/gitnexus-only.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GITNEXUS_INDEX_PATHS,
  isGitnexusCiNoise,
  isGitnexusOnlyChange,
} from '../../scripts/lib/gitnexus-only.mjs';

assert.deepEqual(GITNEXUS_INDEX_PATHS, ['.gitnexus/', 'AGENTS.md', 'CLAUDE.md']);

assert.equal(isGitnexusCiNoise('.gitnexus/meta.json'), true);
assert.equal(isGitnexusCiNoise('.gitnexus/lbug'), true);
assert.equal(isGitnexusCiNoise('.gitnexus/parse-cache/abc.json'), true);
assert.equal(isGitnexusCiNoise('.gitnexus'), true);
assert.equal(isGitnexusCiNoise('AGENTS.md'), true);
assert.equal(isGitnexusCiNoise('CLAUDE.md'), true);
assert.equal(isGitnexusCiNoise('.gitnexus\\lbug'), true);
assert.equal(isGitnexusCiNoise('./.gitnexus/meta.json'), true);

assert.equal(isGitnexusCiNoise('README.md'), false);
assert.equal(isGitnexusCiNoise('apps/party-tracker/app/page.js'), false);
assert.equal(isGitnexusCiNoise('.github/workflows/test-app.yml'), false);
assert.equal(isGitnexusCiNoise('scripts/gitnexus-sync.mjs'), false);
assert.equal(isGitnexusCiNoise('.claude/skills/gitnexus/gitnexus-cli/SKILL.md'), false);

assert.equal(isGitnexusOnlyChange([]), false, 'empty diff fails open');
assert.equal(isGitnexusOnlyChange(['.gitnexus/meta.json']), true);
assert.equal(
  isGitnexusOnlyChange(['.gitnexus/lbug', 'AGENTS.md', 'CLAUDE.md']),
  true,
);
assert.equal(
  isGitnexusOnlyChange(['.gitnexus/meta.json', 'apps/party-tracker/app/page.js']),
  false,
);
assert.equal(isGitnexusOnlyChange(['AGENTS.md']), true);
assert.equal(isGitnexusOnlyChange(['CLAUDE.md']), true);
assert.equal(isGitnexusOnlyChange(['README.md']), false);
assert.equal(
  isGitnexusOnlyChange(['.gitnexus/meta.json', 'package.json']),
  false,
);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const sync = readFileSync(join(root, 'scripts/gitnexus-sync.mjs'), 'utf8');
assert.doesNotMatch(sync, /git add -f \.gitnexus/, 'must not stage .gitnexus for commit');
assert.match(sync, /--commit is ignored/, 'legacy --commit must not write the index');
assert.match(
  readFileSync(join(root, '.gitignore'), 'utf8'),
  /^\.gitnexus\/$/m,
  '.gitnexus/ must be gitignored',
);

console.log('gitnexus-only tests: ok');
