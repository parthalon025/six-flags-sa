#!/usr/bin/env node
/**
 * Agent-handoff watch CLI — backs .github/workflows/agent-handoff-watch.yml.
 * Thin over scripts/lib/agent-handoff-watch.mjs.
 *
 *   node scripts/ci/agent-handoff-watch.mjs check-trigger
 *   node scripts/ci/agent-handoff-watch.mjs gh -- <gh args...>
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertScopedGhArgs, shouldTriage } from '../lib/agent-handoff-watch.mjs';

function emitGithubOutput(key, value) {
  const line = `${key}=${value}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  else console.log(line.trim());
}

function runCheckTrigger() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    console.error('agent-handoff-watch: GITHUB_EVENT_PATH not set');
    process.exit(1);
  }
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  emitGithubOutput('should_triage', String(shouldTriage(event)));
}

function runGh(argv) {
  const sepIndex = argv.indexOf('--');
  const ghArgs = sepIndex === -1 ? argv : argv.slice(sepIndex + 1);
  const issueNumber = process.env.HANDOFF_ISSUE_NUMBER;
  if (!issueNumber) {
    console.error('agent-handoff-gh: HANDOFF_ISSUE_NUMBER not set');
    process.exit(1);
  }
  try {
    assertScopedGhArgs(ghArgs, issueNumber);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const result = spawnSync('gh', ghArgs, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

const [, , command, ...rest] = process.argv;
if (command === 'check-trigger') runCheckTrigger();
else if (command === 'gh') runGh(rest);
else {
  console.error('Usage: agent-handoff-watch.mjs <check-trigger|gh -- ...>');
  process.exit(1);
}
