/**
 * Shared non-spatial schemas for profiles, contributions, and observations.
 * E0.3 — types the phone and consolidate job agree on. No geometry here.
 */

/** @typedef {'visitor'|'scout'|'ranger'|'cartographer'|'steward'} ProfileRank */

/**
 * @typedef {object} UserRow
 * @property {string} id
 * @property {string} email
 * @property {string} [emailVerifiedAt]
 * @property {string} createdAt
 */

/**
 * @typedef {object} ProfileRow
 * @property {string} userId
 * @property {string} displayName
 * @property {string} [avatarKey]
 * @property {ProfileRank} rank
 * @property {number} xp
 * @property {number} reputation
 * @property {number} impactHelped
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} ManagedGuestRow
 * @property {string} id
 * @property {string} guardianUserId
 * @property {string} displayName
 * @property {number} [heightIn]
 * @property {number} [ageYears]
 * @property {string} createdAt
 */

/**
 * @typedef {'experience'|'status'|'queue_band'|'geometry'|'height'|'amenity'|'adventure'} ContributionKind
 * @typedef {'pending'|'accepted'|'rejected'|'overturned'} ContributionStatus
 */

/**
 * @typedef {object} ContributionRow
 * @property {string} id
 * @property {string} authorId
 * @property {string} venueId
 * @property {string} [placeId]
 * @property {ContributionKind} kind
 * @property {ContributionStatus} status
 * @property {object} payload
 * @property {number} [lat]
 * @property {number} [lng]
 * @property {string} createdAt
 * @property {string} [resolvedAt]
 */

/**
 * @typedef {object} ConfirmationRow
 * @property {string} id
 * @property {string} contributionId
 * @property {string} authorId
 * @property {'confirm'|'deny'} vote
 * @property {string} createdAt
 * @property {number} [lat]
 * @property {number} [lng]
 */

/**
 * @typedef {object} ScoreEventRow
 * @property {string} id
 * @property {string} authorId
 * @property {string} [contributionId]
 * @property {number} deltaXp
 * @property {number} deltaRep
 * @property {string} reason
 * @property {string} createdAt
 */

/**
 * @typedef {object} ObservationRow
 * @property {string} id
 * @property {string} venueId
 * @property {string} placeId
 * @property {string} ts
 * @property {number} [waitMin]
 * @property {string} [status]
 * @property {string} source
 * @property {string} confidence
 * @property {string} [authorId]
 */

/**
 * @typedef {object} EvidenceClaimRow
 * @property {string} id
 * @property {string} venueId
 * @property {string} [placeId]
 * @property {string} kind
 * @property {string} source
 * @property {object} claim
 * @property {string} confidence
 * @property {string} createdAt
 */

export const PROFILE_RANKS = /** @type {const} */ ([
  'visitor',
  'scout',
  'ranger',
  'cartographer',
  'steward',
]);

export const CONTRIBUTION_KINDS = /** @type {const} */ ([
  'experience',
  'status',
  'queue_band',
  'geometry',
  'height',
  'amenity',
  'adventure', // Side Quest payload kind on the wire — domain name is Side Quest
]);

export const CONTRIBUTION_STATUSES = /** @type {const} */ ([
  'pending',
  'accepted',
  'rejected',
  'overturned',
]);

/** JSON Schema-ish fixtures for CI (plain objects). */
export const FIXTURES = {
  user: {
    id: 'usr_demo',
    email: 'family@example.com',
    createdAt: '2026-08-11T00:00:00.000Z',
  },
  profile: {
    userId: 'usr_demo',
    displayName: 'Alex',
    avatarKey: 'explorer-1',
    rank: 'visitor',
    xp: 0,
    reputation: 0,
    impactHelped: 0,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
  },
  contribution: {
    id: 'c_demo',
    authorId: 'usr_demo',
    venueId: 'kings-island',
    placeId: 'the-beast',
    kind: 'experience',
    status: 'pending',
    payload: { note: 'short wait' },
    createdAt: '2026-08-11T12:00:00.000Z',
  },
};

/**
 * Soft-gate helpers — anonymous may browse and join a Party by name.
 * Contributions, Side Quest submit, and cross-day Plan sync need a Profile.
 * @param {string | null | undefined} userId
 * @param {'party'|'contribute'|'adventure'|'planner'} action
 */
export function requiresSignedIn(userId, action) {
  const gated = new Set(['contribute', 'adventure', 'planner']);
  if (!gated.has(action)) return false;
  return !userId;
}
