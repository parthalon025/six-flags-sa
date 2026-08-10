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

import { fuse, bandOf, PUBLISH_AT, atLeast, pointOf } from './evidence.mjs';

/**
 * @typedef {object} EvidenceGraphNode
 * @property {string} id
 * @property {string} kind — ride | entrance | exit | queue | path | amenity | metadata
 * @property {string} [label]
 * @property {object[]} claims — raw evidence rows ({ source, at?, date?, uri?, note? })
 * @property {object} [fusion] — output of fuse()
 * @property {boolean} [published]
 */

/**
 * Build a graph from attractions sidecar rows.
 *
 * @param {object} attractionsJson — data/venues/<id>.attractions.json shape
 * @returns {{ nodes: EvidenceGraphNode[], summary: object }}
 */
export function graphFromAttractions(attractionsJson = {}) {
  const nodes = [];
  for (const [rideId, row] of Object.entries(attractionsJson.rides || {})) {
    nodes.push({
      id: rideId,
      kind: 'ride',
      label: row.name || rideId,
      claims: [],
      fusion: null,
      published: false,
    });
    for (const feat of row.features || []) {
      const claims = feat.evidence || [];
      const fusion = fuse(claims);
      const where = pointOf(claims);
      const published =
        atLeast(fusion.band, PUBLISH_AT) &&
        (Number.isFinite(feat.at?.lat) || Number.isFinite(where?.lat));
      nodes.push({
        id: feat.id || `${rideId}:${feat.kind || 'feature'}`,
        kind: feat.kind || 'entrance',
        label: feat.label || feat.kind,
        claims,
        fusion,
        published,
      });
    }
  }
  return { nodes, summary: summarise(nodes) };
}

/**
 * Human-readable convergence report for a single node.
 *
 * Example: "Six evidence sources converge; four current; estimated band high."
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
 * Merge adapter-emitted claims into an attractions sidecar ride row.
 *
 * @param {object} rideRow
 * @param {object[]} newClaims — EvidenceClaim from adapters/types.mjs
 * @param {string} featureKind
 */
export function appendClaims(rideRow, newClaims, featureKind = 'entrance') {
  const out = { ...rideRow, features: [...(rideRow.features || [])] };
  for (const claim of newClaims) {
    let feat = out.features.find((f) => f.kind === featureKind);
    if (!feat) {
      feat = { kind: featureKind, evidence: [] };
      out.features.push(feat);
    }
    feat.evidence = [...(feat.evidence || []), {
      source: claim.source,
      at: claim.at,
      date: claim.date,
      note: claim.note || claim.uri,
    }];
    feat.fusion = fuse(feat.evidence);
  }
  return out;
}
