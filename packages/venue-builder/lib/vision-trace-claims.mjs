/**
 * Vision agent — persist traced orthophoto / imagery datasets as evidence claims.
 *
 * Issue #421: trace proposals land in the attractions sidecar (not transient
 * return values) so fusion, convergence, and steward review can see them.
 */

import { existsSync } from 'node:fs';
import {
  addEvidence,
  SCHEMA_VERSION,
  trim,
} from './attractions.mjs';
import { graphFromSidecar } from './evidence-graph.mjs';
import { PUBLISH_AT } from './evidence.mjs';
import { readSources } from './venue-sources.mjs';
import { readJson, resolveBuilderPath } from './venue-io.mjs';
import {
  fromTracedFile,
  inventory,
  listFile,
  writeSettled,
  today,
} from '../bin/attractions.mjs';

/** Stable review.json key for a vision-persisted trace claim. */
export function reviewKeyForVisionTrace({ place, feature, dataset }) {
  const id = place || 'unknown';
  const ds = String(dataset || '').replace(/\\/g, '/');
  return `vision-trace:${id}:${feature}:${ds}`;
}

/** Trace + imagery dataset relative paths from sources.json. */
export function traceDatasetPaths(venueId) {
  const { data: catalog } = readSources(venueId);
  const trace = catalog?.datasets?.trace || [];
  const imagery = catalog?.datasets?.imagery || [];
  const rows = [...trace, ...imagery];
  const out = [];
  for (const ds of rows) {
    const rel = typeof ds === 'string' ? ds : ds?.path;
    if (!rel) continue;
    const file = resolveBuilderPath(rel);
    if (file && existsSync(file)) out.push({ rel, file });
  }
  return out;
}

function recordIndex(rows) {
  const exact = new Map();
  const normal = new Map();
  for (const row of rows) {
    const name = row.name;
    exact.set(String(name).toLowerCase(), row);
    const key = String(name)
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/\s*\([^)]*\)\s*/g, '')
      .trim();
    if (!key) continue;
    normal.set(key, normal.has(key) ? null : row);
  }
  return (rideName) =>
    exact.get(String(rideName).toLowerCase())
    || normal.get(
      String(rideName)
        .toLowerCase()
        .replace(/^the\s+/, '')
        .replace(/\s*\([^)]*\)\s*/g, '')
        .trim(),
    )
    || null;
}

/**
 * Fold traced-file claims into records and stamp steward-review metadata.
 *
 * @returns {{ applied: number, orphans: string[], reviewKeys: string[], graphSummary: object }}
 */
export function applyVisionTraceClaims(records, claimBatches, { asOf } = {}) {
  const recordFor = recordIndex(records);
  const folded = new Map();
  const orphans = new Set();
  const reviewKeys = new Set();
  let applied = 0;

  for (const { rel, claims } of claimBatches) {
    for (const claim of claims) {
      const record = recordFor(claim.ride);
      if (!record) {
        orphans.add(claim.ride);
        continue;
      }
      if (!folded.has(record)) folded.set(record, new Map());
      folded.get(record).set(`${claim.type}\u0000${claim.source}`, { claim, dataset: rel });
    }
  }

  for (const [record, perSource] of folded) {
    for (const { claim, dataset } of perSource.values()) {
      addEvidence(record, claim.type, claim, { asOf });
      const slot = record.features[claim.type];
      const ev = slot?.evidence?.find((e) => e.source === claim.source);
      if (ev) {
        const key = reviewKeyForVisionTrace({
          place: record.place || record.id,
          feature: claim.type,
          dataset,
        });
        ev.reviewKey = key;
        ev.pending = true;
        ev.dataset = dataset;
        reviewKeys.add(key);
      }
      applied += 1;
    }
  }

  const sidecar = {
    version: SCHEMA_VERSION,
    venue: records[0]?.venue,
    attractions: records.map(trim),
  };
  const { summary } = graphFromSidecar(sidecar);

  return {
    applied,
    orphans: [...orphans],
    reviewKeys: [...reviewKeys],
    graphSummary: summary,
  };
}

/**
 * Read trace datasets, persist claims into attractions.json, return stats.
 */
export function enqueueVisionTraceClaims(venueId, { asOf = today(), dryRun = false } = {}) {
  const datasets = traceDatasetPaths(venueId);
  if (!datasets.length) {
    return {
      venueId,
      applied: 0,
      reviewKeys: [],
      orphans: [],
      traceProposals: [],
      skipped: 'no trace datasets on disk',
      wrote: false,
    };
  }

  const claimBatches = datasets.map(({ rel, file }) => ({
    rel,
    claims: fromTracedFile(file),
  }));

  const state = inventory(venueId, {});
  const applyResult = applyVisionTraceClaims(state.records, claimBatches, { asOf });

  const list = {
    version: SCHEMA_VERSION,
    venue: venueId,
    generated: asOf,
    publish_at: PUBLISH_AT,
    attractions: state.records.map(trim),
  };

  const wrote = !dryRun && writeSettled(listFile(venueId), list);

  const traceProposals = datasets.map(({ rel, file }) => {
    const claims = claimBatches.find((b) => b.rel === rel)?.claims || [];
    return {
      source: 'traced',
      file: rel,
      featureCount: claims.length,
      note: 'Persisted to attractions sidecar — pending steward review',
    };
  });

  return {
    venueId,
    ...applyResult,
    traceProposals,
    wrote,
    skipped: null,
  };
}

/** Review keys on the sidecar not yet approved or rejected in review.json. */
export function pendingVisionTraceKeys(sidecar, reviewDoc = { decisions: [] }) {
  const decided = new Set(reviewDoc.decisions?.map((d) => d.key) || []);
  const pending = new Set();
  for (const row of sidecar?.attractions || []) {
    for (const slot of Object.values(row.features || {})) {
      for (const ev of slot?.evidence || []) {
        if (ev.reviewKey && ev.pending && !decided.has(ev.reviewKey)) {
          pending.add(ev.reviewKey);
        }
      }
    }
  }
  return [...pending];
}
