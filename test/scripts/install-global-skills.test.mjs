#!/usr/bin/env node
/**
 * Global Matt Pocock skills installer helpers.
 *
 *   node test/scripts/install-global-skills.test.mjs
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, lstatSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILLS_ADD_ARGS,
  SKILLS_SOURCE,
  agentsSkillsDir,
  cursorSkillsDir,
  ensureCursorSkillsLink,
} from '../../scripts/install-global-skills.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

assert.equal(SKILLS_SOURCE, 'mattpocock/skills');
assert.ok(SKILLS_ADD_ARGS.includes('-g'));
assert.ok(SKILLS_ADD_ARGS.includes('cursor'));
assert.equal(agentsSkillsDir('/home/u'), '/home/u/.agents/skills');
assert.equal(cursorSkillsDir('/home/u'), '/home/u/.cursor/skills');

const env = JSON.parse(readFileSync(join(root, '.cursor/environment.json'), 'utf8'));
assert.match(
  env.install,
  /node scripts\/install-global-skills\.mjs/,
  'Cloud install must run the global skills installer',
);
assert.match(env.install, /^npm ci/m);

const scratch = mkdtempSync(join(tmpdir(), 'skills-link-'));
try {
  const agentsDir = join(scratch, 'agents', 'skills');
  const cursorDir = join(scratch, 'cursor', 'skills');
  mkdirSync(agentsDir, { recursive: true });
  writeFileSync(join(agentsDir, 'tdd.md'), 'skill');

  const linked = await ensureCursorSkillsLink({ agentsDir, cursorDir });
  assert.equal(linked, cursorDir);
  assert.ok(lstatSync(cursorDir).isSymbolicLink());
  assert.equal(readlinkSync(cursorDir), agentsDir);

  const again = await ensureCursorSkillsLink({ agentsDir, cursorDir });
  assert.equal(again, cursorDir);
  assert.equal(readlinkSync(cursorDir), agentsDir);

  const occupied = join(scratch, 'cursor', 'occupied');
  mkdirSync(occupied);
  writeFileSync(join(occupied, 'keep.txt'), 'nope');
  const skipped = await ensureCursorSkillsLink({ agentsDir, cursorDir: occupied });
  assert.equal(skipped, occupied);
  assert.equal(lstatSync(occupied).isDirectory(), true);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('install-global-skills tests ok');
