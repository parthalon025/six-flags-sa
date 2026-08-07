import { NextResponse } from 'next/server';
import { readParty, writeParty, normaliseCode } from '@/lib/store';

export const dynamic = 'force-dynamic';

const clean = (s, max) => String(s ?? '').slice(0, max);

export async function GET(_req, { params }) {
  const code = normaliseCode((await params).code);
  const party = await readParty(code);
  if (!party) return NextResponse.json({ error: 'No such party' }, { status: 404 });
  return NextResponse.json({
    code: party.code,
    members: Object.values(party.members),
    meet: party.meet,
    serverTime: Date.now(),
  });
}

// Upsert one member's position.
export async function PUT(req, { params }) {
  const code = normaliseCode((await params).code);
  const party = await readParty(code);
  if (!party) return NextResponse.json({ error: 'No such party' }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (!body?.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Missing position' }, { status: 400 });
  }

  party.members[clean(body.id, 40)] = {
    id: clean(body.id, 40),
    name: clean(body.name || 'Guest', 16),
    lat,
    lng,
    acc: Number.isFinite(Number(body.acc)) ? Number(body.acc) : null,
    status: clean(body.status || 'On the move', 24),
    height: Number.isFinite(Number(body.height)) ? Number(body.height) : null,
    ts: Date.now(),
  };
  await writeParty(code, party);
  return NextResponse.json({
    members: Object.values(party.members),
    meet: party.meet,
    serverTime: Date.now(),
  });
}

export async function DELETE(req, { params }) {
  const code = normaliseCode((await params).code);
  const id = new URL(req.url).searchParams.get('id');
  const party = await readParty(code);
  if (!party) return NextResponse.json({ ok: true });
  if (id) delete party.members[id];
  await writeParty(code, party);
  return NextResponse.json({ ok: true });
}
