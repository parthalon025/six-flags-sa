import { NextResponse } from 'next/server';
import { fanOut, pushConfigured } from '@/lib/push/server';

export const dynamic = 'force-dynamic';

/**
 * Relay one sealed notification to the rest of a party.
 *
 * `sealed` is opaque here, in the same way a mailbox frame is: this route
 * neither reads it nor could. Sender and party come in the clear because
 * routing needs them, which is the same trade the mailbox already makes.
 */
export async function POST(request) {
  if (!pushConfigured) {
    return NextResponse.json({ error: 'Push is not configured' }, { status: 503 });
  }
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { partyId, from, sealed, urgent } = body || {};
  if (!partyId || !sealed) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const result = await fanOut(String(partyId), {
    sealed,
    exclude: from ? String(from) : null,
    urgent: Boolean(urgent),
  });
  return NextResponse.json({ ok: true, ...result });
}
