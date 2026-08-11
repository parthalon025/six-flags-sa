/**
 * Vision agent — license-safe vision pipeline (no AGPL embeds).
 *
 * Wave 5: when trace/imagery datasets exist in sources.json, record proposals
 * via the evidence graph. SAM 2 / Mapillary remain deferred external workers.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { runAdapter } from '../adapters/runner.mjs';
import { agentReview } from '../venue-llm.mjs';
import { getAdapter } from '../adapters/index.mjs';
import { readSources } from '../venue-sources.mjs';
import { OVERRIDE_DIR, readJson } from '../venue-io.mjs';

export async function runVisionAgent(venueId, opts = {}) {
  const yolo = getAdapter('ultralytics-yolo');
  const adapterRuns = [await runAdapter('evidence-graph', { venueId })];

  const { data: catalog } = readSources(venueId);
  const traceDatasets = catalog?.datasets?.trace || [];
  const imageryDatasets = catalog?.datasets?.imagery || [];
  const traceProposals = [];

  for (const ds of traceDatasets) {
    const file = path.isAbsolute(ds.path) ? ds.path : path.join(OVERRIDE_DIR, path.basename(ds.path));
    if (existsSync(file)) {
      traceProposals.push({
        source: 'traced',
        file: ds.path,
        featureCount: (readJson(file)?.features || []).length,
        note: 'Traced orthophoto — proposals only until human review',
      });
    }
  }

  for (const ds of imageryDatasets) {
    const file = path.isAbsolute(ds.path) ? ds.path : path.join(OVERRIDE_DIR, path.basename(ds.path));
    if (existsSync(file)) {
      traceProposals.push({
        source: 'imagery',
        file: ds.path,
        featureCount: (readJson(file)?.features || []).length,
        note: 'Hand-surveyed imagery — proposals only until human review',
      });
    }
  }

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
    llm,
    deferred: ['sam2', 'mapillary-tools', 'opensfm'],
  };
}
