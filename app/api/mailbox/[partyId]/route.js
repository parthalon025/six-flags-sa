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

import { appendMailbox, readMailbox } from '@/lib/serverStore';
import { badRequest, isId, json, readJson, serverError } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** A sealed envelope is small; this is a ceiling on abuse, not a target. */
const MAX_BODY = 128 * 1024;

export async function POST(request, { params }) {
  try {
    const { partyId } = await params;
    if (!isId(partyId)) return badRequest('Bad partyId');

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

    const { messages, seq } = await readMailbox(partyId);
    const mine = messages
      .filter(
        (m) => m.seq > since && m.from !== peer && (m.to === '*' || m.to === peer),
      )
      .map(({ seq: s, from, to, kind, data }) => ({ seq: s, from, to, kind, data }));

    // The cursor is the mailbox high-water mark, not the last message this peer
    // was given: an empty poll still has to carry the reader past messages
    // addressed to someone else, or past ones that expired unread.
    return json({ messages: mine, cursor: Math.max(since, seq) });
  } catch {
    return serverError('Mailbox unavailable');
  }
}
