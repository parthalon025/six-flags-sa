import { appleAppSiteAssociation } from '@/lib/storeLinks';

export function GET() {
  const body = appleAppSiteAssociation({ teamId: process.env.IOS_TEAM_ID || '' });
  if (!body) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
