#!/usr/bin/env node
/**
 * The agent LLM provider — the caller is the model. A cache miss files a
 * brief, the agent answers it, the rerun consumes the answer; guardrails
 * (JSON validation, null-tolerant callers) hold throughout.
 *
 *   node test/builder/llm-agent.mjs
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PASS = [];
const FAIL = [];

async function check(name, fn) {
  try {
    const r = await fn();
    if (r === false) throw new Error('assertion false');
    PASS.push(name);
    console.log('  PASS', name);
  } catch (e) {
    FAIL.push(`${name} :: ${e.message.split('\n')[0]}`);
    console.log('  FAIL', name, '->', e.message.split('\n')[0]);
  }
}

console.log('\nagent llm provider\n');

const { llmConfig, chatCompletion, pendingBriefs, answerBrief } = await import(
  '../../packages/venue-builder/lib/venue-llm.mjs'
);

const ENV_KEYS = ['VENUE_LLM_PROVIDER', 'VENUE_LLM_API_KEY', 'OPENAI_API_KEY', 'CLAUDECODE', 'CURSOR_AGENT'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
function setEnv(env) {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}
function restoreEnv() {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

await check('an agent session with no API key defaults to the agent provider', () => {
  setEnv({ CLAUDECODE: '1' });
  const cfg = llmConfig();
  assert.equal(cfg.provider, 'agent');
  assert.equal(cfg.ready, true);
  return true;
});

await check('an API key keeps the openai default even inside an agent session', () => {
  setEnv({ CLAUDECODE: '1', OPENAI_API_KEY: 'sk-test' });
  assert.equal(llmConfig().provider, 'openai');
  setEnv({});
  assert.equal(llmConfig().provider, 'openai');
  assert.equal(llmConfig().ready, false);
  return true;
});

const MESSAGES = [
  { role: 'system', content: 'Reply with JSON: {"aliases": []}' },
  { role: 'user', content: 'Pair the names.' },
];

await check('a cache miss files one brief and returns null', async () => {
  setEnv({ VENUE_LLM_PROVIDER: 'agent' });
  const briefsDir = mkdtempSync(path.join(tmpdir(), 'briefs-'));
  const first = await chatCompletion(MESSAGES, { briefsDir });
  assert.equal(first, null);
  const again = await chatCompletion(MESSAGES, { briefsDir });
  assert.equal(again, null);
  assert.equal(readdirSync(briefsDir).length, 1, 'a rerun must not file a duplicate brief');
  const [brief] = pendingBriefs({ briefsDir });
  assert.equal(brief.expectsJson, true);
  assert.deepEqual(brief.messages, MESSAGES);
  return true;
});

await check('the answered brief is returned on rerun; JSON is validated', async () => {
  setEnv({ VENUE_LLM_PROVIDER: 'agent' });
  const briefsDir = mkdtempSync(path.join(tmpdir(), 'briefs-'));
  await chatCompletion(MESSAGES, { briefsDir });
  const [brief] = pendingBriefs({ briefsDir });

  assert.throws(() => answerBrief(brief.hash, 'not json', { briefsDir }), /JSON|Unexpected/);
  answerBrief(brief.hash.slice(0, 12), '{"aliases": [{"official": "Orion"}]}', { briefsDir });

  const answered = await chatCompletion(MESSAGES, { briefsDir });
  assert.equal(JSON.parse(answered).aliases[0].official, 'Orion');
  assert.equal(pendingBriefs({ briefsDir }).length, 0, 'answered brief still pending');
  return true;
});

await check('a different prompt files a different brief', async () => {
  setEnv({ VENUE_LLM_PROVIDER: 'agent' });
  const briefsDir = mkdtempSync(path.join(tmpdir(), 'briefs-'));
  await chatCompletion(MESSAGES, { briefsDir });
  await chatCompletion([{ role: 'user', content: 'other prompt' }], { briefsDir });
  assert.equal(pendingBriefs({ briefsDir }).length, 2);
  return true;
});

restoreEnv();

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
