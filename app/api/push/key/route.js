import { NextResponse } from 'next/server';
import { publicKey, pushConfigured } from '@/lib/push/server';

export const dynamic = 'force-dynamic';

/** Reads one environment variable. Nothing here can legitimately be slow. */
export const maxDuration = 10;

/** The application server key a phone needs before it can subscribe. Public by
    definition — it is the half of the pair that identifies this deployment. */
export function GET() {
  if (!pushConfigured) {
    return NextResponse.json({ enabled: false, key: null });
  }
  return NextResponse.json({ enabled: true, key: publicKey });
}
