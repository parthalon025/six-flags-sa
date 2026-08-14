#!/usr/bin/env node
/**
 * Classify whether a commit is GitNexus index noise (skip expensive CI)
 * or contains anything else (run CI).
 *
 *   node scripts/gitnexus-ci.mjs
 *
 * On GitHub Actions, writes `run=true|false` to GITHUB_OUTPUT.
 * Exit 0 always — a GitNexus-only commit is a successful skip, not a failure.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Paths GitNexus analyze may dirty. Never commit `.gitnexus/` — it is gitignored. */
export const GITNEXUS_INDEX_PATHS = ['.gitnexus/', 'AGENTS.md', 'CLAUDE.md'];

/** Commit subject previously used when the index was committed on main. */
export const GITNEXUS_REFRESH_MESSAGE = 'chore: refresh gitnexus index';

/** Author the post-merge workflow sets before `bump-version` / gitnexus commits. */
export const GITNEXUS_BOT_AUTHOR = 'github-actions[bot]';

/**
 * Fold a GitNexus refresh into an unpushed version-bump commit (legacy).
 * The index is gitignored now; kept so old CI callers and tests stay honest.
 */
export function shouldAmendGitnexusIntoBump({ subject, author } = {}) {
  return (
    String(subject || '').startsWith('chore: bump version to') &&
    String(author || '') === GITNEXUS_BOT_AUTHOR
  );
}

export function isGitnexusCiNoise(file) {
  const norm = String(file || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
  if (norm === 'AGENTS.md' || norm === 'CLAUDE.md') return true;
  if (norm === '.gitnexus' || norm.startsWith('.gitnexus/')) return true;
  return false;
}

/** True only when every path is GitNexus index output. Empty → false (fail open). */
export function isGitnexusOnlyChange(files) {
  if (!files?.length) return false;
  return files.every(isGitnexusCiNoise);
}

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function filesFromGit(sha) {
  try {
    const out = git(['diff', '--name-only', `${sha}^1`, sha]);
    return out ? out.split(/\r?\n/).filter(Boolean) : [];
  } catch {
    try {
      const out = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha]);
      return out ? out.split(/\r?\n/).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

async function filesFromGithubApi(sha) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!repo || !sha) return null;
  const headers = { 'User-Agent': 'six-flags-sa-gitnexus-ci' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  const files = (data.files || []).map((f) => f.filename).filter(Boolean);
  // GitHub truncates at 300 files — fail open so we never skip a mixed commit.
  if ((data.files || []).length >= 300) return [];
  return files;
}

function filesFromArgs(argv) {
  const idx = argv.indexOf('--files');
  if (idx === -1) return null;
  return argv.slice(idx + 1).filter((a) => a && !a.startsWith('-'));
}

function resolveSha() {
  const eventName = process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventName === 'pull_request' && eventPath) {
    try {
      const payload = JSON.parse(readFileSync(eventPath, 'utf8'));
      const head = payload?.pull_request?.head?.sha;
      if (head) return head;
    } catch {
      // fall through
    }
  }
  return process.env.GITHUB_SHA || 'HEAD';
}

function emit(run) {
  const line = `run=${run ? 'true' : 'false'}\n`;
  if (run) {
    console.log('App-related changes detected — CI will run.');
  } else {
    console.log('GitNexus-only changes — skipping expensive CI.');
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line);
  }
}

export async function classifyCommit(sha = resolveSha(), argv = process.argv.slice(2)) {
  const fromArgs = filesFromArgs(argv);
  const files = fromArgs ?? (await filesFromGithubApi(sha)) ?? filesFromGit(sha);
  const skip = isGitnexusOnlyChange(files);
  return { files, run: !skip };
}

const invoked =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invoked) {
  const { files, run } = await classifyCommit();
  if (files.length) {
    console.log(`Changed files (${files.length}):`);
    for (const f of files.slice(0, 30)) console.log(`  ${f}`);
    if (files.length > 30) console.log(`  … and ${files.length - 30} more`);
  } else {
    console.log('Could not list changed files — failing open (run CI).');
  }
  emit(run);
}
