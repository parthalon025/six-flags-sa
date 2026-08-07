import { NextResponse } from 'next/server';
import { createParty, usingRedis } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const party = await createParty();
    return NextResponse.json({ code: party.code, durable: usingRedis });
  } catch (err) {
    return NextResponse.json({ error: 'Could not start a party' }, { status: 500 });
  }
}
