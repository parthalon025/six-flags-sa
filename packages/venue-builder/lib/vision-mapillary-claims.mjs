/**
 * Vision agent — ingest mapillary-tools walkthrough-frame cache as evidence.
 *
 * Issue #408: when mapillary-video-cache.json holds geotagged frames, the
 * vision agent records them as pending entrance corroboration (same steward
 * review path as traced orthophoto claims in #421).
 */

import { normaliseRideName } from '@party-tracker/shared/mapSymbols.js';
import {
  addEvidence,
  SCHEMA_VERSION,
  trim,
} from './attractions.mjs';
import { mapillaryVideoClaimBatch } from './external-claims.mjs';
import { PUBLISH_AT } from './evidence.mjs';
import { readJson, venueSidecar } from './venue-io.mjs';
import { REVIEW_FILE } from './venue-review.mjs';
import { applyReviewDecisionsToRecords } from './vision-trace-claims.mjs';
import { convergenceReport, graphFromSidecar } from './evidence-graph.mjs';
import { VENUE_DIR } from './venue-fs.mjs';
import path from 'node:path';
import {
  inventory,
  listFile,
  writeSettled,
  today,
} from '../bin/attractions.mjs';

const MAPILLARY_DATASET = 'mapillary-video-cache.json';

/** Stable review.json key for a vision-persisted walkthrough frame claim. */
export function reviewKeyForVisionMapillary({ place, feature, filename }) {
  const id = place || 'unknown';
  const frame = String(filename || '').replace(/\\/g, '/');
  return `vision-mapillary:${id}:${feature}:${frame}`;
}

function recordIndex(rows) {
  const exact = new Map();
  const normal = new Map();
  for (const row of rows) {
    exact.set(String(row.name).toLowerCase(), row);
    const key = normaliseRideName(row.name);
    if (!key) continue;
    normal.set(key, normal.has(key) ? null : row);
  }
  return (rideName) =>
    exact.get(String(rideName).toLowerCase()) || normal.get(normaliseRideName(rideName)) || null;
}

/**
 * Fold walkthrough-frame claims into records and stamp steward-review metadata.
 */
export function applyVisionMapillaryClaims(records, claims, { asOf } = {}) {
  const recordFor = recordIndex(records);
  const reviewKeys = new Set();
  let applied = 0;
  const folded = new Map();

  for (const claim of claims || []) {
    const record = recordFor(claim.ride);
    if (!record) continue;
    if (!folded.has(record)) folded.set(record, { claim, frameCount: 0 });
    folded.get(record).claim = claim;
    folded.get(record).frameCount += 1;
    applied += 1;
  }

  for (const [record, { claim, frameCount }] of folded) {
    const note = frameCount > 1
      ? `${frameCount} ride-walkthrough frames near ride`
      : (claim.why || claim.note);
    addEvidence(record, claim.type, { ...claim, why: note }, { asOf });
    const slot = record.features[claim.type];
    const ev = slot?.evidence?.find((e) => e.source === claim.source);
    if (ev) {
      const key = reviewKeyForVisionMapillary({
        place: record.place || record.id,
        feature: claim.type,
        filename: 'walkthrough',
      });
      ev.reviewKey = key;
      ev.pending = true;
      ev.dataset = MAPILLARY_DATASET;
      ev.frameCount = frameCount;
      reviewKeys.add(key);
    }
  }

  const sidecar = {
    version: SCHEMA_VERSION,
    venue: records[0]?.venue,
    attractions: records.map(trim),
  };
  const { nodes, summary } = graphFromSidecar(sidecar);
  const entranceNode = nodes.find((n) => n.id?.endsWith(':queue_entrance') && n.claims?.length);

  return {
    applied,
    frameCount: claims?.length || 0,
    reviewKeys: [...reviewKeys],
    graphSummary: summary,
    convergence: entranceNode ? convergenceReport(entranceNode) : null,
    fusedBand: entranceNode?.fusion?.band ?? null,
  };
}

/** Deferred vs available-unused semantics for mapillary-tools (#408). */
export function resolveMapillaryToolsStatus({ frameCount } = {}) {
  const deferred = ['sam2', 'opensfm'];
  if (frameCount > 0) {
    return { deferred, availableUnused: [] };
  }
  return { deferred, availableUnused: ['mapillary-tools'] };
}

/**
 * Read mapillary-video cache, persist walkthrough-frame claims, return stats.
 */
export function enqueueVisionMapillaryClaims(venueId, {
  asOf = today(),
  dryRun = false,
  map,
  pois,
} = {}) {
  const cache = readJson(venueSidecar(venueId, 'mapillary-video-cache.json'), null);
  if (!cache?.frames?.length) {
    return {
      venueId,
      applied: 0,
      frameCount: 0,
      reviewKeys: [],
      mapillaryProposals: [],
      skipped: 'no mapillary-video cache on disk',
      wrote: false,
    };
  }

  const poisResolved = pois || readJson(path.join(VENUE_DIR, `${venueId}.pois.json`), []);
  const mapResolved = map || readJson(path.join(VENUE_DIR, `${venueId}.map.json`), {});

  const batch = mapillaryVideoClaimBatch(cache, poisResolved);
  if (!batch.claims.length) {
    return {
      venueId,
      applied: 0,
      frameCount: batch.frameCount,
      reviewKeys: [],
      mapillaryProposals: [],
      skipped: 'mapillary-video cache has no frames near ride POIs',
      wrote: false,
    };
  }

  const state = inventory(venueId, {}, { map: mapResolved, pois: poisResolved });
  const applyResult = applyVisionMapillaryClaims(state.records, batch.claims, { asOf });

  applyReviewDecisionsToRecords(state.records, readJson(REVIEW_FILE(venueId), { decisions: [] }));

  const list = {
    version: SCHEMA_VERSION,
    venue: venueId,
    generated: asOf,
    publish_at: PUBLISH_AT,
    attractions: state.records.map(trim),
  };

  const wrote = !dryRun && writeSettled(listFile(venueId), list);

  const mapillaryProposals = [{
    source: 'video',
    file: MAPILLARY_DATASET,
    frameCount: batch.frameCount,
    snappedCount: batch.claims.length,
    note: `${batch.frameCount} walkthrough frames ingested — pending steward review`,
  }];

  return {
    venueId,
    ...applyResult,
    frameCount: batch.frameCount,
    mapillaryProposals,
    wrote,
    skipped: null,
  };
}
