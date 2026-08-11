/**
 * Validation agent — evidence graph, HTML review map, attractions refresh.
 */

import path from 'node:path';
import { OVERRIDE_DIR, venueSidecar } from '../venue-io.mjs';
import { runAdapter } from '../adapters/runner.mjs';
import { trim, SCHEMA_VERSION } from '../attractions.mjs';
import { inventory, publish, listFile, writeSettled } from '../../bin/attractions.mjs';
import { PUBLISH_AT } from '../evidence.mjs';
import { agentReview } from '../venue-llm.mjs';

export async function runValidationAgent(venueId, opts = {}) {
  const adapterRuns = [
    await runAdapter('evidence-graph', { venueId }),
    await runAdapter('evidence-html', {
      venueId,
      htmlPath: venueSidecar(venueId, 'evidence.html'),
    }),
  ];

  let published = 0;
  if (opts.apply) {
    const state = inventory(venueId, {});
    const list = {
      version: SCHEMA_VERSION,
      venue: venueId,
      generated: state.asOf,
      publish_at: PUBLISH_AT,
      attractions: state.records.map(trim),
    };
    writeSettled(listFile(venueId), list);
    published = publish(venueId, state.pois, state.records, PUBLISH_AT);
  }

  const graphMeta = adapterRuns.find((r) => r.adapterId === 'evidence-graph')?.meta || {};

  let llm = null;
  if (opts.ai) {
    llm = await agentReview('validation', {
      evidence: graphMeta,
      published,
      reviewHtml: venueSidecar(venueId, 'evidence.html'),
    });
  }

  return {
    role: 'validation',
    ok: true,
    evidence: graphMeta,
    published,
    adapterRuns,
    llm,
    reviewHtml: venueSidecar(venueId, 'evidence.html'),
  };
}
