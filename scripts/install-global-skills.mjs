#!/usr/bin/env node
/**
 * Install official Matt Pocock skills globally (not in this repo).
 *
 * Cloud Agents run this from `.cursor/environment.json` `install`.
 * Cursor loads `~/.cursor/skills`; skills.sh writes `~/.agents/skills`.
 *
 *   node scripts/install-global-skills.mjs
 */
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readlink, rmdir, symlink, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_SOURCE = 'mattpocock/skills';
export const SKILLS_ADD_ARGS = [
  '-y',
  'skills@latest',
  'add',
  SKILLS_SOURCE,
  '-g',
  '-y',
  '--skill',
  '*',
  '-a',
  'cursor',
];

export function agentsSkillsDir(home = homedir()) {
  return join(home, '.agents', 'skills');
}

export function cursorSkillsDir(home = homedir()) {
  return join(home, '.cursor', 'skills');
}

function run(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...opts });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

/**
 * Point Cursor's global skills dir at the skills.sh install.
 * No-op when ~/.cursor/skills is already a non-empty real directory.
 */
export async function ensureCursorSkillsLink({
  agentsDir = agentsSkillsDir(),
  cursorDir = cursorSkillsDir(),
} = {}) {
  await mkdir(join(cursorDir, '..'), { recursive: true });

  let st = null;
  try {
    st = await lstat(cursorDir);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (st?.isSymbolicLink()) {
    const current = await readlink(cursorDir);
    if (current === agentsDir) return cursorDir;
    await unlink(cursorDir);
  } else if (st?.isDirectory()) {
    const entries = await readdir(cursorDir);
    if (entries.length > 0) {
      console.warn(
        `install-global-skills: ${cursorDir} is a non-empty directory; not replacing with a symlink`,
      );
      return cursorDir;
    }
    await rmdir(cursorDir);
  } else if (st) {
    await unlink(cursorDir);
  }

  await symlink(agentsDir, cursorDir);
  return cursorDir;
}

export async function installMattPocockSkills({
  npx = 'npx',
  args = SKILLS_ADD_ARGS,
  cwd,
} = {}) {
  const workdir = cwd ?? (await mkdtemp(join(tmpdir(), 'matt-skills-')));
  await run(npx, args, { cwd: workdir });
}

async function main() {
  await installMattPocockSkills();
  const linked = await ensureCursorSkillsLink();
  console.log(`install-global-skills: Cursor skills at ${linked}`);
}

const isDirect =
  Boolean(process.argv[1]) &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
