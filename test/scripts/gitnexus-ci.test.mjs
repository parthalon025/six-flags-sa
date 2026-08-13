#!/usr/bin/env node
/**
 * GitNexus index refreshes must not trigger app CI or version bumps.
 *
 *   node test/scripts/gitnexus-ci.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GITNEXUS_INDEX_PATHS,
  GITNEXUS_REFRESH_MESSAGE,
  GITNEXUS_BOT_AUTHOR,
  isGitnexusCiNoise,
  isGitnexusOnlyChange,
  shouldAmendGitnexusIntoBump,
} from '../../scripts/gitnexus-ci.mjs';

assert.deepEqual(GITNEXUS_INDEX_PATHS, ['.gitnexus/', 'AGENTS.md', 'CLAUDE.md']);
assert.equal(GITNEXUS_REFRESH_MESSAGE, 'chore: refresh gitnexus index');

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

assert.equal(isGitnexusOnlyChange([]), false, 'empty diff fails open (run CI)');
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

assert.equal(
  shouldAmendGitnexusIntoBump({
    subject: 'chore: bump version to 1.6.0',
    author: GITNEXUS_BOT_AUTHOR,
  }),
  true,
);
assert.equal(
  shouldAmendGitnexusIntoBump({
    subject: 'chore: bump version to 1.6.0',
    author: 'Cursor Agent',
  }),
  false,
  'do not amend a local bump commit',
);
assert.equal(
  shouldAmendGitnexusIntoBump({
    subject: GITNEXUS_REFRESH_MESSAGE,
    author: GITNEXUS_BOT_AUTHOR,
  }),
  false,
);
assert.equal(shouldAmendGitnexusIntoBump({}), false);

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(join(tmpdir(), 'gitnexus-ci-'));
const skipOut = join(tmp, 'skip');
execFileSync(process.execPath, [
  'scripts/gitnexus-ci.mjs',
  '--files',
  '.gitnexus/lbug',
  'AGENTS.md',
  'CLAUDE.md',
], {
  cwd: root,
  env: { ...process.env, GITHUB_OUTPUT: skipOut },
  encoding: 'utf8',
});
assert.equal(readFileSync(skipOut, 'utf8').trim(), 'run=false');

const runOut = join(tmp, 'run');
execFileSync(process.execPath, [
  'scripts/gitnexus-ci.mjs',
  '--files',
  '.gitnexus/meta.json',
  'apps/party-tracker/app/page.js',
], {
  cwd: root,
  env: { ...process.env, GITHUB_OUTPUT: runOut },
  encoding: 'utf8',
});
assert.equal(readFileSync(runOut, 'utf8').trim(), 'run=true');

console.log('gitnexus-ci tests: ok');
