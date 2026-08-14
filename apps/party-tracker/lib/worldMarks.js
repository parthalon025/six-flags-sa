/**
 * Park-wide Marks + Thanks. Same Redis / process-memory split as guest traces.
 * Party mesh still carries immediate Marks; this store is what strangers read
 * after a second Party Thanks (Overlay-style evidence).
 */

import { redisCommand, usingRedis } from './serverStore.js';
import { dropMark, emptyWorld, thankMark, visibleMarks } from './world.js';

const TTL_S = 90 * 24 * 60 * 60;
const MAX_MARKS = 200;

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

export async function saveVenueWorld(venueId, world) {
  if (!venueId) return world;
  const next = {
    offers: [],
    marks: (world?.marks || []).slice(-MAX_MARKS),
    thanks: (world?.thanks || []).slice(-2000),
  };
  if (usingRedis) {
    await redisCommand(['SET', worldKey(venueId), JSON.stringify(next), 'EX', String(TTL_S)]);
  } else {
    mem.byVenue.set(venueId, next);
  }
  return next;
}

export async function postVenueMark(venueId, fields) {
  const cur = await loadVenueWorld(venueId);
  const next = dropMark(cur, { ...fields, venueId });
  return saveVenueWorld(venueId, next);
}

export async function postVenueThanks(venueId, args) {
  const cur = await loadVenueWorld(venueId);
  const next = thankMark(cur, args);
  return saveVenueWorld(venueId, next);
}

export async function listVenueMarks(venueId, { partyId = null, now = Date.now() } = {}) {
  const world = await loadVenueWorld(venueId);
  return {
    world,
    marks: visibleMarks({ world, viewerPartyId: partyId, now }),
  };
}
