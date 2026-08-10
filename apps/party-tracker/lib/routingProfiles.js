/**
 * Routing profiles over walkable ways.
 *
 * A profile is a pure function over graph segments via opts.penalty and an
 * exclusion predicate for snapping. Profiles with zero tag coverage must not
 * be offered.
 */

import { WAY_FLAGS, hasWayFlag } from './wayFlags.js';

export const PROFILES = {
  default: {
    id: 'default',
    label: 'Standard',
    description: 'Fastest walk along guest paths',
    minCoverage: () => true,
    segmentPenalty: () => 1,
    segmentExcluded: () => false,
  },
  no_steps: {
    id: 'no_steps',
    label: 'Step-free',
    description: 'Avoids recorded flights of stairs',
    minCoverage: (cov) => cov.steps > 0,
    segmentPenalty: (seg) => (hasWayFlag(seg.flags, WAY_FLAGS.STEPS) ? Infinity : 1),
    segmentExcluded: (seg) => hasWayFlag(seg.flags, WAY_FLAGS.STEPS),
  },
  no_restricted: {
    id: 'no_restricted',
    label: 'Guest paths',
    description: 'Skips service roads marked restricted',
    minCoverage: (cov) => cov.restricted > 0,
    segmentPenalty: (seg) => (hasWayFlag(seg.flags, WAY_FLAGS.RESTRICTED) ? 4 : 1),
    segmentExcluded: (seg) => hasWayFlag(seg.flags, WAY_FLAGS.RESTRICTED),
  },
};

/** Profiles worth offering for a venue given its coverage counters. */
export function profilesForCoverage(coverage = {}) {
  return Object.values(PROFILES).filter((p) => p.minCoverage(coverage));
}

/** Build penalty map and exclusion predicate for findRoute opts. */
export function profileOpts(profileId, graph) {
  const profile = PROFILES[profileId] || PROFILES.default;
  const penalty = new Map();
  for (let i = 0; i < graph.segments.length; i += 1) {
    const mult = profile.segmentPenalty(graph.segments[i], i);
    if (mult !== 1) penalty.set(i, mult);
  }
  const excludeSeg = (segIndex) => profile.segmentExcluded(graph.segments[segIndex], segIndex);
  return { penalty, excludeSeg, profile };
}
