/**
 * Park-wide Marks + Thanks. Same Redis / process-memory split as guest traces.
 * Party mesh still carries immediate Marks; this store is what strangers read
 * after a second Party Thanks (Overlay-style evidence).
 */

import { redisCommand, redisEval, usingRedis } from './serverStore.js';
import { dropMark, emptyWorld, thankMark, visibleMarks } from './world.js';

const TTL_S = 90 * 24 * 60 * 60;
const MAX_MARKS = 200;
/** Contention here is one venue's Marks/Thanks, never the whole store — a
 *  handful of retries covers even a burst without the caller ever seeing it. */
const MAX_CAS_ATTEMPTS = 8;

/**
 * Compare-and-set write: `KEYS[1]` is set to `ARGV[3]` only if it still holds
 * exactly what this caller last read (`ARGV[2]`, when `ARGV[1]` is `'1'`) or
 * is still absent (`ARGV[1]` is `'0'`). Returns 1 on a landed write, 0 on a
 * lost race.
 *
 * Upstash's REST transport has no WATCH/MULTI (#384) — this EVAL is what
 * stands in for it: the read-compare-write happens in one Redis-side step, so
 * two concurrent Marks/Thanks against the same venue can no longer have one
 * GET → mutate → SET clobber the other's.
 */
export const CAS_SET_LUA = `
local current = redis.call('GET', KEYS[1])
local existed = ARGV[1]
local expected = ARGV[2]
local matches
if existed == '1' then
  matches = (current == expected)
else
  matches = (current == false)
end
if matches then
  redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
  return 1
end
return 0
`;

const mem =
  globalThis.__kiWorldMarks ??
  (globalThis.__kiWorldMarks = {
    byVenue: new Map(),
  });

const worldKey = (venueId) => `ki:world:${venueId}`;

function parseWorld(raw) {
  if (!raw) return emptyWorld();
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return {
      offers: [],
      marks: Array.isArray(parsed?.marks) ? parsed.marks.slice(-MAX_MARKS) : [],
      thanks: Array.isArray(parsed?.thanks) ? parsed.thanks.slice(-2000) : [],
    };
  } catch {
    return emptyWorld();
  }
}

export async function loadVenueWorld(venueId) {
  if (!venueId) return emptyWorld();
  if (usingRedis) {
    const raw = await redisCommand(['GET', worldKey(venueId)]);
    return parseWorld(raw);
  }
  return parseWorld(mem.byVenue.get(venueId));
}

function shapeWorld(world) {
  return {
    offers: [],
    marks: (world?.marks || []).slice(-MAX_MARKS),
    thanks: (world?.thanks || []).slice(-2000),
  };
}

export async function saveVenueWorld(venueId, world) {
  if (!venueId) return world;
  const next = shapeWorld(world);
  if (usingRedis) {
    await redisCommand(['SET', worldKey(venueId), JSON.stringify(next), 'EX', String(TTL_S)]);
  } else {
    mem.byVenue.set(venueId, next);
  }
  return next;
}

/**
 * Read this venue's World, apply the pure `mutate`, and write the result
 * back — the atomic read-modify-write `postVenueMark`/`postVenueThanks` need
 * (#384).
 *
 * Redis path: retried against a fresh read whenever the CAS (`CAS_SET_LUA`)
 * reports its write lost the race, so a Thanks that lands between another
 * request's read and write is applied on top of that write rather than
 * silently overwritten by it — the failure mode `loadVenueWorld` +
 * `saveVenueWorld` had as two separate round trips.
 *
 * Memory path: unchanged plain read → mutate → write. One process, no
 * concurrent Redis writer to race against.
 */
async function mutateVenueWorld(venueId, mutate) {
  if (!venueId) return shapeWorld(mutate(emptyWorld()));

  if (!usingRedis) {
    const cur = parseWorld(mem.byVenue.get(venueId));
    const next = shapeWorld(mutate(cur));
    mem.byVenue.set(venueId, next);
    return next;
  }

  const key = worldKey(venueId);
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const raw = await redisCommand(['GET', key]);
    const cur = parseWorld(raw);
    const next = shapeWorld(mutate(cur));
    const landed = await redisEval(
      CAS_SET_LUA,
      [key],
      [raw == null ? '0' : '1', raw ?? '', JSON.stringify(next), String(TTL_S)],
    );
    if (Number(landed) === 1) return next;
  }
  throw new Error(`worldMarks: lost the write race on ${venueId} after ${MAX_CAS_ATTEMPTS} attempts`);
}

export async function postVenueMark(venueId, fields) {
  return mutateVenueWorld(venueId, (cur) => dropMark(cur, { ...fields, venueId }));
}

export async function postVenueThanks(venueId, args) {
  return mutateVenueWorld(venueId, (cur) => thankMark(cur, args));
}

export async function listVenueMarks(venueId, { partyId = null, now = Date.now() } = {}) {
  const world = await loadVenueWorld(venueId);
  return {
    world,
    marks: visibleMarks({ world, viewerPartyId: partyId, now }),
  };
}
