import { NextResponse } from 'next/server';
import { VENUE_IDS, catalogFor, defaultVenueId } from '../catalog';

export async function GET(request, { params }) {
  const { id } = await params;
  const asked = new URL(request.url).searchParams.get('venue');
  const venue = asked && VENUE_IDS.includes(asked) ? asked : defaultVenueId();
  const ride = catalogFor(venue).byId.get(String(id ?? '').toLowerCase());
  if (!ride) return NextResponse.json({ error: 'No such ride' }, { status: 404 });
  return NextResponse.json({ venue, ...ride });
}
