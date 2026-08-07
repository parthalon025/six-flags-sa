import { NextResponse } from 'next/server';
import { readParty, writeParty, normaliseCode } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function PUT(req, { params }) {
  const code = normaliseCode((await params).code);
  const party = await readParty(code);
  if (!party) return NextResponse.json({ error: 'No such party' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Missing position' }, { status: 400 });
  }
  party.meet = {
    lat,
    lng,
    label: String(body.label || 'Meet-up').slice(0, 40),
    by: String(body.by || 'Someone').slice(0, 16),
    ts: Date.now(),
  };
  await writeParty(code, party);
  return NextResponse.json({ meet: party.meet });
}

export async function DELETE(_req, { params }) {
  const code = normaliseCode((await params).code);
  const party = await readParty(code);
  if (party) {
    party.meet = null;
    await writeParty(code, party);
  }
  return NextResponse.json({ ok: true });
}
