import path from 'node:path';
import { json, notFound } from '@/app/api/_lib/http';
import { resolveSyncManifest } from '@party-tracker/venue-builder/delivery.js';

const publicVenues = path.join(process.cwd(), 'public', 'venues');

export const dynamic = 'force-dynamic';

/** GET /api/venues/[venueId]/bundle?since=<revision_id> — delta manifest sync. */
export async function GET(request, { params }) {
  const { venueId } = await params;
  if (!venueId) return notFound();
  const { searchParams } = new URL(request.url);
  const resolved = await resolveSyncManifest(venueId, searchParams, { venueDir: publicVenues });
  if (!resolved?.manifest) return notFound();
  return json(resolved.manifest);
}
