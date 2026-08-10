/**
 * Vision agent — license-safe vision pipeline (no AGPL embeds).
 *
 * SAM 2 and Mapillary are deferred to external GPU workers; this agent records
 * evidence-graph state and LLM guidance for human + orthophoto workflows.
 */

import { runAdapter } from '../adapters/runner.mjs';
import { agentReview } from '../venue-llm.mjs';
import { getAdapter } from '../adapters/index.mjs';

export async function runVisionAgent(venueId, opts = {}) {
  const yolo = getAdapter('ultralytics-yolo');
  const adapterRuns = [await runAdapter('evidence-graph', { venueId })];

  let llm = null;
  if (opts.ai) {
    llm = await agentReview('vision', {
      policy: 'AGPL detectors rejected; use SAM 2 worker or traced orthophoto',
      yoloStatus: yolo?.adopt,
      evidence: adapterRuns[0]?.meta,
      suggested: ['trace park map', 'orthophoto survey GeoJSON', 'Mapillary sequences'],
    });
  }

  return {
    role: 'vision',
    ok: true,
    adapterRuns,
    llm,
    deferred: ['sam2', 'mapillary-tools', 'opensfm'],
  };
}
