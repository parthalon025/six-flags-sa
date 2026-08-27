/**
 * Vision agent — license-safe vision pipeline (no AGPL embeds).
 *
 * Wave 5: when trace/imagery datasets exist in sources.json, record proposals
 * via the evidence graph. SAM 2 / Mapillary remain deferred external workers.
 */

import { runAdapter } from '../adapters/runner.mjs';
import { agentReview } from '../venue-llm.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { enqueueVisionTraceClaims } from '../vision-trace-claims.mjs';

export async function runVisionAgent(venueId, opts = {}) {
  const yolo = getAdapter('ultralytics-yolo');
  const adapterRuns = [await runAdapter('evidence-graph', { venueId })];

  const persisted = enqueueVisionTraceClaims(venueId, {
    dryRun: opts.dryRun,
  });
  const traceProposals = persisted.traceProposals || [];

  let llm = null;
  if (opts.ai) {
    llm = await agentReview('vision', {
      policy: 'AGPL detectors rejected; use SAM 2 worker or traced orthophoto',
      yoloStatus: yolo?.adopt,
      evidence: adapterRuns[0]?.meta,
      traceProposals,
      suggested: ['trace park map', 'orthophoto survey GeoJSON', 'Mapillary sequences'],
    });
  }

  return {
    role: 'vision',
    ok: true,
    adapterRuns,
    traceProposals,
    persisted,
    llm,
    deferred: ['sam2', 'mapillary-tools', 'opensfm'],
  };
}
