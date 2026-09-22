/**
 * Shared observation schema — the phone and server agree on this shape (E7.1).
 */

/** @typedef {import('./schemas.js').ObservationRow} ObservationRow */

export const OBSERVATION_STATUSES = /** @type {const} */ (['open', 'down']);

export const OBSERVATION_SOURCES = /** @type {const} */ ([
  'party-report',
  'party-queue',
  'dwell',
  'confirm',
  'import',
]);

export const OBSERVATION_CONFIDENCE = /** @type {const} */ ([
  'low',
  'medium',
  'high',
]);

/** Identity-grade opaque token — same contract as contributions validate. */
export const ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

const SOURCE_SET = new Set(OBSERVATION_SOURCES);
const CONFIDENCE_SET = new Set(OBSERVATION_CONFIDENCE);
const STATUS_SET = new Set(OBSERVATION_STATUSES);

function parseTs(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return new Date(raw).toISOString();
  const text = String(raw).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * @param {object} body
 * @returns {{ ok: true, observation: object } | { ok: false, error: string }}
 */
export function validateObservationAppend(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body required' };

  const venueId = String(body.venueId || '').trim();
  const placeId = String(body.placeId || body.rideId || '').trim();
  const source = String(body.source || '').trim();
  const confidence = String(body.confidence || 'low').trim();
  const authorId = body.authorId != null ? String(body.authorId).trim() : undefined;
  const id = body.id != null ? String(body.id).trim() : undefined;
  const status = body.status != null ? String(body.status).trim() : undefined;
  const waitRaw = body.waitMin ?? body.wait ?? null;
  const waitMin = waitRaw != null ? Number(waitRaw) : undefined;
  const ts = parseTs(body.ts);

  if (id !== undefined && !ID_RE.test(id)) return { ok: false, error: 'id must be a short opaque token' };
  if (!venueId || !ID_RE.test(venueId)) return { ok: false, error: 'venueId required' };
  if (!placeId || !ID_RE.test(placeId)) return { ok: false, error: 'placeId required' };
  if (!source || !SOURCE_SET.has(source)) {
    return { ok: false, error: `source must be one of ${OBSERVATION_SOURCES.join(', ')}` };
  }
  if (!CONFIDENCE_SET.has(confidence)) {
    return { ok: false, error: `confidence must be one of ${OBSERVATION_CONFIDENCE.join(', ')}` };
  }
  if (!ts) return { ok: false, error: 'ts must be an ISO timestamp or epoch ms' };
  if (authorId !== undefined && authorId !== '' && !ID_RE.test(authorId)) {
    return { ok: false, error: 'authorId must be a short opaque token' };
  }
  if (status !== undefined && status !== '' && !STATUS_SET.has(status)) {
    return { ok: false, error: `status must be one of ${OBSERVATION_STATUSES.join(', ')}` };
  }
  if (waitMin != null && (!Number.isFinite(waitMin) || waitMin < 0 || waitMin > 600)) {
    return { ok: false, error: 'waitMin must be 0–600' };
  }

  return {
    ok: true,
    observation: {
      id,
      venueId,
      placeId,
      ts,
      waitMin: waitMin != null ? Math.round(waitMin) : undefined,
      status: status || undefined,
      source,
      confidence,
      authorId: authorId || undefined,
    },
  };
}

export const FIXTURES = {
  observation: {
    id: 'obs_demo',
    venueId: 'kings-island',
    placeId: 'orion',
    ts: '2026-08-11T12:00:00.000Z',
    waitMin: 25,
    status: 'down',
    source: 'party-report',
    confidence: 'low',
    authorId: 'usr_demo',
  },
};
