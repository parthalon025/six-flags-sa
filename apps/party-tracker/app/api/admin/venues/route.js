import { compareAll, summary } from '@/lib/venueCompare';

export async function GET() {
  const reports = compareAll();
  return Response.json(summary(reports));
}
