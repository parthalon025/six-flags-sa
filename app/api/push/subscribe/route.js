import { NextResponse } from 'next/server';
import { addSubscription, removeSubscription } from '@/lib/serverStore';

export const dynamic = 'force-dynamic';

/** Remember where to knock for this phone, for as long as it is in this party. */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { partyId, memberId, subscription } = body || {};
  if (!partyId || !subscription?.endpoint) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  await addSubscription(String(partyId), memberId ? String(memberId) : null, subscription);
  return NextResponse.json({ ok: true });
}

/** Leaving a party takes the right to wake this phone with it. */
export async function DELETE(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const { partyId, endpoint } = body || {};
  if (!partyId || !endpoint) {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  await removeSubscription(String(partyId), String(endpoint));
  return NextResponse.json({ ok: true });
}
