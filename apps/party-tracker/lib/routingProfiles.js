/**
 * Routing profiles over walkable ways.
 *
 * A profile is a pure function over graph segments via opts.penalty and an
 * exclusion predicate for snapping. Profiles with zero tag coverage must not
 * be offered.
 */

import { WAY_FLAGS, hasWayFlag } from './wayFlags.js';

export const PROFILES = {
  /** Default walk: prefer guest paths; still allow restricted when needed. */
  default: {
    id: 'default',
    label: 'Guest paths',
    description: 'Prefers guest paths — service roads cost more',
    minCoverage: () => true,
    segmentPenalty: (seg) => (hasWayFlag(seg.flags, WAY_FLAGS.RESTRICTED) ? 4 : 1),
    segmentExcluded: () => false,
  },
  no_steps: {
    id: 'no_steps',
    label: 'Step-free',
    description: 'Avoids recorded flights of stairs',
    minCoverage: (cov) => cov.steps > 0,
    segmentPenalty: (seg) => {
      if (hasWayFlag(seg.flags, WAY_FLAGS.STEPS)) return Infinity;
      return hasWayFlag(seg.flags, WAY_FLAGS.RESTRICTED) ? 4 : 1;
    },
    segmentExcluded: (seg) => hasWayFlag(seg.flags, WAY_FLAGS.STEPS),
  },
  /** Equal weight on every mapped walk, including restricted service cuts. */
  allow_restricted: {
    id: 'allow_restricted',
    label: 'Any path',
    description: 'Treats service roads the same as guest paths',
    minCoverage: (cov) => cov.restricted > 0,
    segmentPenalty: () => 1,
    segmentExcluded: () => false,
  },
  /**
   * Avoids flights of stairs and ways OpenStreetMap explicitly says are not
   * wheelchair accessible (`wheelchair=no`). Only hard exclusions — there is
   * no lesser-but-still-avoid tier, because the tag vocabulary this reads is
   * itself binary (WAY_FLAGS.WHEELCHAIR_NO is the denial only; presence of
   * `wheelchair=yes` is not carried at all — see osm-tags.mjs). Offered only
   * when a venue actually has one of those two signals recorded, matching
   * `no_steps`'s own gate: a profile with nothing to avoid is the default
   * profile wearing a second name.
   */
  wheelchair: {
    id: 'wheelchair',
    label: 'Wheelchair accessible',
    description: 'Avoids stairs and ways marked not wheelchair accessible',
    minCoverage: (cov) => cov.steps > 0 || cov.wheelchair > 0,
    segmentPenalty: (seg) => {
      if (hasWayFlag(seg.flags, WAY_FLAGS.STEPS) || hasWayFlag(seg.flags, WAY_FLAGS.WHEELCHAIR_NO)) {
        return Infinity;
      }
      return hasWayFlag(seg.flags, WAY_FLAGS.RESTRICTED) ? 4 : 1;
    },
    segmentExcluded: (seg) =>
      hasWayFlag(seg.flags, WAY_FLAGS.STEPS) || hasWayFlag(seg.flags, WAY_FLAGS.WHEELCHAIR_NO),
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
