/**
 * Vision agent — license-safe vision pipeline (no AGPL embeds).
 *
 * Wave 5: when trace/imagery datasets exist in sources.json, record proposals
 * via the evidence graph. SAM 2 / OpenSfM remain deferred external workers;
 * mapillary-tools ground ingest runs when a walkthrough-frame cache exists (#408).
 */

import { runAdapter } from '../adapters/runner.mjs';
import { agentReview } from '../venue-llm.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { enqueueVisionTraceClaims } from '../vision-trace-claims.mjs';
import {
  enqueueVisionMapillaryClaims,
  resolveMapillaryToolsStatus,
} from '../vision-mapillary-claims.mjs';

export async function runVisionAgent(venueId, opts = {}) {
  const yolo = getAdapter('ultralytics-yolo');
  const adapterRuns = [await runAdapter('evidence-graph', { venueId })];

  const persisted = enqueueVisionTraceClaims(venueId, {
    dryRun: opts.dryRun,
  });
  const traceProposals = persisted.traceProposals || [];

  const mapillaryPersisted = enqueueVisionMapillaryClaims(venueId, {
    dryRun: opts.dryRun,
    map: opts.map,
    pois: opts.pois,
  });
  const mapillaryProposals = mapillaryPersisted.mapillaryProposals || [];
  const { deferred, availableUnused } = resolveMapillaryToolsStatus({
    applied: mapillaryPersisted.applied,
  });

  let llm = null;
  if (opts.ai) {
    llm = await agentReview('vision', {
      policy: 'AGPL detectors rejected; use SAM 2 worker or traced orthophoto',
      yoloStatus: yolo?.adopt,
      evidence: adapterRuns[0]?.meta,
      traceProposals,
      mapillaryProposals,
      suggested: ['trace park map', 'orthophoto survey GeoJSON', 'Mapillary sequences'],
    });
  }

  return {
    role: 'vision',
    ok: true,
    adapterRuns,
    traceProposals,
    persisted,
    mapillaryGround: {
      frameCount: mapillaryPersisted.frameCount,
      applied: mapillaryPersisted.applied,
      snappedCount: mapillaryProposals[0]?.snappedCount ?? 0,
      skipped: mapillaryPersisted.skipped,
    },
    mapillaryProposals,
    mapillaryPersisted,
    llm,
    deferred,
    availableUnused,
  };
}
