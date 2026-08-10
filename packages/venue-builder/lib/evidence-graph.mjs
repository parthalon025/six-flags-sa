/**
 * Venue Evidence Graph — claims about features, not bare coordinates.
 *
 * Each node is a venue feature (ride, entrance candidate, path segment) and each
 * edge is a sourced claim: official map, OSM, aerial, Mapillary, CV, guest media.
 * Fusion (evidence.mjs) consumes converging claims; the phone app consumes only
 * published coordinates and confidence bands from pois.json.
 *
 * This module is sidecar-only. Nothing here ships to the client bundle.
 */

import { fuse, PUBLISH_AT, atLeast, pointOf } from './evidence.mjs';

/**
 * @typedef {object} EvidenceGraphNode
 * @property {string} id
 * @property {string} kind — ride | entrance | exit | queue | path | amenity | metadata
 * @property {string} [label]
 * @property {string} [rideName]
 * @property {object[]} claims
 * @property {object} [fusion]
 * @property {boolean} [published]
 * @property {string} [report]
 * @property {{ lat: number, lng: number }} [at]
 */

function normaliseFeatureMap(features) {
  if (Array.isArray(features)) {
    const out = {};
    for (const f of features) {
      const key = f.kind || f.id || 'feature';
      out[key] = { ...f, evidence: f.evidence || [] };
    }
    return out;
  }
  return features || {};
}

/**
 * Normalise sidecar rows — supports legacy `rides` map and shipped `attractions[]`.
 */
export function normaliseAttractionRows(sidecar = {}) {
  if (sidecar.attractions?.length) {
    return sidecar.attractions.map((row) => ({
      id: row.id,
      name: row.name,
      features: normaliseFeatureMap(row.features),
    }));
  }
  return Object.entries(sidecar.rides || {}).map(([id, row]) => ({
    id,
    name: row.name || id,
    features: normaliseFeatureMap(row.features),
  }));
}

/**
 * Build a graph from attractions sidecar.
 *
 * @param {object} sidecar — data/venues/<id>.attractions.json
 * @returns {{ nodes: EvidenceGraphNode[], summary: object }}
 */
export function graphFromSidecar(sidecar = {}) {
  const nodes = [];
  const rows = normaliseAttractionRows(sidecar);
  for (const row of rows) {
    nodes.push({
      id: row.id,
      kind: 'ride',
      label: row.name,
      rideName: row.name,
      claims: [],
      fusion: null,
      published: false,
    });
    const feats = row.features || {};
    for (const [featureKey, slot] of Object.entries(feats)) {
      if (!slot) continue;
      const claims = slot.evidence || [];
      const fusion = fuse(claims);
      const where = pointOf(claims);
      const at = slot.at || (where ? { lat: where.lat, lng: where.lng } : null);
      const published =
        atLeast(slot.confidence || fusion.band, PUBLISH_AT) &&
        Number.isFinite(at?.lat) &&
        !slot.conflict;
      const node = {
        id: `${row.id}:${featureKey}`,
        kind: featureKey.replace(/_/g, ' '),
        label: featureKey,
        rideName: row.name,
        claims,
        fusion: {
          ...fusion,
          band: slot.confidence || fusion.band,
          score: slot.score ?? fusion.score,
        },
        published,
        report: convergenceReport({ fusion: { ...fusion, band: slot.confidence || fusion.band }, claims }),
        at,
      };
      nodes.push(node);
    }
  }
  return { nodes, summary: summarise(nodes) };
}

/** @deprecated use graphFromSidecar */
export function graphFromAttractions(attractionsJson = {}) {
  return graphFromSidecar(attractionsJson);
}

/**
 * Human-readable convergence report for a single node.
 */
export function convergenceReport(node) {
  if (!node?.fusion) return 'No claims recorded.';
  const { fusion, claims = [] } = node;
  const kinds = new Set(claims.map((c) => c.source));
  const current = claims.filter((c) => c.date).length;
  const dissent = fusion.dissent?.length || 0;
  const parts = [
    `${kinds.size} source kind(s)`,
    current ? `${current} dated` : 'none dated',
    `band ${fusion.band}`,
  ];
  if (dissent) parts.push(`${dissent} dissenting`);
  if (fusion.conflict) parts.push('conflict capped');
  return parts.join('; ');
}

export function summarise(nodes = []) {
  const featureNodes = nodes.filter((n) => n.kind !== 'ride' && n.kind !== 'metadata');
  const published = featureNodes.filter((n) => n.published).length;
  const withClaims = featureNodes.filter((n) => (n.claims?.length || 0) > 0).length;
  const high = featureNodes.filter((n) => n.fusion && atLeast(n.fusion.band, 'high')).length;
  return {
    features: featureNodes.length,
    withClaims,
    published,
    highBand: high,
    publishRate: featureNodes.length ? published / featureNodes.length : 0,
  };
}

/**
 * Merge adapter-emitted claims into an attractions sidecar ride row (legacy array helper).
 */
export function appendClaims(rideRow, newClaims, featureKind = 'entrance') {
  const out = { ...rideRow, features: { ...(rideRow.features || {}) } };
  const key = featureKind === 'entrance' ? 'queue_entrance' : featureKind;
  const slot = out.features[key] || { evidence: [] };
  for (const claim of newClaims) {
    slot.evidence = [...(slot.evidence || []), {
      source: claim.source,
      at: claim.at,
      date: claim.date,
      note: claim.note || claim.uri,
    }];
  }
  out.features[key] = slot;
  return out;
}
