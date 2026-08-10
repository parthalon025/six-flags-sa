/**
 * Optional model assistance for venue research and build agents.
 *
 * OpenAI-compatible chat API — no SDK dependency.
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function llmConfig() {
  const apiKey = process.env.VENUE_LLM_API_KEY || process.env.OPENAI_API_KEY || null;
  const baseUrl = (process.env.VENUE_LLM_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const model = process.env.VENUE_LLM_MODEL || DEFAULT_MODEL;
  return { apiKey, baseUrl, model, ready: Boolean(apiKey) };
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

export async function chatCompletion(messages, opts = {}) {
  const cfg = llmConfig();
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

export async function agentReview(role, context, opts = {}) {
  const roleLine = ROLE_PROMPTS[role] || 'Review the builder context.';
  return chatCompletion(
    [
      { role: 'system', content: `${BASE_RULES}\n\n${roleLine}` },
      {
        role: 'user',
        content: `Context:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``,
      },
    ],
    opts,
  );
}

const RESEARCH_SYSTEM = `${BASE_RULES}
When two pools or flumes look alike on a map, say what evidence would disambiguate them.
Output sections: Summary, Official site gaps, Name pairings, Sourcing priorities, Open questions.`;

/**
 * Ask a model to review a structured research packet.
 */
export async function reviewResearch(packet, opts = {}) {
  return chatCompletion(
    [
      { role: 'system', content: RESEARCH_SYSTEM },
      {
        role: 'user',
        content: `Review this venue research packet.\n\n\`\`\`json\n${JSON.stringify(packet, null, 2)}\n\`\`\``,
      },
    ],
    opts,
  );
}
