import { androidAssetLinks } from '@/lib/storeLinks';

export function GET() {
  const prints = (process.env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const body = androidAssetLinks({ sha256Fingerprints: prints });
  if (!body) return new Response(null, { status: 404 });
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
