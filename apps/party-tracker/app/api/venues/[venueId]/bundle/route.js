import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, notFound } from '@/app/api/_lib/http';
import { resolveSyncManifest } from '../../../../../../packages/venue-builder/lib/delivery/resolve-sync-manifest.mjs';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const publicVenues = path.join(appRoot, 'public', 'venues');

export const dynamic = 'force-dynamic';

/** GET /api/venues/[venueId]/bundle?since=<revision_id> — delta manifest sync. */
export async function GET(request, { params }) {
  const venueId = params?.venueId;
  if (!venueId) return notFound();
  const { searchParams } = new URL(request.url);
  const resolved = await resolveSyncManifest(venueId, searchParams, { venueDir: publicVenues });
  if (!resolved?.manifest) return notFound();
  return json(resolved.manifest);
}
