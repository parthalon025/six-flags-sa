/**
 * Optional model assistance for venue research and build agents.
 *
 * Providers: openai (default) | databricks (Foundation Model / serving endpoints)
 * | agent — the builder is usually invoked BY an LLM agent, and the agent
 * provider lets that caller be the model: an unanswered prompt is filed as a
 * brief on disk, the invoking agent answers it (npm run venues:llm-briefs),
 * and the rerun consumes the answer. No API key, same guardrails — answers
 * are still claims, never coordinates, never auto-applied heights.
 *
 * Token savings: slim agentReview context, file cache (llm-cache.mjs), batched orchestrator call.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { OVERRIDE_DIR, venueSidecar } from './venue-io.mjs';

const llmResearchCacheFile = (id) => venueSidecar(id, 'llm-research-cache.json');

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_DATABRICKS_MODEL = 'databricks-meta-llama-3-1-8b-instruct';

export function llmConfig() {
  const apiKey = process.env.VENUE_LLM_API_KEY || process.env.OPENAI_API_KEY || null;
  // An interactive agent session with no API key defaults to the agent
  // provider — the caller IS the model.
  const inAgentSession = Boolean(process.env.CLAUDECODE || process.env.CURSOR_AGENT);
  const provider = (
    process.env.VENUE_LLM_PROVIDER || (!apiKey && inAgentSession ? 'agent' : 'openai')
  ).toLowerCase();
  const databricksHost = (process.env.DATBRICKS_HOST || '').replace(/\/$/, '');
  const databricksToken = process.env.DATBRICKS_TOKEN || null;
  const baseUrl = (process.env.VENUE_LLM_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/$/, '');
  const model =
    process.env.VENUE_LLM_MODEL
    || (provider === 'databricks' ? DEFAULT_DATABRICKS_MODEL
      : provider === 'agent' ? 'agent'
        : DEFAULT_OPENAI_MODEL);

  const databricksReady = Boolean(databricksHost && (databricksToken || apiKey));
  const openaiReady = Boolean(apiKey);
  const ready = provider === 'databricks' ? databricksReady
    : provider === 'agent' ? true
      : openaiReady;

  return {
    provider,
    apiKey,
    databricksHost,
    databricksToken: databricksToken || (provider === 'databricks' ? apiKey : null),
    baseUrl,
    model,
    ready,
  };
}

const BASE_RULES = `You assist with theme-park venue research for an open-source MIT map builder.
Rules you must follow:
- Never invent coordinates. Positions come only from surveyed orthophoto, traced park maps with measured error, or OpenStreetMap.
- Never invent height requirements. Cite the park's own pages or omit.
- Prefer alias suggestions over renaming bundle places.
- AGPL-licensed CV (Ultralytics YOLO) is forbidden — recommend SAM 2, orthophoto trace, or Mapillary instead.
- Output concise markdown.`;

const ROLE_PROMPTS = {
  orchestrator: 'You coordinate QA, research, GIS, vision, and validation agents. Summarize what ran, what failed, and the next 3 maintainer actions.',
  research: 'You review official-site and ParksAPI name matches. Prioritize alias fixes and imagery surveys for unmatched rides.',
  gis: 'You review path graph health. Flag disconnected networks and missing tag coverage for routing profiles.',
  vision: 'You guide orthophoto/trace workflows. Never recommend embedding AGPL YOLO.',
  validation: 'You review entrance evidence convergence. Say which rides need trace or OSM queue ways before publish.',
};

function promptHash(messages, model) {
  return createHash('sha256').update(JSON.stringify({ messages, model })).digest('hex');
}

function readFileCache(venueId, hash) {
  const file = llmResearchCacheFile(venueId);
  if (!existsSync(file)) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (doc?.promptHash === hash && doc?.llm?.review) return doc.llm.review;
  } catch {
    return null;
  }
  return null;
}

function writeFileCache(venueId, hash, content, model) {
  const file = llmResearchCacheFile(venueId);
  mkdirSync(path.dirname(file), { recursive: true });
  let prev = {};
  if (existsSync(file)) {
    try {
      prev = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      prev = {};
    }
  }
  writeFileSync(
    file,
    JSON.stringify(
      {
        ...prev,
        fetched: new Date().toISOString().slice(0, 10),
        promptHash: hash,
        model,
        llm: { review: content },
      },
      null,
      2,
    ),
  );
}

async function databricksCompletion(messages, cfg, opts = {}) {
  const host = opts.databricksHost || cfg.databricksHost;
  const token = opts.databricksToken || cfg.databricksToken;
  const model = opts.model || cfg.model;
  const url = `${host}/serving-endpoints/${model}/invocations`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages,
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1200,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Databricks LLM ${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return content ? String(content).trim() : null;
}

async function openaiCompletion(messages, cfg, opts = {}) {
  const key = opts.apiKey || cfg.apiKey;
  if (!key) return null;
  const url = `${(opts.baseUrl || cfg.baseUrl).replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: opts.model || cfg.model,
      temperature: opts.temperature ?? 0.2,
      messages,
      ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return content ? String(content).trim() : null;
}

/* ------------------------------------------------- the agent provider ---- */

const GLOBAL_BRIEFS_DIR = path.join(OVERRIDE_DIR, '..', 'llm-briefs');

export const briefsDirFor = (venueId, override) =>
  override || (venueId ? venueSidecar(venueId, 'llm-briefs') : GLOBAL_BRIEFS_DIR);

/**
 * The calling agent is the model. A cache miss files a brief and returns
 * null (callers already treat null as "no model"); the agent answers with
 * `npm run venues:llm-briefs`, and the rerun returns that answer.
 */
function agentCompletion(messages, opts = {}) {
  const dir = briefsDirFor(opts.venueId, opts.briefsDir);
  const hash = promptHash(messages, 'agent');
  const answerFile = path.join(dir, `${hash}.answer.md`);
  if (existsSync(answerFile)) {
    const content = readFileSync(answerFile, 'utf8').trim();
    if (content) return content;
  }
  const briefFile = path.join(dir, `${hash}.brief.json`);
  if (!existsSync(briefFile)) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(briefFile, `${JSON.stringify({
      version: 1,
      provider: 'agent',
      hash,
      venue: opts.venueId || null,
      expectsJson: Boolean(opts.jsonMode) || /JSON/.test(messages[0]?.content || ''),
      messages,
    }, null, 2)}\n`);
  }
  console.error(`  llm brief pending: ${briefFile}`);
  console.error('  answer it with: npm run venues:llm-briefs -- answer <hash> (then rerun this command)');
  return null;
}

/**
 * True when a null completion means "a brief is waiting for the agent",
 * not "the model replied with garbage" — callers branch on this before
 * treating null as a parse failure.
 */
export const isAgentPending = (content) => content === null && llmConfig().provider === 'agent';

/** Briefs still waiting for an answer, newest last. */
export function pendingBriefs({ venueId, briefsDir } = {}) {
  const dirs = venueId || briefsDir
    ? [briefsDirFor(venueId, briefsDir)]
    : [GLOBAL_BRIEFS_DIR, ...listVenueBriefDirs()];
  const out = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.brief.json')).sort()) {
      const brief = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
      if (existsSync(path.join(dir, `${brief.hash}.answer.md`))) continue;
      out.push({ ...brief, file: path.join(dir, f), dir });
    }
  }
  return out;
}

function listVenueBriefDirs() {
  if (!existsSync(OVERRIDE_DIR)) return [];
  return readdirSync(OVERRIDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(OVERRIDE_DIR, d.name, 'llm-briefs'))
    .filter((d) => existsSync(d));
}

/**
 * Record the agent's answer for one brief. JSON is validated when the brief
 * expects it, so a malformed answer fails here instead of downstream.
 */
export function answerBrief(hashPrefix, content, { venueId, briefsDir } = {}) {
  const briefs = pendingBriefs({ venueId, briefsDir });
  const matches = briefs.filter((b) => b.hash.startsWith(hashPrefix));
  if (!matches.length) throw new Error(`No pending brief matches "${hashPrefix}"`);
  if (matches.length > 1) throw new Error(`"${hashPrefix}" is ambiguous (${matches.length} briefs)`);
  const brief = matches[0];
  const text = String(content).trim();
  if (!text) throw new Error('Empty answer');
  if (brief.expectsJson) {
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    JSON.parse(jsonText);
  }
  const file = path.join(brief.dir, `${brief.hash}.answer.md`);
  writeFileSync(file, `${text}\n`);
  return { hash: brief.hash, file };
}

export async function chatCompletion(messages, opts = {}) {
  const cfg = llmConfig();
  const provider = opts.provider || cfg.provider;
  if (provider === 'agent') return agentCompletion(messages, opts);
  if (!cfg.ready && !opts.apiKey && !opts.databricksToken) return null;

  if (provider === 'databricks') {
    return databricksCompletion(messages, cfg, opts);
  }
  return openaiCompletion(messages, cfg, opts);
}

/** Slim agent summaries — avoid dumping full JSON (token reduction). */
export function slimAgentContext(context) {
  if (!context || typeof context !== 'object') return context;
  const out = { ...context };
  if (Array.isArray(context.agents)) {
    out.agents = context.agents.slice(0, 8).map((a) => ({
      role: a.role,
      ok: a.ok,
      error: a.error,
      summary: typeof a.summary === 'object' ? summarizeObject(a.summary) : a.summary,
      weaknesses: a.weaknesses,
    }));
  }
  if (context.summary && typeof context.summary === 'object') {
    out.summary = summarizeObject(context.summary);
  }
  if (context.official && typeof context.official === 'object') {
    out.official = {
      matched: context.official.matched,
      onlyOnSite: (context.official.onlyOnSite || []).slice(0, 8),
    };
  }
  if (context.external && typeof context.external === 'object') {
    out.external = summarizeObject(context.external);
  }
  return out;
}

function summarizeObject(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 2) return obj;
  if (Array.isArray(obj)) return obj.slice(0, 8);
  const out = {};
  for (const [k, v] of Object.entries(obj).slice(0, 12)) {
    out[k] = typeof v === 'object' && v !== null ? summarizeObject(v, depth + 1) : v;
  }
  return out;
}

export async function agentReview(role, context, opts = {}) {
  const cfg = llmConfig();
  const slim = opts.fullContext ? context : slimAgentContext(context);
  const messages = [
    { role: 'system', content: `${BASE_RULES}\n\n${ROLE_PROMPTS[role] || 'Review the builder context.'}` },
    { role: 'user', content: `Context:\n${JSON.stringify(slim)}` },
  ];

  const hash = promptHash(messages, opts.model || cfg.model);
  if (opts.venueId) {
    const cached = readFileCache(opts.venueId, hash);
    if (cached) return cached;
  }

  const content = await chatCompletion(messages, opts);
  if (content && opts.venueId) writeFileCache(opts.venueId, hash, content, opts.model || cfg.model);
  return content;
}

const RESEARCH_SYSTEM = `${BASE_RULES}
When two pools or flumes look alike on a map, say what evidence would disambiguate them.
Output sections: Summary, Official site gaps, Name pairings, Sourcing priorities, Open questions.`;

/**
 * Ask a model to review a structured research packet (summary fields only when slim).
 */
export async function reviewResearch(packet, opts = {}) {
  const slim = opts.fullPacket ? packet : summarizeObject(packet);
  return chatCompletion(
    [
      { role: 'system', content: RESEARCH_SYSTEM },
      { role: 'user', content: JSON.stringify(slim) },
    ],
    opts,
  );
}

/**
 * Single batched call for build-agent --ai (replaces per-agent LLM when not verbose).
 */
export async function orchestratorBatchReview(venueId, agents, errors, opts = {}) {
  return agentReview(
    'orchestrator',
    { venueId, agents, errors: (errors || []).slice(0, 5) },
    { ...opts, venueId },
  );
}
