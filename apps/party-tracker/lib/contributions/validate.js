/**
 * Validate contribution POST bodies against shared schemas (E0.3).
 */

import { CONTRIBUTION_KINDS, EPHEMERAL_CONTRIBUTION_KINDS } from '@party-tracker/shared/schemas.js';

const EPHEMERAL = new Set(EPHEMERAL_CONTRIBUTION_KINDS);

const DURABLE_KINDS = new Set([
  ...CONTRIBUTION_KINDS.filter((k) => !EPHEMERAL.has(k)),
  'height_rule',
  'poi_patch',
  'drop_place',
]);

/** Identity-grade opaque token — shared by every field that lands in a users(id)-shaped column. */
export const ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

/**
 * @param {object} body
 * @returns {{ ok: true, contribution: object } | { ok: false, error: string }}
 */
export function validateContributionPost(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body required' };

  const authorId = String(body.authorId || '').trim();
  const venueId = String(body.venueId || '').trim();
  const kind = String(body.kind || '').trim();
  const placeId = body.placeId != null ? String(body.placeId).trim() : undefined;
  // Optional client-supplied id (E9.1): lets a retried upload — after a
  // network failure the client never confirmed — land on the same row
  // instead of minting a duplicate. Absent id keeps today's server-minted one.
  const id = body.id != null ? String(body.id).trim() : undefined;
  if (id !== undefined && !ID_RE.test(id)) return { ok: false, error: 'id must be a short opaque token' };

  if (!authorId || !ID_RE.test(authorId)) return { ok: false, error: 'authorId required' };
  if (!venueId || !ID_RE.test(venueId)) return { ok: false, error: 'venueId required' };
  if (!kind || !DURABLE_KINDS.has(kind)) {
    return { ok: false, error: `kind must be durable (${[...DURABLE_KINDS].join(', ')})` };
  }
  if (EPHEMERAL.has(kind)) return { ok: false, error: 'Ephemeral kinds use ride reports, not contributions API' };

  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'payload object required' };
  }

  const lat = body.lat != null ? Number(body.lat) : undefined;
  const lng = body.lng != null ? Number(body.lng) : undefined;
  if (lat != null && !Number.isFinite(lat)) return { ok: false, error: 'lat must be numeric' };
  if (lng != null && !Number.isFinite(lng)) return { ok: false, error: 'lng must be numeric' };

  return {
    ok: true,
    contribution: {
      id,
      authorId,
      venueId,
      placeId,
      kind,
      status: 'pending',
      payload,
      lat,
      lng,
    },
  };
}
