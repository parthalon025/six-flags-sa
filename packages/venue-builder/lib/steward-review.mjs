/**
 * Steward review packet — disputed and low-confidence evidence claims (#432).
 *
 * Turns attractions sidecar evidence into a deterministic operator queue the
 * venue PR flow can embed for the human review gate (#280).
 */

import { graphFromSidecar } from './evidence-graph.mjs';
import { atLeast, PUBLISH_AT } from './evidence.mjs';
import { readJson, venueSidecar } from './venue-io.mjs';

const BAND_RANK = { unknown: 0, low: 1, moderate: 2, high: 3, very_high: 4 };

function claimNeedsReview(node) {
  if (node.kind === 'ride' || node.kind === 'metadata') return false;
  if (!(node.claims?.length)) return false;
  const fusion = node.fusion || {};
  if (fusion.conflict) return true;
  if ((fusion.dissent?.length || 0) > 0) return true;
  if (!atLeast(fusion.band || 'unknown', PUBLISH_AT)) return true;
  return false;
}

function reviewRank(entry) {
  const priority = entry.conflict ? 0 : entry.dissent.length ? 1 : 2;
  const band = BAND_RANK[entry.band] ?? 0;
  return [priority, band, entry.nodeId];
}

function compareRank(a, b) {
  const ra = reviewRank(a);
  const rb = reviewRank(b);
  for (let i = 0; i < ra.length; i += 1) {
    if (ra[i] < rb[i]) return -1;
    if (ra[i] > rb[i]) return 1;
  }
  return 0;
}

function sourceRow(claim) {
  return {
    source: claim.source,
    date: claim.date || null,
    note: claim.note || null,
    at: claim.at?.lat != null && claim.at?.lng != null
      ? { lat: claim.at.lat, lng: claim.at.lng }
      : null,
  };
}

/**
 * @param {object} sidecar attractions.json shape
 * @param {{ venueId?: string }} [opts]
 */
export function buildStewardReviewPacket(sidecar = {}, { venueId = null } = {}) {
  const { nodes } = graphFromSidecar(sidecar);
  const claims = nodes
    .filter(claimNeedsReview)
    .map((node) => ({
      nodeId: node.id,
      ride: node.rideName || null,
      feature: node.label || node.kind,
      kind: node.kind,
      band: node.fusion?.band || 'unknown',
      conflict: !!node.fusion?.conflict,
      dissent: (node.fusion?.dissent || []).map((d) => ({
        source: d.source,
        metres: d.metres,
      })),
      published: !!node.published,
      conclusion: node.report || null,
      at: node.at?.lat != null && node.at?.lng != null
        ? { lat: node.at.lat, lng: node.at.lng }
        : null,
      sources: (node.claims || []).map(sourceRow).sort((a, b) => a.source.localeCompare(b.source)),
    }))
    .sort(compareRank);

  const disputed = claims.filter((c) => c.conflict || c.dissent.length > 0).length;
  const lowConfidence = claims.length - disputed;

  return {
    venueId: venueId || sidecar.venueId || null,
    claims,
    summary: {
      total: claims.length,
      disputed,
      lowConfidence,
    },
  };
}

export function loadStewardReviewForVenue(venueId) {
  const sidecar = readJson(venueSidecar(venueId, 'attractions.json'), {});
  return buildStewardReviewPacket(sidecar, { venueId });
}

export function renderStewardReviewMarkdown(packet) {
  const lines = ['## Steward review', ''];
  if (!packet?.claims?.length) {
    lines.push('No disputed or low-confidence claims — nothing queued for steward review.');
    return lines.join('\n');
  }

  lines.push(
    `${packet.summary.disputed} disputed, ${packet.summary.lowConfidence} low-confidence — ranked for human review.`,
    '',
  );

  for (const claim of packet.claims) {
    const flags = [
      claim.conflict ? 'conflict' : null,
      claim.dissent.length ? `${claim.dissent.length} dissenting` : null,
      `band ${claim.band}`,
      claim.published ? 'published' : 'not published',
    ].filter(Boolean);
    lines.push(`### ${claim.ride} · ${claim.feature}`);
    lines.push('');
    lines.push(`- **Status:** ${flags.join('; ')}`);
    if (claim.conclusion) lines.push(`- **Pipeline:** ${claim.conclusion}`);
    if (claim.dissent.length) {
      lines.push('- **Dissent:**');
      for (const d of claim.dissent) {
        lines.push(`  - \`${d.source}\` — ${d.metres}m from fused position`);
      }
    }
    if (claim.at) lines.push(`- **Position:** ${claim.at.lat}, ${claim.at.lng}`);
    lines.push('- **Sources:**');
    for (const src of claim.sources) {
      const where = src.at ? ` @ ${src.at.lat},${src.at.lng}` : '';
      const when = src.date ? ` (${src.date})` : '';
      lines.push(`  - \`${src.source}\`${when}${where}`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}
