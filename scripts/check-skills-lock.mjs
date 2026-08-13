#!/usr/bin/env node
/**
 * Assert this repo does not vendor Matt Pocock skills.
 * Those live globally in ~/.agents/skills. Project copies duplicate them
 * in every Cursor/Claude session.
 */
import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOCK_PATH = join(ROOT, 'skills-lock.json');
const SKILLS_DIR = join(ROOT, '.agents', 'skills');

function fail(message) {
  console.error(`skills-lock check failed: ${message}`);
  process.exitCode = 1;
}

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (await exists(LOCK_PATH)) {
    fail(
      'skills-lock.json must not exist — Matt Pocock skills are global, not vendored here',
    );
  }

  if (await exists(SKILLS_DIR)) {
    let dirs = [];
    try {
      dirs = (await readdir(SKILLS_DIR, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      dirs = ['<unreadable>'];
    }
    if (dirs.length > 0) {
      fail(
        `.agents/skills must not vendor skills (found: ${dirs.join(', ')}). ` +
          `Install globally: node scripts/install-global-skills.mjs`,
      );
    }
  }

  if (process.exitCode) return;
  console.log('skills-lock ok: no vendored Matt Pocock skills in this repo');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
