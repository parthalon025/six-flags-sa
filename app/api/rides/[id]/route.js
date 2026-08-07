import { NextResponse } from 'next/server';
import { RIDE_BY_ID } from '../catalog';

export async function GET(request, { params }) {
  const { id } = await params;
  const ride = RIDE_BY_ID.get(String(id ?? '').toLowerCase());
  if (!ride) return NextResponse.json({ error: 'No such ride' }, { status: 404 });
  return NextResponse.json(ride);
}
