import { jsonCached } from '@/app/api/_lib/http';
import { publicKey, pushConfigured } from '@/lib/push/server';

/** Reads one environment variable. Nothing here can legitimately be slow. */
export const maxDuration = 10;

/**
 * The application server key a phone needs before it can subscribe. Public by
 * definition — it is the half of the pair that identifies this deployment.
 * Deploy-static, so the CDN may hold it briefly.
 */
export function GET() {
  if (!pushConfigured) {
    return jsonCached({ enabled: false, key: null }, { maxAge: 60, sMaxAge: 300, swr: 3600 });
  }
  return jsonCached({ enabled: true, key: publicKey }, { maxAge: 300, sMaxAge: 3600, swr: 86400 });
}
