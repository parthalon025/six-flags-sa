/**
 * GIS agent — path graph QA and tile layer export for Tippecanoe.
 */

import { runAdapter } from '../adapters/runner.mjs';
import { runQaAgent } from './qa.mjs';
import { agentReview } from '../venue-llm.mjs';

export async function runGisAgent(venueId, opts = {}) {
  const qa = await runQaAgent(venueId, { offline: true });
  const adapterRuns = [];

  if (opts.tiles) {
    adapterRuns.push(await runAdapter('tippecanoe', { venueId }));
  }

  let llm = null;
  if (opts.ai) {
    llm = await agentReview('gis', {
      routing: qa.routing,
      weaknesses: qa.audit?.weaknesses?.filter((w) => /path|osm|tag/i.test(w.key)).slice(0, 6),
    });
  }

  return {
    role: 'gis',
    ok: true,
    routing: qa.routing,
    adapterRuns,
    llm,
  };
}
