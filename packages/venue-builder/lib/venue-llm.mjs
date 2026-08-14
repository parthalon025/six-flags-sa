/**
 * Optional model assistance for venue research and build agents.
 *
 * Providers: openai (default) | databricks (Foundation Model / serving endpoints).
 * Token savings: slim agentReview context, file cache (llm-cache.mjs), batched orchestrator call.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { venueSidecar } from './venue-io.mjs';

const llmResearchCacheFile = (id) => venueSidecar(id, 'llm-research-cache.json');

const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_DATABRICKS_MODEL = 'databricks-meta-llama-3-1-8b-instruct';

export function llmConfig() {
  const provider = (process.env.VENUE_LLM_PROVIDER || 'openai').toLowerCase();
  const databricksHost = (process.env.DATBRICKS_HOST || '').replace(/\/$/, '');
  const databricksToken = process.env.DATBRICKS_TOKEN || null;
  const apiKey = process.env.VENUE_LLM_API_KEY || process.env.OPENAI_API_KEY || null;
  const baseUrl = (process.env.VENUE_LLM_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/$/, '');
  const model =
    process.env.VENUE_LLM_MODEL
    || (provider === 'databricks' ? DEFAULT_DATABRICKS_MODEL : DEFAULT_OPENAI_MODEL);

  const databricksReady = Boolean(databricksHost && (databricksToken || apiKey));
  const openaiReady = Boolean(apiKey);
  const ready = provider === 'databricks' ? databricksReady : openaiReady;

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

export async function chatCompletion(messages, opts = {}) {
  const cfg = llmConfig();
  if (!cfg.ready && !opts.apiKey && !opts.databricksToken) return null;

  if ((opts.provider || cfg.provider) === 'databricks') {
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
