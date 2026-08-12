#!/usr/bin/env node
/**
 * Verify `.agents/skills/*` match `skills-lock.json` (skills CLI folder hash).
 * Prevents hand-edit drift from Matt Pocock's pinned skill install.
 *
 * Hashes are computed over LF-normalized file bytes so Windows (CRLF working
 * trees) and Linux CI agree. `skills-lock.json` must store those LF hashes.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LOCK_PATH = join(ROOT, 'skills-lock.json');
const SKILLS_DIR = join(ROOT, '.agents', 'skills');
const EXPECTED_SOURCE = 'mattpocock/skills';

const rewrite = process.argv.includes('--write-lock');

function toLfBuffer(buf) {
  const text = buf.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return Buffer.from(text, 'utf8');
}

async function collectFiles(baseDir, currentDir, results) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const raw = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split('\\').join('/');
        results.push({ relativePath, content: toLfBuffer(raw) });
      }
    }),
  );
}

async function computeSkillFolderHash(skillDir) {
  const files = [];
  await collectFiles(skillDir, skillDir, files);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update(file.content);
  }
  return hash.digest('hex');
}

function fail(message) {
  console.error(`skills-lock check failed: ${message}`);
  process.exitCode = 1;
}

async function main() {
  const lockRaw = await readFile(LOCK_PATH, 'utf8');
  const lock = JSON.parse(lockRaw);
  const locked = lock.skills ?? {};
  const lockedNames = Object.keys(locked).sort();

  if (lockedNames.length === 0) {
    fail('skills-lock.json has no skills');
    return;
  }

  let dirs;
  try {
    dirs = (await readdir(SKILLS_DIR, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch (err) {
    fail(`.agents/skills missing (${err.message})`);
    return;
  }

  const lockedSet = new Set(lockedNames);
  const dirSet = new Set(dirs);

  for (const name of lockedNames) {
    if (!dirSet.has(name)) fail(`missing skill folder: .agents/skills/${name}`);
  }
  for (const name of dirs) {
    if (!lockedSet.has(name)) fail(`unexpected skill folder not in lock: ${name}`);
  }

  let rewritten = 0;
  for (const name of lockedNames) {
    const entry = locked[name];
    if (entry.source !== EXPECTED_SOURCE) {
      fail(`${name}: source is "${entry.source}", expected "${EXPECTED_SOURCE}"`);
    }
    const skillDir = join(SKILLS_DIR, name);
    const actual = await computeSkillFolderHash(skillDir);
    if (rewrite) {
      if (entry.computedHash !== actual) {
        entry.computedHash = actual;
        rewritten += 1;
      }
      continue;
    }
    if (actual !== entry.computedHash) {
      fail(
        `${name}: hash drift (lock ${entry.computedHash.slice(0, 12)}…, disk ${actual.slice(0, 12)}…). ` +
          `Do not hand-edit; run: npm run skills:update`,
      );
    }
  }

  if (rewrite) {
    const body = `${JSON.stringify(lock, null, 2)}\n`;
    await writeFile(LOCK_PATH, body, 'utf8');
    console.log(`skills-lock rewritten: ${rewritten} hash(es) updated (LF-normalized)`);
    return;
  }

  if (process.exitCode) return;
  console.log(`skills-lock ok: ${lockedNames.length} skills match ${EXPECTED_SOURCE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
