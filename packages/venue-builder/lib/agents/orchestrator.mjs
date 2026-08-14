/**
 * Universal Venue Builder — multi-agent orchestrator.
 */

import { runQaAgent } from './qa.mjs';
import { runResearchAgent } from './research.mjs';
import { runGisAgent } from './gis.mjs';
import { runValidationAgent } from './validation.mjs';
import { runVisionAgent } from './vision.mjs';
import { agentReview, llmConfig, orchestratorBatchReview } from '../venue-llm.mjs';

const VERBOSE_LLM = process.env.VENUE_LLM_VERBOSE === '1';

/**
 * @param {string} venueId
 * @param {object} opts
 */
export async function runBuildOrchestrator(venueId, opts = {}) {
  const started = new Date().toISOString();
  const agents = [];
  const errors = [];

  const run = async (name, fn) => {
    try {
      const result = await fn();
      agents.push(result);
      return result;
    } catch (err) {
      const row = { role: name, ok: false, error: err.message };
      agents.push(row);
      errors.push(row);
      return row;
    }
  };

  if (!opts.skip?.includes('qa')) {
    await run('qa', () => runQaAgent(venueId, opts));
  }
  if (!opts.skip?.includes('research')) {
    await run('research', () => runResearchAgent(venueId, { ...opts, ai: VERBOSE_LLM && opts.ai }));
  }
  if (!opts.skip?.includes('gis')) {
    await run('gis', () => runGisAgent(venueId, { ...opts, ai: VERBOSE_LLM && opts.ai }));
  }
  if (!opts.skip?.includes('vision')) {
    await run('vision', () => runVisionAgent(venueId, opts));
  }
  if (!opts.skip?.includes('validation')) {
    await run('validation', () => runValidationAgent(venueId, { ...opts, ai: VERBOSE_LLM && opts.ai }));
  }

  let orchestratorLlm = null;
  if (opts.ai && llmConfig().ready) {
    if (VERBOSE_LLM) {
      for (const agent of agents) {
        if (!agent.ok || agent.llm) continue;
        agent.llm = await agentReview(agent.role, agent, { venueId });
      }
      orchestratorLlm = await agentReview('orchestrator', {
        venueId,
        agents: agents.map((a) => ({
          role: a.role,
          ok: a.ok,
          summary: a.summary || a.evidence || a.routing || a.weaknesses,
          error: a.error,
        })),
        errors,
      }, { venueId });
    } else {
      orchestratorLlm = await orchestratorBatchReview(venueId, agents, errors, opts);
    }
  }

  return {
    venueId,
    started,
    finished: new Date().toISOString(),
    agents,
    errors,
    llm: orchestratorLlm,
    llmReady: llmConfig().ready,
    llmMode: VERBOSE_LLM ? 'verbose' : 'batch',
  };
}

export function renderOrchestratorMarkdown(trace) {
  const lines = [
    `# Build agent run — ${trace.venueId}`,
    '',
    `Started: ${trace.started}`,
    `Finished: ${trace.finished}`,
    trace.llmMode ? `LLM mode: ${trace.llmMode}` : '',
    '',
  ];
  for (const a of trace.agents) {
    lines.push(`## ${a.role}`, '');
    if (!a.ok) {
      lines.push(`Error: ${a.error}`, '');
      continue;
    }
    if (a.summary) lines.push(`Summary: ${JSON.stringify(a.summary)}`, '');
    if (a.routing) lines.push(`Routing: ${JSON.stringify(a.routing)}`, '');
    if (a.evidence) lines.push(`Evidence: ${JSON.stringify(a.evidence)}`, '');
    if (a.weaknesses != null) lines.push(`Weaknesses: ${a.weaknesses}`, '');
    if (a.published) lines.push(`Published entrance fields: ${a.published}`, '');
    if (a.reviewHtml) lines.push(`Review map: \`${a.reviewHtml}\``, '');
    if (a.llm) lines.push('', a.llm, '');
    lines.push('');
  }
  if (trace.llm) {
    lines.push('## Orchestrator review', '', trace.llm, '');
  }
  return lines.join('\n');
}
