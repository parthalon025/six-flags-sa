import { ping, usingRedis } from '@/lib/serverStore';
import { json } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/**
 * Readiness: can this instance actually serve a party right now. The memory
 * backend is always ready by definition; a configured Upstash that will not
 * answer is a 503, which is what keeps a broken instance out of a load
 * balancer's rotation instead of failing every request it is handed.
 */
export async function GET() {
  const probe = await ping();
  if (!probe.ok) {
    return json({ ready: false, backend: probe.backend, error: probe.error }, 503);
  }
  return json({ ready: true, backend: probe.backend, durable: usingRedis });
}
