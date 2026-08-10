/**
 * Optional model assistance for venue research.
 *
 * Deliberately not in the build hot path. Uses fetch against any
 * OpenAI-compatible chat API — no SDK dependency.
 *
 * Configure with environment variables:
 *   VENUE_LLM_API_KEY   required to call
 *   VENUE_LLM_BASE_URL  default https://api.openai.com/v1
 *   VENUE_LLM_MODEL     default gpt-4o-mini
 */

const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function llmConfig() {
  const apiKey = process.env.VENUE_LLM_API_KEY || process.env.OPENAI_API_KEY || null;
  const baseUrl = (process.env.VENUE_LLM_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const model = process.env.VENUE_LLM_MODEL || DEFAULT_MODEL;
  return { apiKey, baseUrl, model, ready: Boolean(apiKey) };
}

const SYSTEM = `You assist with theme-park venue research for an open-source map builder.
Rules you must follow:
- Never invent coordinates. Positions come only from surveyed orthophoto, traced park maps with measured error, or OpenStreetMap.
- Never invent height requirements. Cite the park's own pages or omit.
- Prefer alias suggestions over renaming bundle places.
- When two pools or flumes look alike on a map, say what evidence would disambiguate them (labels, queue signs, orthophoto shape).
- Treat official-site data in the packet as the park's own website — prefer it over fan wikis for heights and names.
- Output concise markdown with sections: Summary, Official site gaps, Name pairings, Sourcing priorities, Open questions.`;

/**
 * Ask a model to review a structured research packet.
 *
 * @returns {string|null} markdown commentary, or null when no API key
 */
export async function reviewResearch(packet, { apiKey, baseUrl, model } = {}) {
  const cfg = llmConfig();
  const key = apiKey || cfg.apiKey;
  if (!key) return null;

  const url = `${(baseUrl || cfg.baseUrl).replace(/\/$/, '')}/chat/completions`;
  const body = {
    model: model || cfg.model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Review this venue research packet and help a human decide what to do next.\n\n\`\`\`json\n${JSON.stringify(packet, null, 2)}\n\`\`\``,
      },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${text.slice(0, 240) || res.statusText}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return content ? String(content).trim() : null;
}
