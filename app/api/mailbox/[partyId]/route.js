// Store-and-forward mailbox: the relay of last resort.
//
// It moves opaque sealed blobs between peers of one party and can read none of
// them. `data` is never inspected, validated or logged here — the party key
// exists precisely so this endpoint cannot be a confidant.
//
// There is deliberately no /stream (SSE) sibling. Vercel's serverless model
// gives no useful guarantee about how long a response may stay open, and a
// stream that dies every few seconds is worse than no stream at all: clients
// poll this route instead (see lib/transport/mailboxClient.js, which treats a
// missing stream as an immediate, permanent fall back to polling). A
// self-hosted host that can hold connections open is free to add one.
//
// This is the busiest route in the deployment by an order of magnitude — every
// member of every party polls it on a timer — so both verbs are written to cost
// as little as they can: the read pushes the caller's cursor down into the
// store instead of filtering afterwards, and the write spends one EXISTS to
// decide whether it is joining a conversation or starting one.

import { appendMailbox, mailboxExists, partyExists, readMailbox } from '@/lib/serverStore';
import { clientIp, rateLimit } from '@/lib/rateLimit';
import { badRequest, isId, json, readJson, serverError, tooManyRequests } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * A relay hop is a Redis round trip and nothing else, so anything approaching
 * this ceiling is a backend that has stopped answering. Naming it keeps a hung
 * upstream from billing the platform default before it gives up.
 */
export const maxDuration = 10;

/** A sealed envelope is small; this is a ceiling on abuse, not a target. */
const MAX_BODY = 128 * 1024;

export async function POST(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    // Keyed by party rather than by address: a whole park shares one wifi
    // egress, so an IP here would meter the venue instead of the abuser.
    const quota = await rateLimit('mailboxWrite', partyId);
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

    // An unknown party is not an error. A party created while this API was
    // unreachable has a client-minted id and no record here, and is a perfectly
    // ordinary invite-link party that may later fall back to this relay — see
    // `allocate` in lib/partyRuntime.js. What is not ordinary is *many* of them
    // from one caller, because posting to a fresh id is the one way an
    // anonymous request makes the store grow. So the charge lands on the
    // request that actually brings a mailbox into being, not on the party.
    if (!(await partyExists(partyId)) && !(await mailboxExists(partyId))) {
      const opening = await rateLimit('mailboxCreate', clientIp(request) ?? 'unknown');
      if (!opening.ok) return tooManyRequests(opening.retryAfter);
    }

    const body = await readJson(request, MAX_BODY);
    if (!body) return badRequest('Malformed body');

    const from = body.from;
    const to = body.to ?? '*';
    const kind = body.kind;
    if (!isId(from)) return badRequest('Bad from');
    if (!isId(to)) return badRequest('Bad to');
    if (typeof kind !== 'string' || !kind || kind.length > 32) return badRequest('Bad kind');
    if (body.data === undefined) return badRequest('Missing data');

    const seq = await appendMailbox(partyId, { from, to, kind, data: body.data });
    return json({ ok: true, seq });
  } catch {
    return serverError('Mailbox unavailable');
  }
}

export async function GET(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

    const { searchParams } = new URL(request.url);
    const peer = searchParams.get('for');
    if (!isId(peer)) return badRequest('Missing ?for');

    const since = Number(searchParams.get('since') ?? 0);
    if (!Number.isFinite(since) || since < 0) return badRequest('Bad ?since');

    // A read creates no storage, so this is a stuck-client backstop, not a
    // quota — and it runs on the in-process counter (`durable: false`) because
    // a Redis round trip to police the cheapest call in the app would cost more
    // than the call. Per instance it is therefore approximate, which is the
    // right trade for something no honest party can reach.
    const quota = await rateLimit('mailboxRead', partyId, { durable: false });
    if (!quota.ok) return tooManyRequests(quota.retryAfter);

    // `since` goes to the store, which answers with a range rather than the
    // whole box. A caught-up poller transfers nothing.
    const { messages, seq } = await readMailbox(partyId, since);
    const mine = messages
      .filter((m) => m.from !== peer && (m.to === '*' || m.to === peer))
      .map(({ seq: s, from, to, kind, data }) => ({ seq: s, from, to, kind, data }));

    // The cursor is the mailbox high-water mark, not the last message this peer
    // was given: an empty poll still has to carry the reader past messages
    // addressed to someone else, or past ones that expired unread.
    return json({ messages: mine, cursor: Math.max(since, seq) });
  } catch {
    return serverError('Mailbox unavailable');
  }
}
