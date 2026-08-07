import { NextResponse } from 'next/server';
import { RIDES } from './catalog';

/**
 * The park catalogue. Static data with no party in it, so unlike everything
 * else in this API it is safe to cache — deliberately no `force-dynamic` and
 * no no-store header.
 */
export function GET() {
  return NextResponse.json({ rides: RIDES, count: RIDES.length });
}
