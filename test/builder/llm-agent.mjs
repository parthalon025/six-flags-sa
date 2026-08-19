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

await check('research callers report a pending brief, not a parse failure', async () => {
  setEnv({ VENUE_LLM_PROVIDER: 'agent' });
  const briefsDir = mkdtempSync(path.join(tmpdir(), 'briefs-'));
  const { llmExtractOfficialResearch } = await import('../../packages/venue-builder/lib/open-research.mjs');
  const { llmSearchParkMaps } = await import('../../packages/venue-builder/lib/park-map-research.mjs');
  const extract = await llmExtractOfficialResearch({
    official: { attractions: [] },
    pois: [],
    opts: { briefsDir },
  });
  assert.equal(extract.reason, 'llm_brief_pending');
  assert.equal(extract.skipped, true);
  assert.ok(!extract.error, 'a pending brief is not an error');
  const search = await llmSearchParkMaps({ venueId: 'test-park', opts: { briefsDir } });
  assert.equal(search.reason, 'llm_brief_pending');
  assert.equal(search.pending, true);
  assert.equal(search.required, true);
  assert.ok(!search.error, 'a pending brief is not an error');

  // Through the merge: a pending brief must never report a completed search.
  const { mergeParkMapResearch } = await import('../../packages/venue-builder/lib/park-map-research.mjs');
  const { mergeOpenResearch } = await import('../../packages/venue-builder/lib/open-research.mjs');
  const merged = mergeParkMapResearch({ parkMaps: [], followUpUrls: [], notes: [] }, search);
  assert.ok(!merged.notes.some((n) => /completed/.test(n)), 'pending must not read as completed');
  assert.equal(merged.llmParkMapSearch.skipped, true);
  const open = mergeOpenResearch(
    { fetched: '2026-08-18', aliases: [], heightCandidates: [], inventoryGaps: [], notes: [] },
    extract,
    merged,
  );
  assert.equal(open.mode, 'official', 'a pending brief must not claim official+llm');
  assert.ok(!open.sources.includes('llm_park_map_search'), 'pending search is not a source');
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

console.log('\nkit briefs\n');

const { kitBriefSystem, parseKitAnswer, assetMenu } = await import(
  '../../packages/venue-builder/lib/display-kit-brief.mjs'
);
const { readAssetLedger } = await import('../../packages/venue-builder/lib/display-assets.mjs');

await check('the kit brief advertises exactly the license-gated asset menu', () => {
  const ledger = readAssetLedger();
  const system = kitBriefSystem(ledger);
  const menu = assetMenu(ledger);
  assert.ok(menu.sheets.length >= 3 && menu.icons.length >= 6, 'the real ledger rides the menu');
  for (const id of [...menu.sprites, ...menu.icons]) {
    assert.ok(system.includes(id), `menu id "${id}" missing from the system prompt`);
  }
  assert.ok(!system.includes('stolen'), 'nothing outside the ledger is offered');
  return true;
});

await check('a brief answer with ledger GUIDs becomes a saveable kit spec', () => {
  const ledger = readAssetLedger();
  const spec = parseKitAnswer(`\`\`\`json
{"id": "Neon Night", "terrain": {"grass": {"tiles": {"asset": "kenney-roguelike-sheet", "tile": "grass"}}},
 "sprites": {"tree": {"sprite": {"asset": "parkbound-palm-tree"}},
             "badge": {"icons": {"gate": {"asset": "parkbound-badge-gate"}}}}}
\`\`\``, { assets: ledger, prompt: 'neon night' });
  assert.equal(spec.id, 'neon-night', 'id slugified');
  assert.equal(spec.prompt, 'neon night', 'provenance recorded');
  return true;
});

await check('answers referencing art outside the ledger never become kits', () => {
  const ledger = readAssetLedger();
  const cases = [
    [{ id: 'x', terrain: { grass: { tiles: { asset: 'ripped-tileset', tile: 'grass' } } } }, /unknown asset/],
    [{ id: 'x', sprites: { tree: { sprite: { asset: 'kenney-roguelike-sheet' } } } }, /not a sprite/],
    [{ id: 'x', sprites: { badge: { icons: { gate: { asset: 'parkbound-palm-tree' } } } } }, /not an icon/],
    [{ id: 'x', sprites: { building: { style: 'hologram' } } }, /Unknown building style/],
    [{ terrain: {} }, /needs an id/],
  ];
  for (const [spec, rx] of cases) {
    assert.throws(() => parseKitAnswer(JSON.stringify(spec), { assets: ledger }), rx);
  }
  return true;
});

await check('iso-tier art never rides a flat kit brief', () => {
  const ledger = readAssetLedger();
  assert.ok(ledger['parkbound-palm-tree-iso'], 'the iso variant is in the ledger');
  const system = kitBriefSystem(ledger);
  assert.ok(!system.includes('parkbound-palm-tree-iso'), 'the menu never advertises iso art');
  assert.ok(system.includes('parkbound-palm-tree'), 'the flat sibling still rides the menu');
  assert.throws(
    () => parseKitAnswer(
      '{"id": "x", "sprites": {"tree": {"sprite": {"asset": "parkbound-palm-tree-iso"}}}}',
      { assets: ledger },
    ),
    /unknown asset/,
  );
  return true;
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exitCode = 1;
}
