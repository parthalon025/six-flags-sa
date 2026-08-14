// Fixed-window rate limiting for the public relay endpoints.
//
// The shape of the limits here is dictated by where this app is used. A park is
// one enormous NAT: a family of six, and quite possibly four hundred other
// guests, reach this deployment from a single wifi egress address. Per-IP
// limits tight enough to be interesting to an attacker would therefore lock out
// exactly the crowd the app exists for, so the two are split by what they
// actually protect:
//
//   - Party creation is keyed by IP, because that is the endpoint that mints
//     storage from nothing, and generously, because of the NAT above.
//   - Mailbox traffic is keyed by *party*, which is NAT-safe by construction
//     and bounds the thing worth bounding — how much one party can spend.
//
// None of this is a security boundary. `x-forwarded-for` is only trustworthy
// because the platform rewrites it, and a self-hosted deployment behind no
// proxy should assume it is forgeable. The real bounds on abuse are the party
// existence check on the mailbox write path, MAILBOX_DEPTH, and the TTLs that
// make every key in the store temporary.

import { usingRedis, redisPipeline } from './serverStore.js';

/** Requests, window in ms. Tuned for shared park wifi, not for a lab. */
export const LIMITS = {
  partyCreate: { limit: 60, windowMs: 60 * 60 * 1000 },
  partyJoin: { limit: 120, windowMs: 10 * 60 * 1000 },
  mailboxWrite: { limit: 600, windowMs: 60 * 1000 },
  // Keyed by IP, and deliberately counting store keys brought into existence
  // rather than requests. A party created while the API was unreachable has a
  // client-minted id and no server record (lib/partyRuntime.js `allocate`), so
  // no endpoint can demand one exist — but such a party opens one mailbox and
  // one subscription list, and a script pointed at either creates thousands.
  // Metering the creation separates them without metering the traffic, which a
  // host beacon alone would blow through every hour.
  storeCreate: { limit: 20, windowMs: 60 * 60 * 1000 },
  // A phone subscribes once per party and again when its push key rotates, so
  // this is loose. Keyed per party for the NAT reason above.
  pushSubscribe: { limit: 60, windowMs: 60 * 60 * 1000 },
  // Tighter than the mailbox on purpose: this one is an amplifier. A single
  // request fans out to every subscribed phone in the party, so the ceiling is
  // set by what the feature actually sends — somebody needing help, joining,
  // leaving, the meet-up moving — and not by what the relay can bear.
  pushSend: { limit: 120, windowMs: 60 * 60 * 1000 },
  // Reads create no storage, so this is a runaway-client backstop rather than a
  // quota. It runs on the in-process counter (see `durable` below): spending a
  // Redis round trip to police the cheapest endpoint would cost more than the
  // traffic it is policing.
  mailboxRead: { limit: 2400, windowMs: 60 * 1000 },
  // Guest walk uploads — keyed by IP, generous for park wifi NAT, still caps
  // a runaway client dumping fabricated LineStrings into the research queue.
  guestTraceUpload: { limit: 120, windowMs: 60 * 60 * 1000 },
  contributionPost: { limit: 60, windowMs: 60 * 60 * 1000 },
  // Cloud REST heartbeats / location patches — keyed by party. Generous for a
  // walking party of six; stops a runaway client rewriting Redis every tick.
  partyMutate: { limit: 600, windowMs: 60 * 1000 },
};

const mem =
  globalThis.__kiRateLimit ?? (globalThis.__kiRateLimit = new Map()); // bucketKey -> count

let lastSweep = 0;

/** Buckets are named for the window they belong to, so expiry is just deletion. */
function sweep(now) {
  if (now - lastSweep < 60 * 1000) return;
  lastSweep = now;
  for (const [key, entry] of mem) if (entry.until <= now) mem.delete(key);
}

function memoryHit(bucketKey, windowMs, now) {
  sweep(now);
  const entry = mem.get(bucketKey);
  if (entry && entry.until > now) {
    entry.count += 1;
    return entry.count;
  }
  mem.set(bucketKey, { count: 1, until: now + windowMs });
  return 1;
}

async function redisHit(bucketKey, windowMs) {
  // One pipeline RTT: the bucket key already embeds the window id, so refreshing
  // EXPIRE on every hit is harmless and cheaper than a conditional second hop.
  const ttl = Math.ceil(windowMs / 1000) + 1;
  const [count] = await redisPipeline([
    ['INCR', bucketKey],
    ['EXPIRE', bucketKey, String(ttl)],
  ]);
  return Number(count);
}

/**
 * Count one request against `name` for `subject`.
 *
 * Fails open. A limiter that 500s when its own backend hiccups would take the
 * relay down for a reason unrelated to the traffic, which is a strictly worse
 * failure than briefly not counting.
 *
 * @param durable when false, count in this process only — no Redis round trip.
 * @returns `{ ok, retryAfter }`, `retryAfter` in whole seconds.
 */
export async function rateLimit(name, subject, { durable = true } = {}) {
  const rule = LIMITS[name];
  if (!rule) throw new Error(`rateLimit: unknown limit ${name}`);
  if (!subject) return { ok: true, retryAfter: 0 };

  const now = Date.now();
  const window = Math.floor(now / rule.windowMs);
  const bucketKey = `ki:rl:${name}:${subject}:${window}`;
  const resetsIn = Math.ceil((rule.windowMs - (now % rule.windowMs)) / 1000);

  let count;
  try {
    count =
      durable && usingRedis
        ? await redisHit(bucketKey, rule.windowMs)
        : memoryHit(bucketKey, rule.windowMs, now);
  } catch {
    return { ok: true, retryAfter: 0 };
  }

  return count <= rule.limit ? { ok: true, retryAfter: 0 } : { ok: false, retryAfter: resetsIn };
}

/**
 * Best-effort client address. Vercel rewrites `x-forwarded-for`, so the first
 * entry is the real peer there; everywhere else this is a hint. An address that
 * cannot be determined yields null, which `rateLimit` treats as unlimited —
 * see the note at the top of this file about what is and is not a boundary.
 */
export function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first.slice(0, 64);
  }
  return request.headers.get('x-real-ip')?.slice(0, 64) || null;
}
