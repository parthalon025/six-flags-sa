// Storage for the cloud fallback.
//
// Two backends, chosen at import time. With UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN set we talk to Upstash over REST, which is the only
// mode that is actually correct on Vercel: consecutive requests land on
// different instances, so no state may live in the process. Without them we
// fall back to a module-level Map, which is fine for `npm run dev`, a VPS or
// any single long-lived Node process — it resets when that process does and it
// does NOT share state across serverless instances, so a Vercel deployment
// without Upstash creds will appear to lose parties at random.
//
// The mailbox carries sealed blobs between peers that cannot reach each other
// directly. Nothing in this file reads, logs, validates or transforms `data`.

import { MEMBER_TTL_MS, PARTY_TTL_MS, evict } from './core/state.js';

const PARTY_TTL_S = Math.round(PARTY_TTL_MS / 1000);
export const MAILBOX_TTL_MS = 5 * 60 * 1000;
const MAILBOX_TTL_S = Math.round(MAILBOX_TTL_MS / 1000);
/** Deepest a single party's mailbox goes before the oldest messages fall off. */
const MAILBOX_DEPTH = 500;

const URL_BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const usingRedis = Boolean(URL_BASE && TOKEN);

/* --------------------------------------------------------------- counters */

// Hung off globalThis so the dev server's module reloads don't zero them.
const counters =
  globalThis.__kiCounters ??
  (globalThis.__kiCounters = {
    parties_created: 0,
    parties_deleted: 0,
    party_reads: 0,
    party_writes: 0,
    members_evicted: 0,
    mailbox_posted: 0,
    mailbox_dropped: 0,
    store_errors: 0,
  });

const bump = (name, by = 1) => {
  counters[name] += by;
};

/* ------------------------------------------------------------------ redis */

async function redis(command) {
  const res = await fetch(URL_BASE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    cache: 'no-store',
  });
  if (!res.ok) {
    bump('store_errors');
    throw new Error(`Upstash ${res.status}`);
  }
  return (await res.json()).result;
}

/** Several commands, one round trip. Individual command errors are surfaced. */
async function pipeline(commands) {
  const res = await fetch(`${URL_BASE}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
    cache: 'no-store',
  });
  if (!res.ok) {
    bump('store_errors');
    throw new Error(`Upstash ${res.status}`);
  }
  const rows = await res.json();
  return rows.map((row) => row?.result ?? null);
}

const partyKey = (id) => `ki:party:${id}`;
const codeKey = (code) => `ki:code:${code}`;
const boxKey = (id) => `ki:box:${id}`;
const seqKey = (id) => `ki:seq:${id}`;
const subsKey = (id) => `ki:subs:${id}`;

/* ----------------------------------------------------------------- memory */

const mem =
  globalThis.__kiStore ??
  (globalThis.__kiStore = {
    parties: new Map(), // partyId -> party record
    codes: new Map(), // code -> partyId
    boxes: new Map(), // partyId -> { seq, messages: [] }
    subs: new Map(), // partyId -> Map<endpoint, { memberId, sub }>
  });

/* -------------------------------------------------------------------- ids */

const HEX = '0123456789abcdef';
/** No I, O, 0 or 1: the code is read aloud and typed in by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function bytes(n) {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function hex(n) {
  const b = bytes(n);
  let out = '';
  for (let i = 0; i < n; i += 1) out += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return out;
}

// 32 is a divisor of 256, so a plain modulo maps bytes onto the alphabet evenly.
function newCode(len = 6) {
  const b = bytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return out;
}

/** Forgiving on input: codes get pasted with spaces, dashes and lowercase. */
export const normalizeCode = (raw) =>
  String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-HJ-NP-Z2-9]/g, '')
    .slice(0, 6);

/* ------------------------------------------------------------------ party */

/**
 * Reads prune expired members through `evict` so the roster a caller sees obeys
 * MEMBER_TTL_MS even on a party nobody has written to in an hour. The pruned
 * state is written back rather than recomputed on every read — otherwise the
 * version number would depend on when you happened to look.
 */
export async function readParty(id) {
  bump('party_reads');
  let party = null;
  if (usingRedis) {
    const raw = await redis(['GET', partyKey(id)]);
    party = raw ? JSON.parse(raw) : null;
  } else {
    party = mem.parties.get(id) ?? null;
    if (party && Date.now() - party.createdAt > PARTY_TTL_MS) {
      await deleteParty(id);
      party = null;
    }
  }
  if (!party) return null;

  const { state, ops } = evict(party, Date.now(), MEMBER_TTL_MS);
  if (ops.length) {
    bump('members_evicted', ops.length);
    await writeParty(id, state);
    return state;
  }
  return party;
}

export async function writeParty(id, party) {
  bump('party_writes');
  if (usingRedis) {
    await pipeline([
      ['SET', partyKey(id), JSON.stringify(party), 'EX', String(PARTY_TTL_S)],
      // The code index has to outlive nothing: refreshing it alongside the
      // party keeps join working right up to the party's own expiry.
      ...(party.code ? [['SET', codeKey(party.code), id, 'EX', String(PARTY_TTL_S)]] : []),
    ]);
    return party;
  }
  mem.parties.set(id, party);
  if (party.code) mem.codes.set(party.code, id);
  return party;
}

export async function deleteParty(id) {
  const party = usingRedis
    ? await redis(['GET', partyKey(id)]).then((raw) => (raw ? JSON.parse(raw) : null))
    : mem.parties.get(id);
  if (usingRedis) {
    await pipeline([
      ['DEL', partyKey(id)],
      ['DEL', boxKey(id)],
      ['DEL', seqKey(id)],
      ...(party?.code ? [['DEL', codeKey(party.code)]] : []),
    ]);
  } else {
    mem.parties.delete(id);
    mem.boxes.delete(id);
    if (party?.code) mem.codes.delete(party.code);
  }
  if (party) bump('parties_deleted');
  return Boolean(party);
}

export async function resolveCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  if (usingRedis) return (await redis(['GET', codeKey(normalized)])) || null;
  return mem.codes.get(normalized) ?? null;
}

/**
 * Reclaim memory-backend records nobody will ask for again. Redis does this
 * itself with EX; the Map cannot, and a host that stays up for a season would
 * otherwise hold every party it ever served. Driven from `allocateParty`
 * because that is both rare and the only moment the store actually grows.
 */
function sweepMemory() {
  const now = Date.now();
  for (const [id, party] of mem.parties) {
    if (now - party.createdAt <= PARTY_TTL_MS) continue;
    mem.parties.delete(id);
    mem.boxes.delete(id);
    if (party.code) mem.codes.delete(party.code);
    bump('parties_deleted');
  }
  for (const [id, box] of mem.boxes) {
    // Well past any live client's cursor, so restarting seq at 0 for this party
    // cannot make a poller drop messages it should have seen.
    if (now - box.touched > MAILBOX_TTL_MS * 10) mem.boxes.delete(id);
  }
}

/**
 * Mint the identifiers for a new party and reserve its code. The caller builds
 * the state with `createParty` and writes it; this only guarantees the code is
 * not already pointing somewhere else.
 */
export async function allocateParty() {
  if (!usingRedis) sweepMemory();
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const partyId = hex(8);
    const code = newCode();
    const claimed = usingRedis
      ? (await redis(['SET', codeKey(code), partyId, 'NX', 'EX', String(PARTY_TTL_S)])) === 'OK'
      : !mem.codes.has(code);
    if (claimed) {
      if (!usingRedis) mem.codes.set(code, partyId);
      bump('parties_created');
      return { partyId, code, token: hex(16) };
    }
  }
  throw new Error('Could not allocate a party code');
}

/* ---------------------------------------------------------------- mailbox */

const fresh = (msg, now) => now - msg.ts <= MAILBOX_TTL_MS;

/** @returns `{ messages, seq }` — `seq` is the high-water mark, expired or not. */
export async function readMailbox(id) {
  const now = Date.now();
  if (usingRedis) {
    const [rows, high] = await pipeline([
      ['LRANGE', boxKey(id), '0', '-1'],
      ['GET', seqKey(id)],
    ]);
    const messages = (rows || [])
      .map((row) => {
        try {
          return JSON.parse(row);
        } catch {
          return null;
        }
      })
      .filter((m) => m && fresh(m, now));
    return { messages, seq: Number(high) || 0 };
  }

  const box = mem.boxes.get(id);
  if (!box) return { messages: [], seq: 0 };
  const kept = box.messages.filter((m) => fresh(m, now));
  if (kept.length !== box.messages.length) {
    bump('mailbox_dropped', box.messages.length - kept.length);
    box.messages = kept;
  }
  return { messages: kept, seq: box.seq };
}

/** Append one opaque message. @returns its seq. */
export async function appendMailbox(id, { from, to, kind, data }) {
  bump('mailbox_posted');
  const ts = Date.now();

  if (usingRedis) {
    const seq = Number(await redis(['INCR', seqKey(id)]));
    const msg = JSON.stringify({ seq, ts, from, to, kind, data });
    await pipeline([
      ['RPUSH', boxKey(id), msg],
      ['LTRIM', boxKey(id), String(-MAILBOX_DEPTH), '-1'],
      ['EXPIRE', boxKey(id), String(MAILBOX_TTL_S)],
      // The seq counter outlives the messages on purpose: if it expired and
      // restarted at 1, every client's cursor would be ahead of the mailbox and
      // they would silently drop everything until it caught up.
      ['EXPIRE', seqKey(id), String(PARTY_TTL_S)],
    ]);
    return seq;
  }

  let box = mem.boxes.get(id);
  if (!box) {
    box = { seq: 0, messages: [], touched: ts };
    mem.boxes.set(id, box);
  }
  box.touched = ts;
  box.seq += 1;
  box.messages.push({ seq: box.seq, ts, from, to, kind, data });
  if (box.messages.length > MAILBOX_DEPTH) {
    bump('mailbox_dropped', box.messages.length - MAILBOX_DEPTH);
    box.messages = box.messages.slice(-MAILBOX_DEPTH);
  }
  return box.seq;
}

/* ---------------------------------------------------------- push subscriptions */

/*
 * Where to knock to wake a phone that is not looking.
 *
 * A subscription is a push-service URL and the two public values that service
 * needs to accept a message for it. It says nothing about who the person is or
 * where they are — the notification's own words travel sealed with the party
 * key inside it, exactly like a mailbox frame, and are opened by the service
 * worker on the far side. Keyed per party so leaving a party takes the right to
 * wake that phone with it.
 */

export async function addSubscription(partyId, memberId, sub) {
  if (!partyId || !sub?.endpoint) return;
  const row = JSON.stringify({ memberId, sub });
  if (usingRedis) {
    await pipeline([
      ['HSET', subsKey(partyId), sub.endpoint, row],
      ['EXPIRE', subsKey(partyId), String(PARTY_TTL_S)],
    ]);
    return;
  }
  let box = mem.subs.get(partyId);
  if (!box) {
    box = new Map();
    mem.subs.set(partyId, box);
  }
  box.set(sub.endpoint, { memberId, sub });
}

export async function removeSubscription(partyId, endpoint) {
  if (!partyId || !endpoint) return;
  if (usingRedis) {
    await redis(['HDEL', subsKey(partyId), endpoint]);
    return;
  }
  mem.subs.get(partyId)?.delete(endpoint);
}

/** @returns `[{ memberId, sub }]` — everyone in the party who can be woken. */
export async function readSubscriptions(partyId) {
  if (!partyId) return [];
  if (usingRedis) {
    const flat = await redis(['HGETALL', subsKey(partyId)]);
    const out = [];
    // HGETALL comes back as a flat [field, value, field, value, …].
    for (let i = 1; i < (flat?.length || 0); i += 2) {
      try {
        out.push(JSON.parse(flat[i]));
      } catch {
        /* a row we cannot parse is a row we cannot deliver to */
      }
    }
    return out;
  }
  return [...(mem.subs.get(partyId)?.values() || [])];
}

/* --------------------------------------------------------------- liveness */

/** Cheap round trip, so /api/ready can tell "configured" from "reachable". */
export async function ping() {
  if (!usingRedis) return { ok: true, backend: 'memory' };
  try {
    await redis(['PING']);
    return { ok: true, backend: 'upstash' };
  } catch (err) {
    return { ok: false, backend: 'upstash', error: String(err?.message || err) };
  }
}

export function metrics() {
  return {
    ...counters,
    // Only meaningful on the memory backend; Upstash has no cheap party count.
    parties_resident: usingRedis ? -1 : mem.parties.size,
    mailboxes_resident: usingRedis ? -1 : mem.boxes.size,
    uptime_seconds: Math.round(process.uptime()),
  };
}
