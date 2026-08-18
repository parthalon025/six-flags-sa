#!/usr/bin/env node
/**
 * Install official Matt Pocock skills globally (not in this repo).
 *
 * Cursor Cloud Agents run this from `.cursor/environment.json` `install`
 * (default agent: cursor). Claude Code on the web runs it from the
 * SessionStart hook `.claude/hooks/session-start.sh` with
 * `--agent claude-code`, which installs into `~/.claude/skills`.
 * Cursor loads `~/.cursor/skills`; skills.sh writes `~/.agents/skills`.
 *
 *   node scripts/install-global-skills.mjs [--agent cursor|claude-code]
 */
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readdir, readlink, rmdir, symlink, unlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILLS_SOURCE = 'mattpocock/skills';
export const SKILLS_AGENTS = ['cursor', 'claude-code'];

export function skillsAddArgs(agent = 'cursor') {
  if (!SKILLS_AGENTS.includes(agent)) {
    throw new Error(
      `unknown skills agent "${agent}" (expected one of: ${SKILLS_AGENTS.join(', ')})`,
    );
  }
  return ['-y', 'skills@latest', 'add', SKILLS_SOURCE, '-g', '-y', '--skill', '*', '-a', agent];
}

export const SKILLS_ADD_ARGS = skillsAddArgs('cursor');

export function agentsSkillsDir(home = homedir()) {
  return join(home, '.agents', 'skills');
}

export function cursorSkillsDir(home = homedir()) {
  return join(home, '.cursor', 'skills');
}

export function claudeSkillsDir(home = homedir()) {
  return join(home, '.claude', 'skills');
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
  agent = 'cursor',
  args = skillsAddArgs(agent),
  cwd,
} = {}) {
  const workdir = cwd ?? (await mkdtemp(join(tmpdir(), 'matt-skills-')));
  await run(npx, args, { cwd: workdir });
}

export function parseAgentArg(argv = process.argv.slice(2)) {
  const flag = argv.indexOf('--agent');
  if (flag === -1) return 'cursor';
  const agent = argv[flag + 1];
  if (!SKILLS_AGENTS.includes(agent)) {
    throw new Error(
      `--agent must be one of: ${SKILLS_AGENTS.join(', ')} (got "${agent ?? ''}")`,
    );
  }
  return agent;
}

async function main() {
  const agent = parseAgentArg();
  await installMattPocockSkills({ agent });
  if (agent === 'cursor') {
    const linked = await ensureCursorSkillsLink();
    console.log(`install-global-skills: Cursor skills at ${linked}`);
    return;
  }
  console.log(`install-global-skills: Claude Code skills at ${claudeSkillsDir()}`);
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
