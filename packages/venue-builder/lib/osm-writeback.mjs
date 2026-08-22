/**
 * OSM write-back — steward-gated proposals, never an automatic upload.
 *
 * ADR-0020 clause 5: confirmed corrections may flow back upstream. A session
 * that writes Overpass or the OSM API from here would skip the steward.
 */

/**
 * @param {{ venueId: string, feature?: object, claim?: object, evidence?: object }} deps
 */
export function buildOsmChangeProposal({ venueId, feature, claim, evidence } = {}) {
  return {
    venueId,
    format: 'osc',
    status: 'draft',
    feature: feature || null,
    claim: claim || null,
    evidence: evidence || null,
  };
}

/**
 * Write a proposal sidecar only after a steward accepted the claim.
 * @returns {{ wrote: boolean, reason?: string, proposal?: object }}
 */
export function writeOsmProposalFile(venueId, proposal, { accepted = false, write } = {}) {
  if (!accepted) {
    return { wrote: false, reason: 'steward has not accepted this claim' };
  }
  if (typeof write !== 'function') {
    return { wrote: false, reason: 'no write sink — steward proposal is not persisted' };
  }
  const body = { ...proposal, venueId, status: 'accepted' };
  write(body);
  return { wrote: true, proposal: body };
}
